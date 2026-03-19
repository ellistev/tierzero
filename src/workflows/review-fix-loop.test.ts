import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IssuePipeline } from "./issue-pipeline";
import type { PRReviewResult } from "./pr-reviewer";

describe("IssuePipeline.buildFixInstructions", () => {
  it("builds correct markdown from findings with all severities", () => {
    const reviewResult: PRReviewResult = {
      approved: false,
      score: 55,
      summary: "Review blocked",
      findings: [
        { severity: "error", file: "src/config.ts", line: 42, rule: "no-secrets", message: "Possible hardcoded API key detected" },
        { severity: "warning", file: "src/router.ts", line: 15, rule: "no-console-log", message: "console.log in production code" },
        { severity: "warning", file: "src/deploy/ssh.ts", rule: "test-coverage", message: "New source file has no test file" },
        { severity: "info", file: "src/index.ts", line: 3, rule: "import-order", message: "node: imports should come first" },
      ],
    };

    const instructions = IssuePipeline.buildFixInstructions(reviewResult);

    assert.ok(instructions.includes("# Review Findings to Fix"));
    assert.ok(instructions.includes("## Errors (must fix)"));
    assert.ok(instructions.includes("**no-secrets** in `src/config.ts:42`"));
    assert.ok(instructions.includes("## Warnings (should fix)"));
    assert.ok(instructions.includes("**no-console-log** in `src/router.ts:15`"));
    assert.ok(instructions.includes("**test-coverage** in `src/deploy/ssh.ts`"));
    assert.ok(instructions.includes("## Info (nice to fix)"));
    assert.ok(instructions.includes("**import-order** in `src/index.ts:3`"));
  });

  it("omits empty severity sections", () => {
    const reviewResult: PRReviewResult = {
      approved: false,
      score: 65,
      summary: "Review blocked",
      findings: [
        { severity: "warning", file: "src/app.ts", line: 10, rule: "no-console-log", message: "console statement found" },
      ],
    };

    const instructions = IssuePipeline.buildFixInstructions(reviewResult);

    assert.ok(instructions.includes("## Warnings (should fix)"));
    assert.ok(!instructions.includes("## Errors (must fix)"));
    assert.ok(!instructions.includes("## Info (nice to fix)"));
  });

  it("handles findings without line numbers", () => {
    const reviewResult: PRReviewResult = {
      approved: false,
      score: 60,
      summary: "Review blocked",
      findings: [
        { severity: "warning", file: "src/utils.ts", rule: "test-coverage", message: "No test file" },
      ],
    };

    const instructions = IssuePipeline.buildFixInstructions(reviewResult);

    assert.ok(instructions.includes("**test-coverage** in `src/utils.ts`"));
    assert.ok(!instructions.includes("src/utils.ts:"));
  });

  it("returns header only for empty findings", () => {
    const reviewResult: PRReviewResult = {
      approved: true,
      score: 100,
      summary: "All good",
      findings: [],
    };

    const instructions = IssuePipeline.buildFixInstructions(reviewResult);

    assert.ok(instructions.includes("# Review Findings to Fix"));
    assert.ok(!instructions.includes("## Errors"));
    assert.ok(!instructions.includes("## Warnings"));
    assert.ok(!instructions.includes("## Info"));
  });
});

describe("Review-fix loop integration", () => {
  // Helper to create a mock pipeline config with controllable review results
  function createMockPipeline(opts: {
    reviewResults: PRReviewResult[];
    testPassed?: boolean;
  }) {
    const logs: string[] = [];
    const comments: Array<{ prNumber: number; body: string }> = [];
    let reviewCallCount = 0;
    let fixReviewCallCount = 0;
    let fixTestsCallCount = 0;
    let commitMessages: string[] = [];
    let pushCount = 0;
    let mergeCount = 0;

    return {
      logs,
      comments,
      get reviewCallCount() { return reviewCallCount; },
      get fixReviewCallCount() { return fixReviewCallCount; },
      get fixTestsCallCount() { return fixTestsCallCount; },
      get commitMessages() { return commitMessages; },
      get pushCount() { return pushCount; },
      get mergeCount() { return mergeCount; },
      reviewResults: opts.reviewResults,
      // Simulate the review-fix loop logic extracted from IssuePipeline
      async runReviewFixLoop(prNumber: number) {
        const maxReviewFixes = 2;
        let reviewAttempts = 0;
        let reviewResult = opts.reviewResults[reviewCallCount++];

        while (!reviewResult.approved && reviewAttempts < maxReviewFixes) {
          reviewAttempts++;
          logs.push(`Review fix attempt ${reviewAttempts}/${maxReviewFixes}`);

          // Post findings
          comments.push({ prNumber, body: `findings-${reviewAttempts}` });

          // Build fix instructions
          const fixInstructions = IssuePipeline.buildFixInstructions(reviewResult);
          assert.ok(fixInstructions.length > 0);
          fixReviewCallCount++;

          // Simulate commit + push
          commitMessages.push(`fix: address review findings (attempt ${reviewAttempts})`);
          pushCount++;

          // Simulate test re-run (always pass unless specified)
          const testPassed = opts.testPassed !== false;
          if (!testPassed) {
            fixTestsCallCount++;
            commitMessages.push(`fix: repair tests after review fix (attempt ${reviewAttempts})`);
            pushCount++;
          }

          // Re-run review
          reviewResult = opts.reviewResults[reviewCallCount++] ?? reviewResult;

          // Post update
          comments.push({
            prNumber,
            body: `## Review Fix Attempt ${reviewAttempts}: ${reviewResult.approved ? "APPROVED" : "Still failing"} (Score: ${reviewResult.score}/100)`,
          });
        }

        if (!reviewResult.approved) {
          // Escalation
          const remaining = reviewResult.findings
            .map((f) => `- **${f.rule}** \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.message}`)
            .join("\n");
          comments.push({
            prNumber,
            body: `## TierZero Review Escalation\n\nTierZero tried ${reviewAttempts} times to fix review findings but couldn't resolve:\n\n${remaining}\n\nPlease review manually.`,
          });
          return { approved: false, status: "partial" as const, attempts: reviewAttempts };
        }

        // Approved
        comments.push({ prNumber, body: `## TierZero Review: ${reviewResult.score}/100` });
        mergeCount++;
        return { approved: true, status: "success" as const, attempts: reviewAttempts };
      },
    };
  }

  it("review fails -> agent fixes -> re-review passes -> merge", async () => {
    const failedReview: PRReviewResult = {
      approved: false,
      score: 55,
      summary: "Blocked",
      findings: [
        { severity: "warning", file: "src/app.ts", line: 10, rule: "no-console-log", message: "console statement found" },
      ],
    };
    const passedReview: PRReviewResult = {
      approved: true,
      score: 95,
      summary: "Approved",
      findings: [],
    };

    const mock = createMockPipeline({ reviewResults: [failedReview, passedReview] });
    const result = await mock.runReviewFixLoop(42);

    assert.equal(result.approved, true);
    assert.equal(result.status, "success");
    assert.equal(result.attempts, 1);
    assert.equal(mock.fixReviewCallCount, 1);
    assert.equal(mock.mergeCount, 1);
    assert.ok(mock.commitMessages[0].includes("attempt 1"));
  });

  it("review fails 3 times -> PR left open with escalation summary", async () => {
    const failedReview: PRReviewResult = {
      approved: false,
      score: 40,
      summary: "Blocked",
      findings: [
        { severity: "error", file: "src/config.ts", line: 5, rule: "no-secrets", message: "Hardcoded API key" },
        { severity: "warning", file: "src/app.ts", line: 10, rule: "no-console-log", message: "console.log found" },
      ],
    };

    // Initial review + 2 re-reviews, all failing
    const mock = createMockPipeline({
      reviewResults: [failedReview, failedReview, failedReview],
    });
    const result = await mock.runReviewFixLoop(42);

    assert.equal(result.approved, false);
    assert.equal(result.status, "partial");
    assert.equal(result.attempts, 2);
    assert.equal(mock.fixReviewCallCount, 2);
    assert.equal(mock.mergeCount, 0);

    // Verify escalation comment was posted
    const escalationComment = mock.comments.find((c) => c.body.includes("TierZero Review Escalation"));
    assert.ok(escalationComment, "Should post escalation comment");
    assert.ok(escalationComment.body.includes("no-secrets"));
    assert.ok(escalationComment.body.includes("no-console-log"));
    assert.ok(escalationComment.body.includes("Please review manually"));
  });

  it("review passes on first try -> no fix loop, direct merge", async () => {
    const passedReview: PRReviewResult = {
      approved: true,
      score: 95,
      summary: "All good",
      findings: [],
    };

    const mock = createMockPipeline({ reviewResults: [passedReview] });
    const result = await mock.runReviewFixLoop(42);

    assert.equal(result.approved, true);
    assert.equal(result.attempts, 0);
    assert.equal(mock.fixReviewCallCount, 0);
    assert.equal(mock.mergeCount, 1);
    assert.equal(mock.commitMessages.length, 0);
  });

  it("review fails -> first fix fails -> second fix succeeds -> merge", async () => {
    const failedReview1: PRReviewResult = {
      approved: false,
      score: 50,
      summary: "Blocked",
      findings: [
        { severity: "warning", file: "src/a.ts", line: 1, rule: "no-console-log", message: "console found" },
        { severity: "warning", file: "src/b.ts", line: 2, rule: "no-todo", message: "TODO found" },
      ],
    };
    const failedReview2: PRReviewResult = {
      approved: false,
      score: 65,
      summary: "Still blocked",
      findings: [
        { severity: "warning", file: "src/b.ts", line: 2, rule: "no-todo", message: "TODO found" },
      ],
    };
    const passedReview: PRReviewResult = {
      approved: true,
      score: 100,
      summary: "Clean",
      findings: [],
    };

    const mock = createMockPipeline({ reviewResults: [failedReview1, failedReview2, passedReview] });
    const result = await mock.runReviewFixLoop(42);

    assert.equal(result.approved, true);
    assert.equal(result.attempts, 2);
    assert.equal(mock.fixReviewCallCount, 2);
    assert.equal(mock.mergeCount, 1);
  });
});

describe("ClaudeCodeAgent.fixReviewFindings interface", () => {
  it("ClaudeCodeAgent has fixReviewFindings method", async () => {
    // Dynamic import to avoid issues with module resolution in test
    const { ClaudeCodeAgent } = await import("./claude-code-agent");
    const agent = new ClaudeCodeAgent();
    assert.equal(typeof agent.fixReviewFindings, "function");
  });
});
