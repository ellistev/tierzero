/**
 * Fake SSH deployer that simulates deploy/rollback.
 * Implements the Deployer interface without any real SSH connections.
 */

import type { Deployer, DeployOptions, DeployResult, DeployStatus } from "../../../src/deploy/deployer";

export interface MockSSHOptions {
  /** Whether deploys should fail */
  shouldFail?: boolean;
  /** Whether rollback should succeed on failure */
  shouldRollback?: boolean;
  /** Whether health check should pass */
  healthCheckPass?: boolean;
  /** Delay in ms to simulate deploy time */
  delayMs?: number;
  /** Fail only the Nth deploy (1-indexed). All others succeed. */
  failOnDeployNumber?: number;
}

export class MockSSHDeployer implements Deployer {
  readonly deployCalls: DeployOptions[] = [];
  readonly rollbackCalls: string[] = [];
  private readonly history: DeployResult[] = [];
  private readonly opts: MockSSHOptions;
  private deployCount = 0;

  constructor(opts: MockSSHOptions = {}) {
    this.opts = opts;
  }

  async deploy(options: DeployOptions): Promise<DeployResult> {
    this.deployCalls.push(options);
    this.deployCount++;

    if (this.opts.delayMs) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }

    const deployId = `deploy-${this.deployCount}-${Date.now()}`;
    const shouldFail =
      this.opts.shouldFail ||
      (this.opts.failOnDeployNumber === this.deployCount);
    const healthPass = this.opts.healthCheckPass ?? !shouldFail;

    if (shouldFail) {
      const rolledBack = this.opts.shouldRollback ?? true;
      const result: DeployResult = {
        success: false,
        deployId,
        version: options.version,
        environment: options.environment,
        deployedAt: new Date().toISOString(),
        healthCheckPassed: healthPass,
        rolledBack,
        error: "Health check failed: service unhealthy",
        durationMs: this.opts.delayMs ?? 100,
        logs: ["deploying...", "health check failed", ...(rolledBack ? ["rolling back"] : [])],
      };
      this.history.push(result);
      return result;
    }

    const result: DeployResult = {
      success: true,
      deployId,
      version: options.version,
      environment: options.environment,
      deployedAt: new Date().toISOString(),
      healthCheckPassed: true,
      rolledBack: false,
      durationMs: this.opts.delayMs ?? 100,
      logs: ["deploying...", "health check passed", "deployed"],
    };
    this.history.push(result);
    return result;
  }

  async rollback(deployId: string): Promise<DeployResult> {
    this.rollbackCalls.push(deployId);
    return {
      success: true,
      deployId: `rb-${deployId}`,
      version: "previous",
      environment: "staging",
      deployedAt: new Date().toISOString(),
      healthCheckPassed: false,
      rolledBack: true,
      durationMs: 50,
      logs: ["rolled back"],
    };
  }

  async status(environment: string): Promise<DeployStatus> {
    const last = this.history.filter((h) => h.environment === environment).pop();
    return {
      environment,
      currentVersion: last?.version ?? "v0",
      previousVersion: "v0",
      lastDeployedAt: last?.deployedAt ?? new Date().toISOString(),
      healthy: last?.success ?? true,
    };
  }

  async history(environment: string, limit = 10): Promise<DeployResult[]> {
    return this.history
      .filter((h) => h.environment === environment)
      .slice(-limit);
  }
}
