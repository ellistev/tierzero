/**
 * Scenario 6: Multi-Issue Sequential Processing
 *
 * 1. 3 issues labeled simultaneously
 * 2. Processed one at a time
 * 3. Each issue: branch -> code -> test -> PR -> merge
 * 4. All 3 PRs merged, all tests passing
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { E2ETestHarness } from "../harness";

describe("Scenario 6: Multi-Issue Sequential Processing", () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarness({
      autoMerge: true,
      reviewEnabled: true,
    });
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it("processes 3 issues sequentially, all succeed", async () => {
    const issues = [
      { issueNumber: 601, title: "Add user service", description: "User CRUD operations" },
      { issueNumber: 602, title: "Add product service", description: "Product catalog API" },
      { issueNumber: 603, title: "Add order service", description: "Order processing API" },
    ];

    const results = [];
    for (const issue of issues) {
      const result = await harness.submitAndWait(issue);
      results.push(result);
    }

    // All should succeed
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].pipeline.status, "success", `Issue #${issues[i].issueNumber} should succeed`);
      assert.ok(results[i].pipeline.prNumber, `Issue #${issues[i].issueNumber} should have a PR`);
    }
  });

  it("creates unique PRs for each issue", async () => {
    const results = [];
    for (let i = 1; i <= 3; i++) {
      const result = await harness.submitAndWait({
        issueNumber: 610 + i,
        title: `Feature ${i}`,
        description: `Implement feature ${i}`,
      });
      results.push(result);
    }

    const prNumbers = results.map((r) => r.pipeline.prNumber);
    const uniquePRs = new Set(prNumbers);
    assert.equal(uniquePRs.size, 3, "Each issue should get a unique PR");
  });

  it("all PRs are merged", async () => {
    const prNumbers: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const result = await harness.submitAndWait({
        issueNumber: 620 + i,
        title: `Merge test ${i}`,
        description: `Test merging ${i}`,
      });
      prNumbers.push(result.pipeline.prNumber!);
    }

    for (const prNumber of prNumbers) {
      const pr = harness.github.getPR(prNumber);
      assert.ok(pr, `PR #${prNumber} should exist`);
      assert.ok(pr!.merged, `PR #${prNumber} should be merged`);
    }
  });

  it("each issue gets its own comments", async () => {
    for (let i = 1; i <= 3; i++) {
      await harness.submitAndWait({
        issueNumber: 630 + i,
        title: `Comment test ${i}`,
        description: `Verify comments for issue ${i}`,
      });
    }

    for (let i = 1; i <= 3; i++) {
      const issue = harness.github.issues.get(String(630 + i));
      assert.ok(issue, `Issue #${630 + i} should exist`);
      assert.ok(issue!.comments.length >= 2, `Issue #${630 + i} should have at least 2 comments`);
    }
  });

  it("code agent is called once per issue", async () => {
    for (let i = 1; i <= 3; i++) {
      await harness.submitAndWait({
        issueNumber: 640 + i,
        title: `Agent call test ${i}`,
        description: `Count agent calls for ${i}`,
      });
    }

    assert.equal(harness.claude.solveCalls.length, 3, "Agent should be called 3 times");
    const titles = harness.claude.solveCalls.map((c) => c.title);
    assert.ok(titles.includes("Agent call test 1"));
    assert.ok(titles.includes("Agent call test 2"));
    assert.ok(titles.includes("Agent call test 3"));
  });

  it("metrics accumulate across all issues", async () => {
    for (let i = 1; i <= 3; i++) {
      await harness.submitAndWait({
        issueNumber: 650 + i,
        title: `Metrics test ${i}`,
        description: `Accumulate metrics ${i}`,
      });
    }

    const completed = harness.metrics.query("tasks.completed");
    assert.ok(completed.length >= 3, "Should have 3+ task completion metrics");
    const prs = harness.metrics.query("prs.created");
    assert.ok(prs.length >= 3, "Should have 3+ PR creation metrics");
  });

  it("knowledge is accumulated from all issues", async () => {
    for (let i = 1; i <= 3; i++) {
      await harness.submitAndWait({
        issueNumber: 660 + i,
        title: `Knowledge test ${i}`,
        description: `Extract knowledge from ${i}`,
      });
    }

    const stats = await harness.knowledge.stats();
    assert.ok(stats.totalEntries >= 3, `Expected 3+ knowledge entries, got ${stats.totalEntries}`);
  });
});
