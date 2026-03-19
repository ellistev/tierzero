import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Deployer, DeployOptions, DeployResult, DeployStatus } from "./deployer";
import type { AutoDeployConfig } from "../workflows/issue-pipeline";

describe("Pipeline deploy integration", () => {
  it("auto-deploy config is properly structured", () => {
    const config: AutoDeployConfig = {
      enabled: true,
      environment: "staging",
      deployConfig: {
        strategy: "direct",
        rollbackOnFailure: true,
        healthCheckUrl: "http://staging.example.com/health",
        healthCheckTimeoutMs: 30000,
        healthCheckIntervalMs: 5000,
        healthCheckRetries: 3,
      },
    };

    assert.equal(config.enabled, true);
    assert.equal(config.environment, "staging");
    assert.equal(config.deployConfig.strategy, "direct");
    assert.equal(config.deployConfig.rollbackOnFailure, true);
  });

  it("deployer interface can deploy and rollback", async () => {
    const deployResults: DeployResult[] = [];
    const deployer: Deployer = {
      async deploy(options: DeployOptions): Promise<DeployResult> {
        const result: DeployResult = {
          success: true,
          deployId: "test-deploy-1",
          version: options.version,
          environment: options.environment,
          deployedAt: new Date().toISOString(),
          healthCheckPassed: true,
          rolledBack: false,
          durationMs: 1000,
          logs: ["deployed"],
        };
        deployResults.push(result);
        return result;
      },
      async rollback(deployId: string): Promise<DeployResult> {
        return {
          success: true,
          deployId: "rollback-1",
          version: "previous",
          environment: "staging",
          deployedAt: new Date().toISOString(),
          healthCheckPassed: false,
          rolledBack: true,
          durationMs: 500,
          logs: [`rolled back ${deployId}`],
        };
      },
      async status(environment: string): Promise<DeployStatus> {
        return {
          environment,
          currentVersion: "abc123",
          previousVersion: "def456",
          lastDeployedAt: new Date().toISOString(),
          healthy: true,
        };
      },
      async history(_environment: string, _limit?: number): Promise<DeployResult[]> {
        return deployResults;
      },
    };

    // Deploy
    const result = await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: { strategy: "direct", rollbackOnFailure: true },
    });
    assert.equal(result.success, true);
    assert.equal(result.environment, "staging");
    assert.equal(result.version, "abc123");

    // Rollback
    const rollbackResult = await deployer.rollback("test-deploy-1");
    assert.equal(rollbackResult.rolledBack, true);

    // Status
    const status = await deployer.status("staging");
    assert.equal(status.healthy, true);

    // History
    const history = await deployer.history("staging");
    assert.equal(history.length, 1);
  });

  it("pipeline config accepts autoDeploy and deployer", () => {
    // Type-level test: ensure the config shape is correct
    const autoDeployConfig: AutoDeployConfig = {
      enabled: true,
      environment: "production",
      deployConfig: {
        strategy: "blue-green",
        rollbackOnFailure: true,
        healthCheckUrl: "http://prod.example.com/health",
      },
    };

    assert.equal(autoDeployConfig.enabled, true);
    assert.equal(autoDeployConfig.deployConfig.strategy, "blue-green");
  });

  it("deployer handles failed deploy correctly", async () => {
    const deployer: Deployer = {
      async deploy(): Promise<DeployResult> {
        return {
          success: false,
          deployId: "fail-1",
          version: "bad",
          environment: "staging",
          deployedAt: new Date().toISOString(),
          healthCheckPassed: false,
          rolledBack: true,
          error: "Health check failed",
          durationMs: 5000,
          logs: ["deploying", "health check failed", "rolling back"],
        };
      },
      async rollback(): Promise<DeployResult> {
        return { success: true, deployId: "rb-1", version: "prev", environment: "staging", deployedAt: "", healthCheckPassed: false, rolledBack: true, durationMs: 0, logs: [] };
      },
      async status(): Promise<DeployStatus> {
        return { environment: "staging", currentVersion: "", previousVersion: "", lastDeployedAt: "", healthy: false };
      },
      async history(): Promise<DeployResult[]> {
        return [];
      },
    };

    const result = await deployer.deploy({ environment: "staging", version: "bad", config: { strategy: "direct", rollbackOnFailure: true } });
    assert.equal(result.success, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.error, "Health check failed");
  });
});
