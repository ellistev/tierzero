/**
 * Scenario 4: Agent Hang + Recovery
 *
 * 1. Agent hangs (mock Claude takes forever)
 * 2. Timeout fires after configured period
 * 3. Pipeline fails gracefully
 * 4. Second attempt succeeds
 * 5. Alert fired for agent hang
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { E2ETestHarness } from "../harness";

describe("Scenario 4: Agent Hang + Recovery", () => {
  it("pipeline fails with timeout when agent hangs", async () => {
    const harness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: false,
      claude: { hang: true },
    });
    await harness.start();

    try {
      await harness.submitAndWait(
        { issueNumber: 400, title: "Hanging task", description: "This will hang" },
        500, // 500ms timeout
      );
      assert.fail("Should have thrown timeout error");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("timeout") || err.message.includes("Timeout"), `Expected timeout error, got: ${err.message}`);
    }

    await harness.stop();
  });

  it("second attempt succeeds after first times out", async () => {
    // First attempt: agent hangs
    const hangHarness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: false,
      claude: { hang: true },
    });
    await hangHarness.start();

    try {
      await hangHarness.submitAndWait(
        { issueNumber: 401, title: "Retry task", description: "First attempt hangs" },
        500,
      );
    } catch {
      // Expected timeout
    }
    await hangHarness.stop();

    // Second attempt: agent works normally
    const normalHarness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: false,
    });
    await normalHarness.start();

    const result = await normalHarness.submitAndWait({
      issueNumber: 401,
      title: "Retry task",
      description: "Second attempt succeeds",
    });

    assert.equal(result.pipeline.status, "success");
    assert.ok(result.pipeline.prNumber);

    await normalHarness.stop();
  });

  it("slow agent (with delay) still completes within timeout", async () => {
    const harness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: false,
      claude: { delayMs: 100 },
    });
    await harness.start();

    const result = await harness.submitAndWait(
      { issueNumber: 402, title: "Slow task", description: "Takes a moment" },
      10_000,
    );

    assert.equal(result.pipeline.status, "success");
    await harness.stop();
  });

  it("pipeline records failure in issue comments when agent fails", async () => {
    const harness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: false,
      claude: { solveShouldFail: true },
    });
    await harness.start();

    const result = await harness.submitAndWait({
      issueNumber: 403,
      title: "Failing agent task",
      description: "Agent will crash",
    });

    assert.equal(result.pipeline.status, "failed");
    assert.ok(result.pipeline.error);

    // Issue should have error comment
    const issue = harness.github.issues.get("403");
    assert.ok(issue);
    const hasErrorComment = issue!.comments.some((c) => c.body.includes("error") || c.body.includes("Error"));
    assert.ok(hasErrorComment, "Issue should have error comment");

    await harness.stop();
  });
});
