/**
 * Scenario 1: Happy Path - Full Pipeline
 *
 * 1. Submit GitHub issue with `tierzero-agent` label
 * 2. Claude Code agent creates files + tests
 * 3. Tests pass
 * 4. PR review passes (score > 70)
 * 5. PR auto-merged
 * 6. Deploy to staging succeeds (health check passes)
 * 7. Notifications sent
 * 8. Monitoring metrics updated
 * 9. Knowledge extracted from completed work
 * 10. All read models have correct state
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { E2ETestHarness } from "../harness";

describe("Scenario 1: Happy Path - Full Pipeline", () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarness({
      autoMerge: true,
      autoDeploy: true,
      deployEnv: "staging",
      reviewEnabled: true,
      reviewMinScore: 70,
      claude: {
        solveFiles: ["src/auth.ts", "src/auth.test.ts"],
      },
    });
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it("runs the full pipeline: issue → agent → test → review → merge → deploy → notify", async () => {
    const result = await harness.submitAndWait({
      issueNumber: 100,
      title: "Add authentication module",
      description: "Implement JWT-based auth for the API",
      labels: ["tierzero-agent", "enhancement"],
    });

    // Pipeline succeeds
    assert.equal(result.pipeline.status, "success");
    assert.ok(result.pipeline.prNumber, "PR should be created");
    assert.ok(result.pipeline.prUrl, "PR URL should be set");
    assert.equal(result.pipeline.issueNumber, 100);
  });

  it("creates a PR and auto-merges it", async () => {
    const result = await harness.submitAndWait({
      issueNumber: 101,
      title: "Fix login bug",
      description: "Users can't log in after password reset",
    });

    assert.equal(result.pipeline.status, "success");
    harness.assertPRCreated(101);

    // PR should be merged
    const pr = harness.github.getPR(result.pipeline.prNumber!);
    assert.ok(pr, "PR should exist");
    assert.ok(pr!.merged, "PR should be merged");
  });

  it("deploys to staging after merge", async () => {
    const result = await harness.submitAndWait({
      issueNumber: 102,
      title: "Add user profile endpoint",
      description: "GET /api/users/:id",
    });

    assert.equal(result.pipeline.status, "success");

    // Deploy should have succeeded
    assert.ok(result.deployResult, "Deploy result should exist");
    assert.equal(result.deployResult!.success, true);
    assert.equal(result.deployResult!.environment, "staging");
    assert.equal(result.deployResult!.healthCheckPassed, true);
    harness.assertDeploySucceeded("staging");
  });

  it("sends task completion notification", async () => {
    await harness.submitAndWait({
      issueNumber: 103,
      title: "Add rate limiting",
      description: "Rate limit API to 100 req/min",
    });

    harness.assertNotificationSent("email", "Task Completed");
    harness.assertNotificationSent("slack", "Task Completed");
  });

  it("records metrics for the pipeline", async () => {
    await harness.submitAndWait({
      issueNumber: 104,
      title: "Add caching layer",
      description: "Cache user lookups",
    });

    harness.assertMetricRecorded("tasks.completed");
    harness.assertMetricRecorded("prs.created");
    harness.assertMetricRecorded("deploys.success");
  });

  it("extracts knowledge from completed work", async () => {
    await harness.submitAndWait({
      issueNumber: 105,
      title: "Fix database connection pooling",
      description: "Pool exhaustion under load",
    });

    const stats = await harness.knowledge.stats();
    assert.ok(stats.totalEntries > 0, "Knowledge should be extracted");
    const entries = await harness.knowledge.search("database connection");
    assert.ok(entries.length > 0, "Should find relevant knowledge entry");
  });

  it("updates issue with completion comment", async () => {
    await harness.submitAndWait({
      issueNumber: 106,
      title: "Add health check endpoint",
      description: "GET /health",
    });

    harness.assertTaskCompleted(106);
    const issue = harness.github.issues.get("106");
    assert.ok(issue);
    assert.ok(issue!.comments.length > 0, "Issue should have comments");
    const hasWorkingComment = issue!.comments.some((c) => c.body.includes("TierZero is working"));
    assert.ok(hasWorkingComment, "Should have 'working on' comment");
  });

  it("code agent receives correct issue context", async () => {
    await harness.submitAndWait({
      issueNumber: 107,
      title: "Refactor middleware",
      description: "Extract common middleware into shared module",
      labels: ["tierzero-agent", "refactor"],
    });

    assert.equal(harness.claude.solveCalls.length, 1);
    const call = harness.claude.solveCalls[0];
    assert.equal(call.title, "Refactor middleware");
    assert.equal(call.description, "Extract common middleware into shared module");
    assert.ok(call.labels.includes("tierzero-agent"));
  });

  it("deploy store tracks successful deployment", async () => {
    const result = await harness.submitAndWait({
      issueNumber: 108,
      title: "Add pagination",
      description: "Paginate list endpoints",
    });

    const records = harness.deployStore.getByEnvironment("staging");
    assert.ok(records.length > 0, "Should have deployment records");
    assert.equal(records[0].status, "succeeded");
    assert.equal(records[0].version, result.deployResult!.version);
  });
});
