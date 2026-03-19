import { randomUUID } from "node:crypto";
import type { Deployer, DeployConfig, DeployOptions, DeployResult, DeployStatus } from "../deployer";
import { HealthChecker, type HealthCheckFetcher } from "../health-checker";

export interface ScriptDeployConfig extends DeployConfig {
  deployScript: string;
  rollbackScript?: string;
  env?: Record<string, string>;
}

export interface ScriptDeployOptions extends DeployOptions {
  config: ScriptDeployConfig;
}

export interface ScriptRunner {
  run(script: string, env?: Record<string, string>): Promise<{ stdout: string; exitCode: number }>;
}

export class ScriptDeployer implements Deployer {
  private readonly runner: ScriptRunner;
  private readonly healthChecker: HealthChecker;
  private readonly deployHistory = new Map<string, DeployResult & { config?: ScriptDeployConfig }>();
  private readonly envStatus = new Map<string, DeployStatus>();

  constructor(runner: ScriptRunner, fetcher?: HealthCheckFetcher) {
    this.runner = runner;
    this.healthChecker = new HealthChecker(fetcher);
  }

  async deploy(options: ScriptDeployOptions): Promise<DeployResult> {
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
        const result = await this.runner.run(config.preDeployHook, config.env);
        if (result.exitCode !== 0) throw new Error(`Pre-deploy hook failed: ${result.stdout}`);
      }

      // 2. Run deploy script
      log(`Running deploy script: ${config.deployScript}`);
      const deployEnv = { ...config.env, DEPLOY_VERSION: version, DEPLOY_ENV: environment };
      const scriptResult = await this.runner.run(config.deployScript, deployEnv);
      log(`Script output: ${scriptResult.stdout}`);
      if (scriptResult.exitCode !== 0) throw new Error(`Deploy script failed with exit code ${scriptResult.exitCode}`);

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

          if (config.rollbackOnFailure && config.rollbackScript) {
            log(`Running rollback script: ${config.rollbackScript}`);
            await this.runner.run(config.rollbackScript, config.env);
            const result: DeployResult = {
              success: false,
              deployId,
              version,
              environment,
              deployedAt: new Date().toISOString(),
              healthCheckPassed: false,
              rolledBack: true,
              error: "Health check failed, rolled back",
              durationMs: Date.now() - startTime,
              logs,
            };
            this.deployHistory.set(deployId, { ...result, config });
            return result;
          }
        } else {
          log("Health check passed");
        }
      }

      // 4. Post-deploy hook
      if (config.postDeployHook) {
        log(`Running post-deploy hook: ${config.postDeployHook}`);
        await this.runner.run(config.postDeployHook, config.env);
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
        ...(healthCheckPassed ? {} : { error: "Health check failed" }),
      };

      this.deployHistory.set(deployId, { ...result, config });
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
      this.deployHistory.set(deployId, { ...result, config });
      return result;
    }
  }

  async rollback(deployId: string): Promise<DeployResult> {
    const original = this.deployHistory.get(deployId);
    if (!original) throw new Error(`Deploy ${deployId} not found`);

    const rollbackId = randomUUID();
    const logs: string[] = [`Rolling back deploy ${deployId}`];
    const startTime = Date.now();

    if (original.config?.rollbackScript) {
      const result = await this.runner.run(original.config.rollbackScript, original.config.env);
      logs.push(`Rollback script output: ${result.stdout}`);
    }

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
