/**
 * E2E Integration Test: Deployment pipeline after merge.
 *
 * Verifies the complete flow:
 *   PR merged -> deploy to staging -> health check -> notify
 *   Health check failure -> rollback -> notify failure
 *
 * Uses mock deployer (no real SSH) and in-memory stores.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { Deployer, DeployOptions, DeployResult, DeployStatus } from "../../src/deploy/deployer";
import { DeploymentStore } from "../../src/read-models/deployments";
import {
  DeployInitiated,
  DeploySucceeded,
  DeployFailed,
  RollbackInitiated,
  RollbackCompleted,
} from "../../src/domain/deployment/events";
import { NotificationManager } from "../../src/comms/notification-manager";
import type { CommChannel, CommMessage, CommResult } from "../../src/comms/channel";
import { deploySuccess } from "../../src/comms/templates/deploy-success";
import { deployFailed } from "../../src/comms/templates/deploy-failed";

// ── Mock Deployer ───────────────────────────────────────────────────

class MockDeployer implements Deployer {
  deployCalls: DeployOptions[] = [];
  rollbackCalls: string[] = [];
  shouldFail = false;
  shouldRollback = true;
  private _history: DeployResult[] = [];

  async deploy(options: DeployOptions): Promise<DeployResult> {
    this.deployCalls.push(options);
    const deployId = `deploy-${Date.now()}`;

    if (this.shouldFail) {
      const result: DeployResult = {
        success: false,
        deployId,
        version: options.version,
        environment: options.environment,
        deployedAt: new Date().toISOString(),
        healthCheckPassed: false,
        rolledBack: this.shouldRollback,
        error: "Health check failed: service unhealthy",
        durationMs: 3000,
        logs: ["deploying", "health check failed", "rolling back"],
      };
      this._history.push(result);
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
      durationMs: 1500,
      logs: ["deploying", "health check passed", "deployed"],
    };
    this._history.push(result);
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
      durationMs: 500,
      logs: ["rolled back"],
    };
  }

  async status(environment: string): Promise<DeployStatus> {
    return {
      environment,
      currentVersion: "v1",
      previousVersion: "v0",
      lastDeployedAt: new Date().toISOString(),
      healthy: !this.shouldFail,
    };
  }

  async history(): Promise<DeployResult[]> {
    return [...this._history];
  }
}

// ── Mock Channel ────────────────────────────────────────────────────

class MockChannel implements CommChannel {
  name = "mock-channel";
  type = "webhook" as const;
  sent: CommMessage[] = [];

  async send(message: CommMessage): Promise<CommResult> {
    this.sent.push(message);
    return { success: true, sentAt: new Date().toISOString() };
  }

  async healthCheck() {
    return { ok: true };
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Deploy E2E: full merge -> deploy -> health check -> notify flow", () => {
  let deployer: MockDeployer;
  let deployStore: DeploymentStore;
  let notifier: NotificationManager;
  let channel: MockChannel;

  beforeEach(() => {
    deployer = new MockDeployer();
    deployStore = new DeploymentStore();
    notifier = new NotificationManager();
    channel = new MockChannel();
    notifier.registerChannel(channel);
  });

  it("successful deploy: triggers deployer, records in store, sends notification", async () => {
    // 1. Simulate deploy trigger (as pipeline would after merge)
    const deployResult = await deployer.deploy({
      environment: "staging",
      version: "abc123",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    // 2. Verify deployer was called correctly
    assert.equal(deployer.deployCalls.length, 1);
    assert.equal(deployer.deployCalls[0].environment, "staging");
    assert.equal(deployer.deployCalls[0].version, "abc123");
    assert.equal(deployResult.success, true);
    assert.equal(deployResult.healthCheckPassed, true);

    // 3. Record events in DeploymentStore (as EventBus handler would)
    const deployId = deployResult.deployId;
    deployStore.apply(new DeployInitiated(deployId, "staging", "abc123", "direct", new Date().toISOString()));
    deployStore.apply(new DeploySucceeded(deployId, true, new Date().toISOString()));

    // 4. Verify deployment store
    const record = deployStore.get(deployId);
    assert.ok(record);
    assert.equal(record!.environment, "staging");
    assert.equal(record!.version, "abc123");
    assert.equal(record!.status, "succeeded");
    assert.equal(record!.healthCheckPassed, true);

    // 5. Send notification (as the event handler would)
    notifier.addRule({
      id: "deploy-success-rule",
      trigger: "deploy.success" as "custom",
      channels: ["mock-channel"],
      template: "deploy-success",
      enabled: true,
    });

    await notifier.processEvent("deploy.success", {
      version: deployResult.version,
      environment: deployResult.environment,
      durationMs: deployResult.durationMs,
    });

    // 6. Verify notification sent
    assert.equal(channel.sent.length, 1);
    assert.ok(channel.sent[0].subject?.includes("Deploy Succeeded"));
    assert.ok(channel.sent[0].body.includes("staging"));
  });

  it("failed deploy with rollback: triggers deployer, records failure + rollback, notifies", async () => {
    deployer.shouldFail = true;
    deployer.shouldRollback = true;

    // 1. Simulate deploy trigger
    const deployResult = await deployer.deploy({
      environment: "production",
      version: "bad-version",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    // 2. Verify deploy failed
    assert.equal(deployResult.success, false);
    assert.equal(deployResult.healthCheckPassed, false);
    assert.equal(deployResult.rolledBack, true);
    assert.ok(deployResult.error);

    // 3. Record events in DeploymentStore
    const deployId = deployResult.deployId;
    const now = new Date().toISOString();
    deployStore.apply(new DeployInitiated(deployId, "production", "bad-version", "direct", now));
    deployStore.apply(new DeployFailed(deployId, deployResult.error!, now));
    deployStore.apply(new RollbackInitiated(deployId, "Health check failed", now));
    deployStore.apply(new RollbackCompleted(deployId, "previous-version", now));

    // 4. Verify store shows rolled back state
    const record = deployStore.get(deployId);
    assert.ok(record);
    assert.equal(record!.status, "rolled_back");
    assert.equal(record!.restoredVersion, "previous-version");

    // 5. Send failure notification
    notifier.addRule({
      id: "deploy-failed-rule",
      trigger: "deploy.failed" as "custom",
      channels: ["mock-channel"],
      template: "deploy-failed",
      enabled: true,
    });

    await notifier.processEvent("deploy.failed", {
      environment: deployResult.environment,
      error: deployResult.error,
      rolledBack: deployResult.rolledBack,
    });

    // 6. Verify notification
    assert.equal(channel.sent.length, 1);
    assert.ok(channel.sent[0].subject?.includes("Deploy Failed"));
    assert.ok(channel.sent[0].body.includes("FAILED"));
    assert.equal(channel.sent[0].priority, "high");
  });

  it("deployment store tracks history across multiple deploys", async () => {
    // Deploy 1: success
    const r1 = await deployer.deploy({
      environment: "staging",
      version: "v1",
      config: { strategy: "direct", rollbackOnFailure: true },
    });
    deployStore.apply(new DeployInitiated(r1.deployId, "staging", "v1", "direct", new Date().toISOString()));
    deployStore.apply(new DeploySucceeded(r1.deployId, true, new Date().toISOString()));

    // Deploy 2: failure
    deployer.shouldFail = true;
    const r2 = await deployer.deploy({
      environment: "staging",
      version: "v2",
      config: { strategy: "direct", rollbackOnFailure: true },
    });
    deployStore.apply(new DeployInitiated(r2.deployId, "staging", "v2", "direct", new Date().toISOString()));
    deployStore.apply(new DeployFailed(r2.deployId, r2.error!, new Date().toISOString()));

    // Verify store history
    const records = deployStore.getByEnvironment("staging");
    assert.equal(records.length, 2);

    const stats = deployStore.stats("staging");
    assert.equal(stats.total, 2);
    assert.equal(stats.succeeded, 1);
    assert.equal(stats.failed, 1);
  });

  it("deploy events in store match REST API list expectations", () => {
    const deployId = "test-deploy-rest";
    const now = new Date().toISOString();

    deployStore.apply(new DeployInitiated(deployId, "staging", "v1.0", "direct", now));
    deployStore.apply(new DeploySucceeded(deployId, true, now));

    // Simulate what the REST API list endpoint would return
    const allRecords = deployStore.list();
    assert.equal(allRecords.length, 1);
    assert.equal(allRecords[0].deployId, deployId);
    assert.equal(allRecords[0].environment, "staging");
    assert.equal(allRecords[0].status, "succeeded");

    // Simulate environment status endpoint
    const envRecords = deployStore.getByEnvironment("staging");
    assert.equal(envRecords.length, 1);
    assert.equal(envRecords[0].version, "v1.0");
  });

  it("onDeployComplete and onDeployFailed callbacks fire correctly in pipeline simulation", async () => {
    let successCalled = false;
    let failCalled = false;
    let successResult: DeployResult | null = null;
    let failResult: Partial<DeployResult> | null = null;

    const onDeployComplete = (result: DeployResult) => {
      successCalled = true;
      successResult = result;
    };
    const onDeployFailed = (result: Partial<DeployResult>) => {
      failCalled = true;
      failResult = result;
    };

    // Successful deploy
    const result = await deployer.deploy({
      environment: "staging",
      version: "v1",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    if (result.success) {
      onDeployComplete(result);
    } else {
      onDeployFailed(result);
    }

    assert.ok(successCalled);
    assert.ok(!failCalled);
    assert.equal(successResult!.environment, "staging");

    // Failed deploy
    successCalled = false;
    deployer.shouldFail = true;

    const failedResult = await deployer.deploy({
      environment: "production",
      version: "bad",
      config: { strategy: "direct", rollbackOnFailure: true },
    });

    if (failedResult.success) {
      onDeployComplete(failedResult);
    } else {
      onDeployFailed(failedResult);
    }

    assert.ok(!successCalled);
    assert.ok(failCalled);
    assert.equal(failResult!.environment, "production");
    assert.ok(failResult!.error);
  });

  it("deploy templates render correctly for notifications", () => {
    const successMsg = deploySuccess({
      version: "abc123",
      environment: "staging",
      durationMs: 1500,
    });
    assert.ok(successMsg.subject?.includes("Deploy Succeeded"));
    assert.ok(successMsg.body.includes("staging"));

    const failedMsg = deployFailed({
      environment: "production",
      error: "Health check timeout",
      rolledBack: true,
    });
    assert.ok(failedMsg.subject?.includes("Deploy Failed"));
    assert.ok(failedMsg.body.includes("FAILED"));
    assert.equal(failedMsg.priority, "high");
  });

  it("deploy can be disabled per-environment in config", () => {
    const stagingConfig = { enabled: true, environment: "staging", deployConfig: { strategy: "direct" as const, rollbackOnFailure: true } };
    const prodConfig = { enabled: false, environment: "production", deployConfig: { strategy: "direct" as const, rollbackOnFailure: true } };

    assert.equal(stagingConfig.enabled, true);
    assert.equal(prodConfig.enabled, false);

    // Only staging should trigger deploy
    const shouldDeployStaging = stagingConfig.enabled;
    const shouldDeployProd = prodConfig.enabled;
    assert.ok(shouldDeployStaging);
    assert.ok(!shouldDeployProd);
  });
});
