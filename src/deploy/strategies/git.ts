import { randomUUID } from "node:crypto";
import type { Deployer, DeployConfig, DeployOptions, DeployResult, DeployStatus } from "../deployer";
import { HealthChecker, type HealthCheckFetcher } from "../health-checker";

export interface GitDeployConfig extends DeployConfig {
  remote: string;
  branch?: string;
}

export interface GitDeployOptions extends DeployOptions {
  config: GitDeployConfig;
}

export interface GitCommandRunner {
  runLocal(command: string): Promise<{ stdout: string; exitCode: number }>;
}

export class GitDeployer implements Deployer {
  private readonly runner: GitCommandRunner;
  private readonly healthChecker: HealthChecker;
  private readonly deployHistory = new Map<string, DeployResult>();
  private readonly envStatus = new Map<string, DeployStatus>();

  constructor(runner: GitCommandRunner, fetcher?: HealthCheckFetcher) {
    this.runner = runner;
    this.healthChecker = new HealthChecker(fetcher);
  }

  async deploy(options: GitDeployOptions): Promise<DeployResult> {
    const { environment, version, config } = options;
    const deployId = randomUUID();
    const startTime = Date.now();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toISOString()}] ${msg}`);
    const previousStatus = this.envStatus.get(environment);
    const previousVersion = previousStatus?.currentVersion ?? "";

    try {
      // 1. Pre-deploy hook
      if (config.preDeployHook) {
        log(`Running pre-deploy hook: ${config.preDeployHook}`);
        const result = await this.runner.runLocal(config.preDeployHook);
        if (result.exitCode !== 0) throw new Error(`Pre-deploy hook failed: ${result.stdout}`);
      }

      // 2. Push to deploy remote
      const branch = config.branch ?? "main";
      log(`Pushing ${version} to ${config.remote} ${branch}`);
      const pushResult = await this.runner.runLocal(`git push ${config.remote} ${version}:${branch}`);
      log(`Push output: ${pushResult.stdout}`);
      if (pushResult.exitCode !== 0) throw new Error(`Git push failed: ${pushResult.stdout}`);

      // 3. Health check
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
        } else {
          log("Health check passed");
        }
      }

      // 4. Post-deploy hook
      if (config.postDeployHook) {
        log(`Running post-deploy hook: ${config.postDeployHook}`);
        await this.runner.runLocal(config.postDeployHook);
      }

      const result: DeployResult = {
        success: healthCheckPassed,
        deployId,
        version,
        environment,
        deployedAt: new Date().toISOString(),
        healthCheckPassed,
        rolledBack: false,
        durationMs: Date.now() - startTime,
        logs,
        ...(healthCheckPassed ? {} : { error: "Health check failed after git push" }),
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

    const rollbackId = randomUUID();
    const result: DeployResult = {
      success: true,
      deployId: rollbackId,
      version: original.version,
      environment: original.environment,
      deployedAt: new Date().toISOString(),
      healthCheckPassed: false,
      rolledBack: true,
      durationMs: 0,
      logs: [`Rolling back deploy ${deployId}`],
    };
    this.deployHistory.set(rollbackId, result);
    return result;
  }

  async status(environment: string): Promise<DeployStatus> {
    return this.envStatus.get(environment) ?? {
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
