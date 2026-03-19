import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewPrompt,
  calculateOverallScore,
  determineApproval,
  parseLLMResponse,
  LLMReviewer,
  REVIEW_WEIGHTS,
  APPROVAL_THRESHOLDS,
  type LLMAdapter,
  type LLMReviewResult,
  type ReviewContext,
} from "./llm-reviewer";

// ── Helpers ─────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<ReviewContext>): ReviewContext {
  return {
    dependencies: [],
    similarFiles: [],
    issueContext: {
      title: "Add feature X",
      body: "We need feature X.",
      acceptanceCriteria: ["X works", "Tests pass"],
    },
    testOutput: "tests 5\npass 5\nfail 0",
    ...overrides,
  };
}

function makeApprovedResult(): LLMReviewResult {
  return {
    issueAlignment: { score: 90, missingRequirements: [], extraWork: [] },
    codeQuality: { score: 85, findings: [] },
    testQuality: { score: 80, coverage: "comprehensive", missingTests: [], weakTests: [] },
    architecture: { score: 90, patternsFollowed: true, concerns: [] },
    security: { score: 95, issues: [] },
    overallScore: 88,
    approved: true,
    summary: "Code looks good.",
    suggestedFixes: [],
  };
}

function makeFailedResult(): LLMReviewResult {
  return {
    issueAlignment: { score: 40, missingRequirements: ["Feature X not implemented"], extraWork: [] },
    codeQuality: {
      score: 50,
      findings: [
        { category: "code-quality", severity: "major", file: "src/app.ts", line: 10, message: "Logic bug in handler" },
      ],
    },
    testQuality: { score: 30, coverage: "smoke", missingTests: ["Error case not tested"], weakTests: ["Test only checks existence"] },
    architecture: { score: 60, patternsFollowed: false, concerns: ["Wrong pattern used"] },
    security: { score: 80, issues: [] },
    overallScore: 48,
    approved: false,
    summary: "Several issues found.",
    suggestedFixes: ["Fix the logic bug", "Add error handling"],
  };
}

// ── buildReviewPrompt ───────────────────────────────────────────────

describe("buildReviewPrompt", () => {
  it("includes issue context in the prompt", () => {
    const context = makeContext();
    const { user } = buildReviewPrompt("+const x = 1;", context);

    assert.ok(user.includes("Add feature X"));
    assert.ok(user.includes("We need feature X."));
    assert.ok(user.includes("X works"));
    assert.ok(user.includes("Tests pass"));
  });

  it("includes diff in the prompt", () => {
    const context = makeContext();
    const diff = "+const newFeature = true;";
    const { user } = buildReviewPrompt(diff, context);

    assert.ok(user.includes("const newFeature = true;"));
    assert.ok(user.includes("## Diff"));
  });

  it("includes test output in the prompt", () => {
    const context = makeContext({ testOutput: "tests 10\npass 9\nfail 1" });
    const { user } = buildReviewPrompt("+x", context);

    assert.ok(user.includes("tests 10"));
    assert.ok(user.includes("fail 1"));
    assert.ok(user.includes("## Test Output"));
  });

  it("includes dependency files when present", () => {
    const context = makeContext({
      dependencies: [{ path: "src/utils.ts", content: "export function helper() {}" }],
    });
    const { user } = buildReviewPrompt("+x", context);

    assert.ok(user.includes("## Dependency Files"));
    assert.ok(user.includes("src/utils.ts"));
    assert.ok(user.includes("export function helper()"));
  });

  it("includes similar files when present", () => {
    const context = makeContext({
      similarFiles: [{ path: "src/connectors/github.ts", content: "class GitHub {}" }],
    });
    const { user } = buildReviewPrompt("+x", context);

    assert.ok(user.includes("## Similar Files"));
    assert.ok(user.includes("src/connectors/github.ts"));
  });

  it("includes review instructions", () => {
    const context = makeContext();
    const { user } = buildReviewPrompt("+x", context);

    assert.ok(user.includes("## Review Instructions"));
    assert.ok(user.includes("logic bugs"));
    assert.ok(user.includes("error handling"));
    assert.ok(user.includes("race conditions"));
  });

  it("system prompt requests JSON response", () => {
    const context = makeContext();
    const { system } = buildReviewPrompt("+x", context);

    assert.ok(system.includes("JSON"));
    assert.ok(system.includes("issueAlignment"));
    assert.ok(system.includes("codeQuality"));
    assert.ok(system.includes("testQuality"));
    assert.ok(system.includes("architecture"));
    assert.ok(system.includes("security"));
  });
});

// ── calculateOverallScore ──────────────────────────────────────────

describe("calculateOverallScore", () => {
  it("calculates weighted average from category scores", () => {
    const result = {
      issueAlignment: { score: 100, missingRequirements: [], extraWork: [] },
      codeQuality: { score: 100, findings: [] },
      testQuality: { score: 100, coverage: "comprehensive" as const, missingTests: [], weakTests: [] },
      architecture: { score: 100, patternsFollowed: true, concerns: [] },
      security: { score: 100, issues: [] },
    };
    assert.equal(calculateOverallScore(result), 100);
  });

  it("applies correct weights", () => {
    const result = {
      issueAlignment: { score: 80, missingRequirements: [], extraWork: [] },
      codeQuality: { score: 60, findings: [] },
      testQuality: { score: 40, coverage: "smoke" as const, missingTests: [], weakTests: [] },
      architecture: { score: 70, patternsFollowed: true, concerns: [] },
      security: { score: 90, issues: [] },
    };

    const expected = Math.round(
      80 * 0.30 + 60 * 0.25 + 40 * 0.20 + 70 * 0.15 + 90 * 0.10,
    );
    assert.equal(calculateOverallScore(result), expected);
  });

  it("clamps to 0-100 range", () => {
    const result = {
      issueAlignment: { score: 0, missingRequirements: [], extraWork: [] },
      codeQuality: { score: 0, findings: [] },
      testQuality: { score: 0, coverage: "none" as const, missingTests: [], weakTests: [] },
      architecture: { score: 0, patternsFollowed: false, concerns: [] },
      security: { score: 0, issues: [] },
    };
    assert.equal(calculateOverallScore(result), 0);
  });

  it("weights sum to 1.0", () => {
    const sum = Object.values(REVIEW_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001);
  });
});

// ── determineApproval ──────────────────────────────────────────────

describe("determineApproval", () => {
  it("approves when all thresholds met", () => {
    const result = makeApprovedResult();
    result.overallScore = 88;
    assert.equal(determineApproval(result), true);
  });

  it("rejects when overall score below threshold", () => {
    const result = makeApprovedResult();
    result.overallScore = 60;
    assert.equal(determineApproval(result), false);
  });

  it("rejects when issue alignment below threshold", () => {
    const result = makeApprovedResult();
    result.issueAlignment.score = 50;
    result.overallScore = 75;
    assert.equal(determineApproval(result), false);
  });

  it("rejects when critical security finding in codeQuality", () => {
    const result = makeApprovedResult();
    result.codeQuality.findings = [
      { category: "security", severity: "critical", message: "SQL injection vulnerability" },
    ];
    assert.equal(determineApproval(result), false);
  });

  it("rejects when critical keyword in security issues", () => {
    const result = makeApprovedResult();
    result.security.issues = ["Critical: Hardcoded credentials found"];
    assert.equal(determineApproval(result), false);
  });

  it("approves with non-critical security issues", () => {
    const result = makeApprovedResult();
    result.security.issues = ["Minor: Consider adding input validation"];
    assert.equal(determineApproval(result), true);
  });
});

// ── parseLLMResponse ───────────────────────────────────────────────

describe("parseLLMResponse", () => {
  it("parses a valid JSON response", () => {
    const json = JSON.stringify({
      issueAlignment: { score: 85, missingRequirements: ["X"], extraWork: [] },
      codeQuality: { score: 90, findings: [] },
      testQuality: { score: 70, coverage: "partial", missingTests: ["test Y"], weakTests: [] },
      architecture: { score: 80, patternsFollowed: true, concerns: [] },
      security: { score: 95, issues: [] },
      summary: "Looks good overall",
      suggestedFixes: ["Add test for Y"],
    });

    const result = parseLLMResponse(json);
    assert.equal(result.issueAlignment.score, 85);
    assert.deepEqual(result.issueAlignment.missingRequirements, ["X"]);
    assert.equal(result.codeQuality.score, 90);
    assert.equal(result.testQuality.coverage, "partial");
    assert.deepEqual(result.testQuality.missingTests, ["test Y"]);
    assert.equal(result.architecture.patternsFollowed, true);
    assert.equal(result.security.score, 95);
    assert.equal(result.summary, "Looks good overall");
    assert.deepEqual(result.suggestedFixes, ["Add test for Y"]);
    assert.ok(result.overallScore > 0);
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const json = "```json\n" + JSON.stringify({
      issueAlignment: { score: 80, missingRequirements: [], extraWork: [] },
      codeQuality: { score: 80, findings: [] },
      testQuality: { score: 80, coverage: "partial", missingTests: [], weakTests: [] },
      architecture: { score: 80, patternsFollowed: true, concerns: [] },
      security: { score: 80, issues: [] },
      summary: "OK",
      suggestedFixes: [],
    }) + "\n```";

    const result = parseLLMResponse(json);
    assert.equal(result.issueAlignment.score, 80);
    assert.ok(result.overallScore > 0);
  });

  it("returns empty result for completely invalid response", () => {
    const result = parseLLMResponse("This is not JSON at all");
    assert.equal(result.overallScore, 0);
    assert.equal(result.approved, false);
    assert.ok(result.summary.includes("failed"));
  });

  it("clamps scores to 0-100 range", () => {
    const json = JSON.stringify({
      issueAlignment: { score: 150, missingRequirements: [], extraWork: [] },
      codeQuality: { score: -10, findings: [] },
      testQuality: { score: 200, coverage: "comprehensive", missingTests: [], weakTests: [] },
      architecture: { score: 80, patternsFollowed: true, concerns: [] },
      security: { score: 90, issues: [] },
      summary: "Weird scores",
      suggestedFixes: [],
    });

    const result = parseLLMResponse(json);
    assert.equal(result.issueAlignment.score, 100);
    assert.equal(result.codeQuality.score, 0);
    assert.equal(result.testQuality.score, 100);
  });

  it("handles missing fields gracefully", () => {
    const json = JSON.stringify({
      issueAlignment: { score: 70 },
      summary: "Partial response",
    });

    const result = parseLLMResponse(json);
    assert.equal(result.issueAlignment.score, 70);
    assert.deepEqual(result.issueAlignment.missingRequirements, []);
    assert.equal(result.codeQuality.score, 0);
    assert.equal(result.testQuality.coverage, "none");
    assert.equal(result.summary, "Partial response");
  });

  it("parses findings with all fields", () => {
    const json = JSON.stringify({
      issueAlignment: { score: 80, missingRequirements: [], extraWork: [] },
      codeQuality: {
        score: 70,
        findings: [
          { category: "code-quality", severity: "major", file: "src/app.ts", line: 42, message: "Bug here", suggestedFix: "Fix it" },
          { category: "security", severity: "critical", message: "Injection vuln" },
        ],
      },
      testQuality: { score: 80, coverage: "partial", missingTests: [], weakTests: [] },
      architecture: { score: 80, patternsFollowed: true, concerns: [] },
      security: { score: 80, issues: [] },
      summary: "Issues found",
      suggestedFixes: [],
    });

    const result = parseLLMResponse(json);
    assert.equal(result.codeQuality.findings.length, 2);
    assert.equal(result.codeQuality.findings[0].file, "src/app.ts");
    assert.equal(result.codeQuality.findings[0].line, 42);
    assert.equal(result.codeQuality.findings[0].suggestedFix, "Fix it");
    assert.equal(result.codeQuality.findings[1].category, "security");
    assert.equal(result.codeQuality.findings[1].file, undefined);
  });

  it("extracts JSON from text with surrounding prose", () => {
    const response = 'Here is my review:\n\n{"issueAlignment":{"score":75,"missingRequirements":[],"extraWork":[]},"codeQuality":{"score":80,"findings":[]},"testQuality":{"score":70,"coverage":"partial","missingTests":[],"weakTests":[]},"architecture":{"score":85,"patternsFollowed":true,"concerns":[]},"security":{"score":90,"issues":[]},"summary":"Decent","suggestedFixes":[]}\n\nLet me know if you need more details.';

    const result = parseLLMResponse(response);
    assert.equal(result.issueAlignment.score, 75);
    assert.equal(result.summary, "Decent");
  });
});

// ── LLMReviewer class ──────────────────────────────────────────────

describe("LLMReviewer", () => {
  it("calls LLM adapter and returns parsed result", async () => {
    const mockResponse = JSON.stringify({
      issueAlignment: { score: 85, missingRequirements: [], extraWork: [] },
      codeQuality: { score: 80, findings: [] },
      testQuality: { score: 75, coverage: "partial", missingTests: [], weakTests: [] },
      architecture: { score: 90, patternsFollowed: true, concerns: [] },
      security: { score: 95, issues: [] },
      summary: "Code looks good",
      suggestedFixes: [],
    });

    let capturedSystem = "";
    let capturedUser = "";
    const mockAdapter: LLMAdapter = {
      async chat(system: string, user: string) {
        capturedSystem = system;
        capturedUser = user;
        return mockResponse;
      },
    };

    const reviewer = new LLMReviewer(mockAdapter);
    const context = makeContext();
    const result = await reviewer.review("+const x = 1;", context);

    assert.equal(result.issueAlignment.score, 85);
    assert.ok(result.overallScore > 0);
    assert.ok(result.approved);
    assert.ok(capturedSystem.includes("JSON"));
    assert.ok(capturedUser.includes("Add feature X"));
  });

  it("handles LLM returning invalid JSON gracefully", async () => {
    const mockAdapter: LLMAdapter = {
      async chat() { return "I cannot review this code."; },
    };

    const reviewer = new LLMReviewer(mockAdapter);
    const result = await reviewer.review("+x", makeContext());

    assert.equal(result.approved, false);
    assert.equal(result.overallScore, 0);
  });
});

// ── LLMReviewer.formatReviewComment ────────────────────────────────

describe("LLMReviewer.formatReviewComment", () => {
  it("formats approved result", () => {
    const result = makeApprovedResult();
    const comment = LLMReviewer.formatReviewComment(result);

    assert.ok(comment.includes("APPROVED"));
    assert.ok(comment.includes("88/100"));
    assert.ok(comment.includes("Issue Alignment"));
    assert.ok(comment.includes("Code Quality"));
    assert.ok(comment.includes("Test Quality"));
  });

  it("formats failed result with all sections", () => {
    const result = makeFailedResult();
    const comment = LLMReviewer.formatReviewComment(result);

    assert.ok(comment.includes("CHANGES REQUESTED"));
    assert.ok(comment.includes("Missing Requirements"));
    assert.ok(comment.includes("Feature X not implemented"));
    assert.ok(comment.includes("Code Findings"));
    assert.ok(comment.includes("Logic bug"));
    assert.ok(comment.includes("Missing Tests"));
    assert.ok(comment.includes("Weak Tests"));
    assert.ok(comment.includes("Architecture Concerns"));
    assert.ok(comment.includes("Suggested Fixes"));
  });
});

// ── LLMReviewer.buildFixInstructions ───────────────────────────────

describe("LLMReviewer.buildFixInstructions", () => {
  it("builds fix instructions from failed review", () => {
    const result = makeFailedResult();
    const instructions = LLMReviewer.buildFixInstructions(result);

    assert.ok(instructions.includes("# LLM Review Findings to Fix"));
    assert.ok(instructions.includes("Missing Requirements"));
    assert.ok(instructions.includes("Feature X not implemented"));
    assert.ok(instructions.includes("Code Quality Findings"));
    assert.ok(instructions.includes("Logic bug"));
    assert.ok(instructions.includes("Missing Tests"));
    assert.ok(instructions.includes("Specific Fixes"));
    assert.ok(instructions.includes("Fix the logic bug"));
  });

  it("omits empty sections", () => {
    const result = makeApprovedResult();
    const instructions = LLMReviewer.buildFixInstructions(result);

    assert.ok(instructions.includes("# LLM Review Findings to Fix"));
    assert.ok(!instructions.includes("Missing Requirements"));
    assert.ok(!instructions.includes("Security Issues"));
  });
});

// ── Fix loop integration ───────────────────────────────────────────

describe("LLM review fix loop integration", () => {
  it("review fails -> fix -> re-review approves on second pass", async () => {
    let callCount = 0;
    const responses = [
      // First review: fails
      JSON.stringify({
        issueAlignment: { score: 50, missingRequirements: ["Missing feature X"], extraWork: [] },
        codeQuality: { score: 60, findings: [{ category: "code-quality", severity: "major", message: "Bug" }] },
        testQuality: { score: 40, coverage: "smoke", missingTests: ["Need error test"], weakTests: [] },
        architecture: { score: 70, patternsFollowed: true, concerns: [] },
        security: { score: 90, issues: [] },
        summary: "Needs work",
        suggestedFixes: ["Add feature X", "Fix bug"],
      }),
      // Second review: passes
      JSON.stringify({
        issueAlignment: { score: 90, missingRequirements: [], extraWork: [] },
        codeQuality: { score: 85, findings: [] },
        testQuality: { score: 80, coverage: "comprehensive", missingTests: [], weakTests: [] },
        architecture: { score: 85, patternsFollowed: true, concerns: [] },
        security: { score: 95, issues: [] },
        summary: "All issues resolved",
        suggestedFixes: [],
      }),
    ];

    const mockAdapter: LLMAdapter = {
      async chat() { return responses[callCount++]; },
    };

    const reviewer = new LLMReviewer(mockAdapter);
    const context = makeContext();

    // First review
    const firstResult = await reviewer.review("+buggy code", context);
    assert.equal(firstResult.approved, false);
    assert.ok(firstResult.overallScore < 70);

    // Build fix instructions
    const fixInstructions = LLMReviewer.buildFixInstructions(firstResult);
    assert.ok(fixInstructions.includes("Missing feature X"));

    // Second review (after agent fixes)
    const secondResult = await reviewer.review("+fixed code", context);
    assert.equal(secondResult.approved, true);
    assert.ok(secondResult.overallScore >= 70);
  });
});

// ── Pipeline integration with deepReview ───────────────────────────

describe("PRReviewer.deepReview integration", () => {
  it("runs static rules + LLM review when useLLM is true", async () => {
    const { PRReviewer } = await import("./pr-reviewer");

    const mockAdapter: LLMAdapter = {
      async chat() {
        return JSON.stringify({
          issueAlignment: { score: 90, missingRequirements: [], extraWork: [] },
          codeQuality: { score: 85, findings: [] },
          testQuality: { score: 80, coverage: "comprehensive", missingTests: [], weakTests: [] },
          architecture: { score: 90, patternsFollowed: true, concerns: [] },
          security: { score: 95, issues: [] },
          summary: "Code looks good",
          suggestedFixes: [],
        });
      },
    };

    const reviewer = new PRReviewer({
      useLLM: true,
      llmAdapter: mockAdapter,
      rules: ["no-console-log"],
    });

    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -0,0 +1 @@",
      "+const x = 1;",
    ].join("\n");

    const result = await reviewer.deepReview(diff, ["src/app.ts"], {
      workDir: "/fake",
      issueTitle: "Test",
      issueBody: "Test body",
      testOutput: "tests 1\npass 1\nfail 0",
    });

    assert.ok(result.llmReview);
    assert.equal(result.llmReview.issueAlignment.score, 90);
    assert.ok(result.approved);
    assert.ok(result.summary.includes("LLM Deep Review"));
  });

  it("falls back to static-only when useLLM is false", async () => {
    const { PRReviewer } = await import("./pr-reviewer");

    const reviewer = new PRReviewer({
      useLLM: false,
      rules: ["no-console-log"],
    });

    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -0,0 +1 @@",
      "+const x = 1;",
    ].join("\n");

    const result = await reviewer.deepReview(diff, ["src/app.ts"], {
      workDir: "/fake",
      issueTitle: "Test",
      issueBody: "Test body",
      testOutput: "",
    });

    assert.equal(result.llmReview, undefined);
    assert.equal(result.score, 100);
  });

  it("both static and LLM must approve for overall approval", async () => {
    const { PRReviewer } = await import("./pr-reviewer");

    // LLM approves but static blocks (secret found)
    const mockAdapter: LLMAdapter = {
      async chat() {
        return JSON.stringify({
          issueAlignment: { score: 90, missingRequirements: [], extraWork: [] },
          codeQuality: { score: 85, findings: [] },
          testQuality: { score: 80, coverage: "comprehensive", missingTests: [], weakTests: [] },
          architecture: { score: 90, patternsFollowed: true, concerns: [] },
          security: { score: 95, issues: [] },
          summary: "Looks good",
          suggestedFixes: [],
        });
      },
    };

    const reviewer = new PRReviewer({
      useLLM: true,
      llmAdapter: mockAdapter,
      maxErrors: 0,
      rules: ["no-secrets"],
    });

    const diff = [
      "diff --git a/src/config.ts b/src/config.ts",
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -0,0 +1 @@",
      '+const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";',
    ].join("\n");

    const result = await reviewer.deepReview(diff, ["src/config.ts"], {
      workDir: "/fake",
      issueTitle: "Test",
      issueBody: "Test",
      testOutput: "",
    });

    // Static blocked (secret), so overall should be blocked even though LLM approved
    assert.equal(result.approved, false);
    assert.ok(result.llmReview);
    assert.ok(result.llmReview.approved);
  });
});
