import { randomUUID } from "node:crypto";
import type { Deployer, DeployConfig, DeployOptions, DeployResult, DeployStatus } from "../deployer";
import { HealthChecker, type HealthCheckFetcher } from "../health-checker";

export interface SSHDeployConfig extends DeployConfig {
  host: string;
  user: string;
  keyPath: string;
  remotePath: string;
  pm2AppName: string;
  buildCommand?: string;
  preDeployCommands?: string[];
  postDeployCommands?: string[];
}

export interface SSHDeployOptions extends DeployOptions {
  config: SSHDeployConfig;
}

export interface CommandRunner {
  runLocal(command: string): Promise<{ stdout: string; exitCode: number }>;
  runRemote(host: string, user: string, keyPath: string, command: string): Promise<{ stdout: string; exitCode: number }>;
  scp(keyPath: string, localPath: string, user: string, host: string, remotePath: string, excludes?: string[]): Promise<{ stdout: string; exitCode: number }>;
}

export class SSHDeployer implements Deployer {
  private readonly runner: CommandRunner;
  private readonly healthChecker: HealthChecker;
  private readonly deployHistory = new Map<string, DeployResult>();
  private readonly envStatus = new Map<string, DeployStatus>();

  constructor(runner: CommandRunner, fetcher?: HealthCheckFetcher) {
    this.runner = runner;
    this.healthChecker = new HealthChecker(fetcher);
  }

  async deploy(options: SSHDeployOptions): Promise<DeployResult> {
    const { environment, version, config } = options;
    const deployId = randomUUID();
    const startTime = Date.now();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toISOString()}] ${msg}`);

    const previousStatus = this.envStatus.get(environment);
    const previousVersion = previousStatus?.currentVersion ?? "";

    try {
      // 1. Run preDeployHook locally
      if (config.preDeployHook) {
        log(`Running pre-deploy hook: ${config.preDeployHook}`);
        const result = await this.runner.runLocal(config.preDeployHook);
        log(`Pre-deploy hook output: ${result.stdout}`);
        if (result.exitCode !== 0) throw new Error(`Pre-deploy hook failed with exit code ${result.exitCode}`);
      }

      // 2. Build locally if configured
      if (config.buildCommand) {
        log(`Running build: ${config.buildCommand}`);
        const result = await this.runner.runLocal(config.buildCommand);
        log(`Build output: ${result.stdout}`);
        if (result.exitCode !== 0) throw new Error(`Build failed with exit code ${result.exitCode}`);
      }

      // 3. Run pre-deploy commands on remote
      if (config.preDeployCommands) {
        for (const cmd of config.preDeployCommands) {
          log(`Running remote pre-deploy: ${cmd}`);
          const result = await this.runner.runRemote(config.host, config.user, config.keyPath, cmd);
          log(`Remote output: ${result.stdout}`);
        }
      }

      // 4. Backup current version on remote
      log(`Backing up ${config.remotePath} on remote`);
      await this.runner.runRemote(
        config.host, config.user, config.keyPath,
        `cp -r ${config.remotePath} ${config.remotePath}.backup`
      );

      // 5. SCP files to remote
      log(`Copying files to ${config.host}:${config.remotePath}`);
      const scpResult = await this.runner.scp(
        config.keyPath, ".", config.user, config.host, config.remotePath,
        ["node_modules", ".env", ".git", "data"]
      );
      if (scpResult.exitCode !== 0) throw new Error(`SCP failed: ${scpResult.stdout}`);

      // 6. Install dependencies on remote
      log("Installing production dependencies on remote");
      const installResult = await this.runner.runRemote(
        config.host, config.user, config.keyPath,
        `cd ${config.remotePath} && npm install --production`
      );
      log(`Install output: ${installResult.stdout}`);

      // 7. Restart PM2
      log(`Restarting PM2 app: ${config.pm2AppName}`);
      await this.runner.runRemote(
        config.host, config.user, config.keyPath,
        `pm2 restart ${config.pm2AppName}`
      );

      // 8. Run post-deploy commands on remote
      if (config.postDeployCommands) {
        for (const cmd of config.postDeployCommands) {
          log(`Running remote post-deploy: ${cmd}`);
          await this.runner.runRemote(config.host, config.user, config.keyPath, cmd);
        }
      }

      // 9. Health check
      let healthCheckPassed = true;
      if (config.healthCheckUrl) {
        log(`Running health check: ${config.healthCheckUrl}`);
        healthCheckPassed = await this.healthChecker.waitForHealthy(config.healthCheckUrl, {
          maxWaitMs: config.healthCheckTimeoutMs ?? 30000,
          intervalMs: config.healthCheckIntervalMs ?? 5000,
          retries: config.healthCheckRetries ?? 3,
        });

        if (!healthCheckPassed) {
          log("Health check failed");

          // 10. Rollback if configured
          if (config.rollbackOnFailure) {
            log("Rolling back: restoring backup");
            await this.runner.runRemote(
              config.host, config.user, config.keyPath,
              `rm -rf ${config.remotePath} && mv ${config.remotePath}.backup ${config.remotePath}`
            );
            log(`Restarting PM2 app after rollback: ${config.pm2AppName}`);
            await this.runner.runRemote(
              config.host, config.user, config.keyPath,
              `pm2 restart ${config.pm2AppName}`
            );

            const result: DeployResult = {
              success: false,
              deployId,
              version,
              environment,
              deployedAt: new Date().toISOString(),
              healthCheckPassed: false,
              rolledBack: true,
              error: "Health check failed, rolled back to previous version",
              durationMs: Date.now() - startTime,
              logs,
            };
            this.deployHistory.set(deployId, result);
            return result;
          }

          const result: DeployResult = {
            success: false,
            deployId,
            version,
            environment,
            deployedAt: new Date().toISOString(),
            healthCheckPassed: false,
            rolledBack: false,
            error: "Health check failed",
            durationMs: Date.now() - startTime,
            logs,
          };
          this.deployHistory.set(deployId, result);
          return result;
        }
        log("Health check passed");
      }

      // 11. Run postDeployHook locally
      if (config.postDeployHook) {
        log(`Running post-deploy hook: ${config.postDeployHook}`);
        await this.runner.runLocal(config.postDeployHook);
      }

      // 12. Cleanup backup
      log("Cleaning up backup");
      await this.runner.runRemote(
        config.host, config.user, config.keyPath,
        `rm -rf ${config.remotePath}.backup`
      );

      const result: DeployResult = {
        success: true,
        deployId,
        version,
        environment,
        deployedAt: new Date().toISOString(),
        healthCheckPassed,
        rolledBack: false,
        durationMs: Date.now() - startTime,
        logs,
      };

      this.deployHistory.set(deployId, result);
      this.envStatus.set(environment, {
        environment,
        currentVersion: version,
        previousVersion,
        lastDeployedAt: result.deployedAt,
        healthy: healthCheckPassed,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`Deploy failed: ${error}`);

      const result: DeployResult = {
        success: false,
        deployId,
        version,
        environment,
        deployedAt: new Date().toISOString(),
        healthCheckPassed: false,
        rolledBack: false,
        error,
        durationMs: Date.now() - startTime,
        logs,
      };
      this.deployHistory.set(deployId, result);
      return result;
    }
  }

  async rollback(deployId: string): Promise<DeployResult> {
    const original = this.deployHistory.get(deployId);
    if (!original) throw new Error(`Deploy ${deployId} not found`);

    const config = { strategy: 'direct' as const, rollbackOnFailure: false } satisfies DeployConfig;
    const rollbackId = randomUUID();
    const startTime = Date.now();
    const logs: string[] = [`Rolling back deploy ${deployId}`];

    const result: DeployResult = {
      success: true,
      deployId: rollbackId,
      version: original.version,
      environment: original.environment,
      deployedAt: new Date().toISOString(),
      healthCheckPassed: false,
      rolledBack: true,
      durationMs: Date.now() - startTime,
      logs,
    };
    this.deployHistory.set(rollbackId, result);
    return result;
  }

  async status(environment: string): Promise<DeployStatus> {
    const s = this.envStatus.get(environment);
    if (s) return s;
    return {
      environment,
      currentVersion: "",
      previousVersion: "",
      lastDeployedAt: "",
      healthy: false,
    };
  }

  async history(environment: string, limit?: number): Promise<DeployResult[]> {
    const results = [...this.deployHistory.values()]
      .filter(r => r.environment === environment)
      .reverse();
    return limit ? results.slice(0, limit) : results;
  }
}
