import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SSHDeployer, type CommandRunner } from "./ssh";
import type { HealthCheckFetcher } from "../health-checker";

function mockRunner(overrides: Partial<CommandRunner> = {}): CommandRunner & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    runLocal: overrides.runLocal ?? (async (cmd) => {
      calls.push({ method: "runLocal", args: [cmd] });
      return { stdout: "ok", exitCode: 0 };
    }),
    runRemote: overrides.runRemote ?? (async (host, user, keyPath, cmd) => {
      calls.push({ method: "runRemote", args: [host, user, keyPath, cmd] });
      return { stdout: "ok", exitCode: 0 };
    }),
    scp: overrides.scp ?? (async (keyPath, localPath, user, host, remotePath, excludes) => {
      calls.push({ method: "scp", args: [keyPath, localPath, user, host, remotePath, excludes] });
      return { stdout: "ok", exitCode: 0 };
    }),
  };
}

function healthyFetcher(): HealthCheckFetcher {
  return async () => ({ status: 200, text: async () => "ok" });
}

function unhealthyFetcher(): HealthCheckFetcher {
  return async () => ({ status: 503, text: async () => "error" });
}

describe("SSHDeployer", () => {
  it("deploys successfully with full flow", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, healthyFetcher());

    const result = await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        healthCheckUrl: "http://server.example.com:3000/health",
        healthCheckTimeoutMs: 5000,
        healthCheckIntervalMs: 100,
        healthCheckRetries: 1,
        rollbackOnFailure: true,
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.environment, "staging");
    assert.equal(result.version, "abc123");
    assert.equal(result.healthCheckPassed, true);
    assert.equal(result.rolledBack, false);
    assert.ok(result.deployId);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.logs.length > 0);

    // Verify SSH commands were called
    const remoteCalls = runner.calls.filter(c => c.method === "runRemote");
    const backupCall = remoteCalls.find(c => (c.args[3] as string).includes("cp -r"));
    assert.ok(backupCall, "Should backup current version");

    const npmCall = remoteCalls.find(c => (c.args[3] as string).includes("npm install"));
    assert.ok(npmCall, "Should install dependencies");

    const pm2Call = remoteCalls.find(c => (c.args[3] as string).includes("pm2 restart"));
    assert.ok(pm2Call, "Should restart PM2");

    const scpCalls = runner.calls.filter(c => c.method === "scp");
    assert.equal(scpCalls.length, 1, "Should SCP files to remote");
  });

  it("rolls back on health check failure", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, unhealthyFetcher());

    const result = await deployer.deploy({
      environment: "production",
      version: "bad123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        healthCheckUrl: "http://server.example.com:3000/health",
        healthCheckTimeoutMs: 1000,
        healthCheckIntervalMs: 100,
        healthCheckRetries: 1,
        rollbackOnFailure: true,
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.healthCheckPassed, false);
    assert.ok(result.error?.includes("rolled back"));

    // Verify rollback commands
    const remoteCalls = runner.calls.filter(c => c.method === "runRemote");
    const restoreCall = remoteCalls.find(c => (c.args[3] as string).includes("mv") && (c.args[3] as string).includes(".backup"));
    assert.ok(restoreCall, "Should restore backup");

    const pm2Restarts = remoteCalls.filter(c => (c.args[3] as string).includes("pm2 restart"));
    assert.ok(pm2Restarts.length >= 2, "Should restart PM2 after rollback");
  });

  it("does not rollback when rollbackOnFailure is false", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, unhealthyFetcher());

    const result = await deployer.deploy({
      environment: "staging",
      version: "test123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        healthCheckUrl: "http://server.example.com:3000/health",
        healthCheckTimeoutMs: 1000,
        healthCheckIntervalMs: 100,
        healthCheckRetries: 1,
        rollbackOnFailure: false,
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.rolledBack, false);
    assert.equal(result.healthCheckPassed, false);
  });

  it("runs pre and post deploy hooks", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, healthyFetcher());

    await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        rollbackOnFailure: true,
        preDeployHook: "echo pre-hook",
        postDeployHook: "echo post-hook",
        buildCommand: "npm run build",
      },
    });

    const localCalls = runner.calls.filter(c => c.method === "runLocal");
    assert.ok(localCalls.some(c => (c.args[0] as string) === "echo pre-hook"));
    assert.ok(localCalls.some(c => (c.args[0] as string) === "npm run build"));
    assert.ok(localCalls.some(c => (c.args[0] as string) === "echo post-hook"));
  });

  it("handles SCP failure", async () => {
    const runner = mockRunner({
      scp: async () => ({ stdout: "Permission denied", exitCode: 1 }),
    });
    const deployer = new SSHDeployer(runner);

    const result = await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        rollbackOnFailure: true,
      },
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("SCP failed"));
  });

  it("tracks deploy history per environment", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, healthyFetcher());

    const config = {
      strategy: "direct" as const,
      host: "server.example.com",
      user: "deploy",
      keyPath: "/home/deploy/.ssh/id_rsa",
      remotePath: "/opt/myapp",
      pm2AppName: "myapp",
      rollbackOnFailure: true,
    };

    await deployer.deploy({ environment: "staging", version: "v1", config });
    await deployer.deploy({ environment: "staging", version: "v2", config });
    await deployer.deploy({ environment: "production", version: "v1", config });

    const stagingHistory = await deployer.history("staging");
    assert.equal(stagingHistory.length, 2);

    const prodHistory = await deployer.history("production");
    assert.equal(prodHistory.length, 1);

    const stagingStatus = await deployer.status("staging");
    assert.equal(stagingStatus.currentVersion, "v2");
    assert.equal(stagingStatus.previousVersion, "v1");
  });

  it("runs preDeployCommands and postDeployCommands on remote", async () => {
    const runner = mockRunner();
    const deployer = new SSHDeployer(runner, healthyFetcher());

    await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: {
        strategy: "direct",
        host: "server.example.com",
        user: "deploy",
        keyPath: "/home/deploy/.ssh/id_rsa",
        remotePath: "/opt/myapp",
        pm2AppName: "myapp",
        rollbackOnFailure: true,
        preDeployCommands: ["systemctl stop nginx"],
        postDeployCommands: ["systemctl start nginx"],
      },
    });

    const remoteCalls = runner.calls.filter(c => c.method === "runRemote");
    assert.ok(remoteCalls.some(c => (c.args[3] as string) === "systemctl stop nginx"));
    assert.ok(remoteCalls.some(c => (c.args[3] as string) === "systemctl start nginx"));
  });
});
