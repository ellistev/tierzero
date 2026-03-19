/**
 * Scenario 5: Deploy Failure + Rollback
 *
 * 1. PR merged successfully
 * 2. Deploy initiated
 * 3. Health check fails
 * 4. Automatic rollback triggered
 * 5. Notification sent (deploy failed + rolled back)
 * 6. System remains healthy
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { E2ETestHarness } from "../harness";

describe("Scenario 5: Deploy Failure + Rollback", () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarness({
      autoMerge: true,
      autoDeploy: true,
      deployEnv: "staging",
      reviewEnabled: true,
      ssh: {
        shouldFail: true,
        shouldRollback: true,
      },
    });
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it("PR merges but deploy fails with rollback", async () => {
    const result = await harness.submitAndWait({
      issueNumber: 500,
      title: "Add new API endpoint",
      description: "POST /api/items",
    });

    // Pipeline should still succeed (PR was merged)
    assert.equal(result.pipeline.status, "success");
    assert.ok(result.pipeline.prNumber);

    // PR should be merged
    const pr = harness.github.getPR(result.pipeline.prNumber!);
    assert.ok(pr!.merged, "PR should be merged");

    // Deploy should have failed
    assert.ok(result.deployResult, "Deploy result should exist");
    assert.equal(result.deployResult!.success, false);
    assert.equal(result.deployResult!.rolledBack, true);
  });

  it("records deploy failure in deployment store", async () => {
    await harness.submitAndWait({
      issueNumber: 501,
      title: "Database migration",
      description: "Add new columns",
    });

    harness.assertDeployFailed("staging");
    const records = harness.deployStore.getByEnvironment("staging");
    assert.ok(records.length > 0);
    const failedRecord = records.find(
      (r) => r.status === "failed" || r.status === "rolled_back",
    );
    assert.ok(failedRecord, "Should have a failed deploy record");
  });

  it("records deploy failure metric", async () => {
    await harness.submitAndWait({
      issueNumber: 502,
      title: "Update configs",
      description: "New config format",
    });

    harness.assertMetricRecorded("deploys.failure");
  });

  it("deployer receives correct deploy options", async () => {
    await harness.submitAndWait({
      issueNumber: 503,
      title: "Add feature flag support",
      description: "Feature flags for gradual rollout",
    });

    assert.equal(harness.deployer.deployCalls.length, 1);
    assert.equal(harness.deployer.deployCalls[0].environment, "staging");
    assert.ok(harness.deployer.deployCalls[0].version);
    assert.equal(harness.deployer.deployCalls[0].config.strategy, "direct");
    assert.equal(harness.deployer.deployCalls[0].config.rollbackOnFailure, true);
  });

  it("successful deploy after fixing the issue", async () => {
    // Create a new harness with working deploy
    const goodHarness = new E2ETestHarness({
      autoMerge: true,
      autoDeploy: true,
      deployEnv: "staging",
      reviewEnabled: true,
      ssh: { shouldFail: false },
    });
    await goodHarness.start();

    const result = await goodHarness.submitAndWait({
      issueNumber: 504,
      title: "Fix deploy issue",
      description: "Now the service starts correctly",
    });

    assert.equal(result.pipeline.status, "success");
    assert.ok(result.deployResult);
    assert.equal(result.deployResult!.success, true);
    assert.equal(result.deployResult!.healthCheckPassed, true);
    goodHarness.assertDeploySucceeded("staging");

    await goodHarness.stop();
  });
});
