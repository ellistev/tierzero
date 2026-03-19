/**
 * E2E Integration Test: PR Review with quality gates.
 *
 * Verifies the complete flow:
 *   1. Pipeline with review enabled: clean code -> review passes -> PR merged
 *   2. Pipeline with dirty code (console.log + TODO) -> review blocks -> findings commented
 *   3. Pipeline with "force-merge" label -> review skipped -> PR merged
 *   4. Review score appears in PR comment
 *   5. Notification callback fires on review block
 *
 * Uses mock code agent, mock GitHub, and mock PR creator (no real network calls).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { IssuePipeline, type PipelineConfig, type CodeAgent, type IssueContext, type CodeAgentResult, type PipelineLogger } from "../../src/workflows/issue-pipeline";
import type { Ticket, TicketComment } from "../../src/connectors/types";

// ── Mock GitHub Connector ───────────────────────────────────────────

/** Minimal mock that satisfies what IssuePipeline actually calls. */
class MockGitHub {
  labels: Record<string, string[]> = {};
  comments: Record<string, string[]> = {};

  async addLabels(issueId: string, labels: string[]): Promise<void> {
    this.labels[issueId] = [...(this.labels[issueId] ?? []), ...labels];
  }

  async addComment(issueId: string, body: string): Promise<TicketComment> {
    this.comments[issueId] = [...(this.comments[issueId] ?? []), body];
    return { id: "c1", author: { id: "bot", name: "TierZero" }, body, isInternal: false, createdAt: new Date() };
  }

  async getComments(_issueId: string): Promise<TicketComment[]> {
    return [];
  }
}

// ── Mock Code Agent ─────────────────────────────────────────────────

class MockCodeAgent implements CodeAgent {
  private readonly files: { path: string; content: string }[];

  constructor(files: { path: string; content: string }[]) {
    this.files = files;
  }

  async solve(_issue: IssueContext, _workDir: string): Promise<CodeAgentResult> {
    return {
      summary: "Mock agent changes",
      filesChanged: this.files.map((f) => f.path),
    };
  }

  async fixTests(_failures: string, _workDir: string): Promise<CodeAgentResult> {
    return { summary: "Fixed tests", filesChanged: [] };
  }
}

// ── Mock GitOps (injected via subclass) ─────────────────────────────

interface MockPRComment {
  prNumber: number;
  body: string;
}

interface MockMergeCall {
  prNumber: number;
  method: string;
}

/**
 * We subclass IssuePipeline to override the git/pr operations with mocks
 * since the real ones need a git repo and network access.
 */
class TestableIssuePipeline extends IssuePipeline {
  prComments: MockPRComment[] = [];
  merges: MockMergeCall[] = [];
  createdPRs: { title: string; draft: boolean }[] = [];
  private readonly mockDiff: string;
  private readonly mockChangedFiles: string[];
  private readonly mockHasChanges: boolean;

  constructor(
    config: PipelineConfig,
    opts: {
      mockDiff: string;
      mockChangedFiles: string[];
      mockHasChanges?: boolean;
    },
  ) {
    super(config);
    this.mockDiff = opts.mockDiff;
    this.mockChangedFiles = opts.mockChangedFiles;
    this.mockHasChanges = opts.mockHasChanges ?? true;

    // Override internal git/pr with mocks by accessing private fields
    const self = this as unknown as {
      git: MockableGitOps;
      pr: MockablePRCreator;
    };

    self.git = {
      createBranch: () => {},
      hasChanges: () => this.mockHasChanges,
      commitAll: () => "abc123",
      push: () => {},
      resetToMain: () => {},
      getChangedFiles: () => this.mockChangedFiles,
      getDiff: () => this.mockDiff,
      getCurrentBranch: () => "test-branch",
    } as unknown as MockableGitOps;

    self.pr = {
      createPR: async (opts: { title: string; draft?: boolean }) => {
        this.createdPRs.push({ title: opts.title, draft: opts.draft ?? false });
        return { number: 42, url: "https://github.com/test/test/pull/42", title: opts.title, state: "open" };
      },
      mergePR: async (prNumber: number, method: string) => {
        this.merges.push({ prNumber, method });
      },
      commentOnPR: async (prNumber: number, body: string) => {
        this.prComments.push({ prNumber, body });
      },
    } as unknown as MockablePRCreator;
  }
}

type MockableGitOps = Record<string, unknown>;
type MockablePRCreator = Record<string, unknown>;

// ── Helpers ─────────────────────────────────────────────────────────

function buildDiffText(files: { path: string; lines: string[] }[]): string {
  return files
    .map(
      (f) =>
        [
          `diff --git a/${f.path} b/${f.path}`,
          `--- a/${f.path}`,
          `+++ b/${f.path}`,
          `@@ -0,0 +1,${f.lines.length} @@`,
          ...f.lines.map((l) => `+${l}`),
        ].join("\n"),
    )
    .join("\n");
}

const silentLogger: PipelineLogger = { log: () => {}, error: () => {} };

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "1",
    title: "Test issue",
    description: "Test description",
    source: "github",
    type: "task",
    status: "open",
    priority: "medium",
    reporter: { id: "u1", name: "Test User" },
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    github: new MockGitHub() as unknown as PipelineConfig["github"],
    prConfig: { token: "test", owner: "test", repo: "test" },
    workDir: process.cwd(),
    codeAgent: new MockCodeAgent([]),
    testCommand: "echo tests 1 pass 1 fail 0",
    logger: silentLogger,
    autoMerge: true,
    prReview: {
      enabled: true,
      minScore: 70,
      maxErrors: 0,
      maxWarnings: 5,
      rules: ["no-console-log", "no-todo", "test-coverage", "no-any", "no-secrets"],
    },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("PR Review E2E: quality gates in pipeline", () => {
  it("clean code passes review and gets merged", async () => {
    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/clean.ts", content: "const x = 1;" }]),
    });

    const cleanDiff = buildDiffText([
      { path: "src/clean.ts", lines: ["export function add(a: number, b: number): number {", "  return a + b;", "}"] },
      { path: "src/clean.test.ts", lines: ['import { add } from "./clean";', 'it("adds", () => { add(1,2); });'] },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: cleanDiff,
      mockChangedFiles: ["src/clean.ts", "src/clean.test.ts"],
    });

    const result = await pipeline.run(makeTicket());

    assert.equal(result.status, "success");
    // PR should have been merged
    assert.ok(pipeline.merges.length > 0, "PR should be merged");
    assert.equal(pipeline.merges[0].prNumber, 42);
    // Review comment should be posted
    const reviewComment = pipeline.prComments.find((c) => c.body.includes("TierZero Review:"));
    assert.ok(reviewComment, "Review comment should be posted on PR");
    assert.ok(reviewComment!.body.includes("/100"), "Review comment should include score");
  });

  it("code with console.log and TODO blocks merge, findings posted", async () => {
    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/dirty.ts", content: "" }]),
      prReview: {
        enabled: true,
        minScore: 70,
        maxErrors: 0,
        maxWarnings: 2, // strict: only 2 warnings allowed
        rules: ["no-console-log", "no-todo", "test-coverage"],
      },
    });

    const dirtyDiff = buildDiffText([
      {
        path: "src/dirty.ts",
        lines: [
          'console.log("debug");',
          "// TODO: remove this later",
          "export const x = 1;",
        ],
      },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: dirtyDiff,
      mockChangedFiles: ["src/dirty.ts"],
    });

    const result = await pipeline.run(makeTicket());

    assert.equal(result.status, "partial");
    // PR should NOT be merged
    assert.equal(pipeline.merges.length, 0, "PR should not be merged when review blocks");
    // Findings should be commented on PR
    const findingsComment = pipeline.prComments.find((c) => c.body.includes("BLOCKED"));
    assert.ok(findingsComment, "Findings comment should be posted");
    assert.ok(findingsComment!.body.includes("no-console-log"), "Should mention console.log rule");
    assert.ok(findingsComment!.body.includes("no-todo"), "Should mention TODO rule");
  });

  it("force-merge label bypasses review", async () => {
    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/dirty.ts", content: "" }]),
    });

    const dirtyDiff = buildDiffText([
      {
        path: "src/dirty.ts",
        lines: [
          'console.log("debug");',
          "// TODO: fix",
        ],
      },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: dirtyDiff,
      mockChangedFiles: ["src/dirty.ts"],
    });

    // Ticket with force-merge label
    const ticket = makeTicket({ tags: ["force-merge"] });
    const result = await pipeline.run(ticket);

    assert.equal(result.status, "success");
    // PR should be merged despite dirty code
    assert.ok(pipeline.merges.length > 0, "PR should be merged with force-merge label");
    // No review findings comment
    const findingsComment = pipeline.prComments.find((c) => c.body.includes("BLOCKED"));
    assert.ok(!findingsComment, "No findings comment when force-merge is used");
  });

  it("review score appears in PR comment", async () => {
    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/app.ts", content: "" }]),
      prReview: {
        enabled: true,
        rules: ["no-console-log"],
        maxWarnings: 10, // high threshold so it still approves
      },
    });

    const diff = buildDiffText([
      { path: "src/app.ts", lines: ['console.log("x");', "const y = 2;"] },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: diff,
      mockChangedFiles: ["src/app.ts"],
    });

    const result = await pipeline.run(makeTicket());

    const reviewComment = pipeline.prComments.find((c) => c.body.includes("TierZero Review:"));
    assert.ok(reviewComment, "Review comment with score should be posted");
    assert.ok(reviewComment!.body.includes("95/100"), "Score should be 95 (one warning = -5)");
  });

  it("notification callback fires on review block", async () => {
    let notificationData: { prNumber: number; score: number; findings: number; errors: number } | null = null;

    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/bad.ts", content: "" }]),
      onReviewBlocked: (data) => {
        notificationData = data;
      },
    });

    const diff = buildDiffText([
      { path: "src/bad.ts", lines: ['const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";'] },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: diff,
      mockChangedFiles: ["src/bad.ts"],
    });

    await pipeline.run(makeTicket());

    assert.ok(notificationData, "onReviewBlocked should have been called");
    assert.equal(notificationData!.prNumber, 42);
    assert.ok(notificationData!.errors > 0, "Should have error findings");
    assert.ok(notificationData!.findings > 0, "Should have findings count");
  });

  it("review disabled skips review entirely", async () => {
    const config = makeConfig({
      codeAgent: new MockCodeAgent([{ path: "src/dirty.ts", content: "" }]),
      prReview: { enabled: false },
    });

    const dirtyDiff = buildDiffText([
      { path: "src/dirty.ts", lines: ['console.log("debug");', "// TODO: fix"] },
    ]);

    const pipeline = new TestableIssuePipeline(config, {
      mockDiff: dirtyDiff,
      mockChangedFiles: ["src/dirty.ts"],
    });

    const result = await pipeline.run(makeTicket());

    assert.equal(result.status, "success");
    // Should merge without review
    assert.ok(pipeline.merges.length > 0, "PR should be merged when review is disabled");
    // No review comments at all
    const reviewComment = pipeline.prComments.find((c) => c.body.includes("TierZero Review:"));
    assert.ok(!reviewComment, "No review comment when review is disabled");
  });
});
