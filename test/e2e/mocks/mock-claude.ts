/**
 * Fake Claude Code agent that creates predictable file changes.
 * Implements the CodeAgent interface without calling any real LLM.
 */

import type { CodeAgent, IssueContext, CodeAgentResult } from "../../../src/workflows/issue-pipeline";

export interface MockClaudeOptions {
  /** Files the agent "creates" on solve */
  solveFiles?: string[];
  /** Whether solve should fail */
  solveShouldFail?: boolean;
  /** Whether fixTests produces passing code */
  fixTestsShouldSucceed?: boolean;
  /** Whether fixReviewFindings produces clean code */
  fixReviewShouldSucceed?: boolean;
  /** Delay in ms to simulate work */
  delayMs?: number;
  /** If set, the agent hangs forever (for timeout tests) */
  hang?: boolean;
}

export class MockClaude implements CodeAgent {
  readonly solveCalls: IssueContext[] = [];
  readonly fixTestsCalls: string[] = [];
  readonly fixReviewCalls: string[] = [];
  private readonly opts: MockClaudeOptions;

  constructor(opts: MockClaudeOptions = {}) {
    this.opts = opts;
  }

  async solve(issue: IssueContext, _workDir: string): Promise<CodeAgentResult> {
    this.solveCalls.push(issue);

    if (this.opts.hang) {
      // Hang forever — tests should use a timeout to detect this
      await new Promise(() => {});
    }

    if (this.opts.delayMs) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }

    if (this.opts.solveShouldFail) {
      throw new Error("Mock Claude failed to solve");
    }

    const files = this.opts.solveFiles ?? ["src/feature.ts", "src/feature.test.ts"];
    return {
      summary: `Implemented: ${issue.title}`,
      filesChanged: files,
    };
  }

  async fixTests(failures: string, _workDir: string): Promise<CodeAgentResult> {
    this.fixTestsCalls.push(failures);

    if (this.opts.delayMs) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }

    if (!this.opts.fixTestsShouldSucceed) {
      return { summary: "Attempted test fix (still failing)", filesChanged: ["src/feature.ts"] };
    }

    return { summary: "Fixed failing tests", filesChanged: ["src/feature.ts"] };
  }

  async fixReviewFindings(instructions: string, _workDir: string): Promise<CodeAgentResult> {
    this.fixReviewCalls.push(instructions);

    if (this.opts.delayMs) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }

    if (!this.opts.fixReviewShouldSucceed) {
      return { summary: "Attempted review fix (issues remain)", filesChanged: [] };
    }

    return { summary: "Fixed review findings", filesChanged: ["src/feature.ts"] };
  }
}
