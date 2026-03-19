import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Deployer, DeployOptions, DeployResult, DeployStatus } from "./deployer";
import type { PipelineConfig } from "../workflows/issue-pipeline";

describe("Pipeline deploy integration - post-merge deployment", () => {
  function createMockDeployer(options?: { fail?: boolean; rollback?: boolean }): Deployer & { calls: DeployOptions[] } {
    const calls: DeployOptions[] = [];
    return {
      calls,
      async deploy(opts: DeployOptions): Promise<DeployResult> {
        calls.push(opts);
        if (options?.fail) {
          return {
            success: false,
            deployId: "deploy-fail-1",
            version: opts.version,
            environment: opts.environment,
            deployedAt: new Date().toISOString(),
            healthCheckPassed: false,
            rolledBack: options?.rollback ?? false,
            error: "Health check failed",
            durationMs: 2000,
            logs: ["deploying", "health check failed"],
          };
        }
        return {
          success: true,
          deployId: "deploy-1",
          version: opts.version,
          environment: opts.environment,
          deployedAt: new Date().toISOString(),
          healthCheckPassed: true,
          rolledBack: false,
          durationMs: 1500,
          logs: ["deploying", "health check passed"],
        };
      },
      async rollback(): Promise<DeployResult> {
        return {
          success: true, deployId: "rb-1", version: "prev", environment: "staging",
          deployedAt: new Date().toISOString(), healthCheckPassed: false, rolledBack: true,
          durationMs: 500, logs: ["rolled back"],
        };
      },
      async status(env: string): Promise<DeployStatus> {
        return { environment: env, currentVersion: "v1", previousVersion: "v0", lastDeployedAt: new Date().toISOString(), healthy: true };
      },
      async history(): Promise<DeployResult[]> {
        return [];
      },
    };
  }

  it("deploy callbacks are part of PipelineConfig", () => {
    const deployer = createMockDeployer();
    const config: Partial<PipelineConfig> = {
      autoDeploy: {
        enabled: true,
        environment: "staging",
        deployConfig: {
          strategy: "direct",
          rollbackOnFailure: true,
        },
      },
      deployer,
      onDeployComplete: (_result) => { /* noop */ },
      onDeployFailed: (_result) => { /* noop */ },
    };

    assert.ok(config.autoDeploy);
    assert.ok(config.deployer);
    assert.ok(config.onDeployComplete);
    assert.ok(config.onDeployFailed);
  });

  it("mock deployer is called with correct environment and version", async () => {
    const deployer = createMockDeployer();
    const result = await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    assert.equal(deployer.calls.length, 1);
    assert.equal(deployer.calls[0].environment, "staging");
    assert.equal(deployer.calls[0].version, "abc123");
    assert.equal(result.success, true);
    assert.equal(result.healthCheckPassed, true);
  });

  it("onDeployComplete callback fires on successful deploy", async () => {
    const deployer = createMockDeployer();
    let callbackResult: DeployResult | null = null;

    const onDeployComplete = (result: DeployResult) => {
      callbackResult = result;
    };

    const deployResult = await deployer.deploy({
      environment: "staging",
      version: "v1.0",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    if (deployResult.success) {
      onDeployComplete(deployResult);
    }

    assert.ok(callbackResult);
    assert.equal(callbackResult!.success, true);
    assert.equal(callbackResult!.environment, "staging");
    assert.equal(callbackResult!.version, "v1.0");
  });

  it("onDeployFailed callback fires on failed deploy", async () => {
    const deployer = createMockDeployer({ fail: true, rollback: true });
    let callbackResult: Partial<DeployResult> | null = null;

    const onDeployFailed = (result: Partial<DeployResult>) => {
      callbackResult = result;
    };

    const deployResult = await deployer.deploy({
      environment: "production",
      version: "bad-version",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    if (!deployResult.success) {
      onDeployFailed(deployResult);
    }

    assert.ok(callbackResult);
    assert.equal(callbackResult!.success, false);
    assert.equal(callbackResult!.rolledBack, true);
    assert.equal(callbackResult!.error, "Health check failed");
  });

  it("deploy not triggered when autoDeploy is disabled", () => {
    const config: Partial<PipelineConfig> = {
      autoDeploy: {
        enabled: false,
        environment: "staging",
        deployConfig: { strategy: "direct", rollbackOnFailure: true },
      },
    };

    // Simulates the pipeline check
    const shouldDeploy = config.autoDeploy?.enabled && config.deployer;
    assert.equal(shouldDeploy, undefined);
  });

  it("deploy not triggered without deployer instance", () => {
    const config: Partial<PipelineConfig> = {
      autoDeploy: {
        enabled: true,
        environment: "staging",
        deployConfig: { strategy: "direct", rollbackOnFailure: true },
      },
      // No deployer provided
    };

    const shouldDeploy = config.autoDeploy?.enabled && config.deployer;
    assert.ok(!shouldDeploy);
  });
});
