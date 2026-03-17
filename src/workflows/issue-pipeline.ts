/**
 * Issue-to-PR Pipeline.
 * 
 * Takes a GitHub issue, plans work, executes code changes,
 * runs tests, and creates a PR. The actual code generation
 * is delegated to an LLM-based code agent (pluggable).
 */

import { GitOps } from "./git-ops";
import { PRCreator, type PRCreatorConfig } from "./pr-creator";
import type { GitHubConnector } from "../connectors/github";
import type { Ticket } from "../connectors/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** GitHub connector for issue updates */
  github: GitHubConnector;
  /** PR creator config */
  prConfig: PRCreatorConfig;
  /** Working directory (git repo root) */
  workDir: string;
  /** Label to add when work starts */
  inProgressLabel?: string;
  /** Label to add when PR is created */
  prCreatedLabel?: string;
  /** Code agent - the thing that actually writes code */
  codeAgent: CodeAgent;
  /** Test command (default: "npm test") */
  testCommand?: string;
  /** Max test retries on failure */
  maxTestRetries?: number;
  /** Logger */
  logger?: PipelineLogger;
}

export interface PipelineLogger {
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export interface PipelineResult {
  issueNumber: number;
  branch: string;
  prNumber?: number;
  prUrl?: string;
  status: "success" | "failed" | "partial";
  summary: string;
  testsRun: number;
  testsPassed: number;
  filesChanged: string[];
  error?: string;
}

/**
 * A CodeAgent writes code to solve an issue.
 * This is the pluggable part - could be Claude Code, GPT, local LLM, etc.
 */
export interface CodeAgent {
  /**
   * Given an issue and the project directory, make code changes.
   * Returns a summary of what was done.
   */
  solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult>;

  /**
   * Given test failures, attempt to fix the code.
   * Returns updated summary.
   */
  fixTests(failures: string, workDir: string): Promise<CodeAgentResult>;
}

export interface IssueContext {
  number: number;
  title: string;
  description: string;
  comments: string[];
  labels: string[];
}

export interface CodeAgentResult {
  summary: string;
  filesChanged: string[];
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

export interface TestResult {
  passed: boolean;
  total: number;
  passing: number;
  failing: number;
  output: string;
}

export function parseTestOutput(output: string): TestResult {
  // Parse node:test output format
  const totalMatch = output.match(/tests\s+(\d+)/i);
  const passMatch = output.match(/pass\s+(\d+)/i);
  const failMatch = output.match(/fail\s+(\d+)/i);

  const total = totalMatch ? parseInt(totalMatch[1]) : 0;
  const passing = passMatch ? parseInt(passMatch[1]) : 0;
  const failing = failMatch ? parseInt(failMatch[1]) : 0;

  return {
    passed: failing === 0 && total > 0,
    total,
    passing,
    failing,
    output,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const defaultLogger: PipelineLogger = {
  log: (msg: string) => console.log(`[pipeline] ${msg}`),
  error: (msg: string) => console.error(`[pipeline] ${msg}`),
};

export class IssuePipeline {
  private readonly config: PipelineConfig;
  private readonly git: GitOps;
  private readonly pr: PRCreator;
  private readonly logger: PipelineLogger;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.git = new GitOps({ cwd: config.workDir });
    this.pr = new PRCreator(config.prConfig);
    this.logger = config.logger ?? defaultLogger;
  }

  /**
   * Run the full pipeline for a single issue.
   */
  async run(ticket: Ticket): Promise<PipelineResult> {
    const issueNumber = parseInt(ticket.id);
    const branch = GitOps.branchName(issueNumber, ticket.title);
    const result: PipelineResult = {
      issueNumber,
      branch,
      status: "failed",
      summary: "",
      testsRun: 0,
      testsPassed: 0,
      filesChanged: [],
    };

    try {
      // 1. Update issue status
      this.logger.log(`Starting work on #${issueNumber}: ${ticket.title}`);
      if (this.config.inProgressLabel) {
        await this.config.github.addLabels(ticket.id, [this.config.inProgressLabel]);
      }
      await this.config.github.addComment(
        ticket.id,
        `TierZero is working on this issue. Branch: \`${branch}\``
      );

      // 2. Create branch
      this.logger.log(`Creating branch: ${branch}`);
      this.git.createBranch(branch);

      // 3. Gather issue context
      const comments = await this.config.github.getComments(ticket.id);
      const issueContext: IssueContext = {
        number: issueNumber,
        title: ticket.title,
        description: ticket.description,
        comments: comments.map((c) => `${c.author.name}: ${c.body}`),
        labels: ticket.tags ?? [],
      };

      // 4. Run code agent
      this.logger.log("Running code agent...");
      const agentResult = await this.config.codeAgent.solve(issueContext, this.config.workDir);
      result.summary = agentResult.summary;
      result.filesChanged = agentResult.filesChanged;

      // 5. Run tests
      const testCmd = this.config.testCommand ?? "npm test";
      const maxRetries = this.config.maxTestRetries ?? 2;
      let testResult = await this.runTests(testCmd);
      let retries = 0;

      while (!testResult.passed && retries < maxRetries) {
        this.logger.log(`Tests failed (${testResult.failing} failures). Retry ${retries + 1}/${maxRetries}...`);
        const fixResult = await this.config.codeAgent.fixTests(testResult.output, this.config.workDir);
        result.summary += `\n\nFix attempt ${retries + 1}: ${fixResult.summary}`;
        result.filesChanged = [...new Set([...result.filesChanged, ...fixResult.filesChanged])];
        testResult = await this.runTests(testCmd);
        retries++;
      }

      result.testsRun = testResult.total;
      result.testsPassed = testResult.passing;

      // 6. Commit and push
      if (!this.git.hasChanges() && result.filesChanged.length === 0) {
        result.status = "failed";
        result.error = "No code changes were made";
        await this.config.github.addComment(ticket.id, "TierZero couldn't produce code changes for this issue.");
        this.git.resetToMain();
        return result;
      }

      if (this.git.hasChanges()) {
        this.logger.log("Committing changes...");
        this.git.commitAll(`feat: ${ticket.title} (closes #${issueNumber})`);
      }

      this.logger.log(`Pushing branch ${branch}...`);
      this.git.push(branch);

      // 7. Create PR
      this.logger.log("Creating pull request...");
      const prBody = PRCreator.buildPRBody({
        issueNumber,
        summary: result.summary,
        filesChanged: this.git.getChangedFiles(),
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
      });

      const prResult = await this.pr.createPR({
        title: `${ticket.title} (#${issueNumber})`,
        body: prBody,
        head: branch,
        draft: !testResult.passed, // Draft if tests aren't green
      });

      result.prNumber = prResult.number;
      result.prUrl = prResult.url;
      result.status = testResult.passed ? "success" : "partial";

      // 8. Update issue
      const statusEmoji = testResult.passed ? "✅" : "⚠️";
      await this.config.github.addComment(
        ticket.id,
        `${statusEmoji} PR created: ${prResult.url}\n\nTests: ${result.testsPassed}/${result.testsRun} passing\n\n${result.summary}`
      );

      if (this.config.prCreatedLabel) {
        await this.config.github.addLabels(ticket.id, [this.config.prCreatedLabel]);
      }

      this.logger.log(`Done! PR #${prResult.number}: ${prResult.url}`);

    } catch (err) {
      result.status = "failed";
      result.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pipeline failed for #${issueNumber}: ${result.error}`);

      try {
        await this.config.github.addComment(
          ticket.id,
          `TierZero encountered an error:\n\`\`\`\n${result.error}\n\`\`\``
        );
      } catch {
        // Best effort
      }
    } finally {
      // Always return to main
      try {
        this.git.resetToMain();
      } catch {
        // May fail if we never left main
      }
    }

    return result;
  }

  private async runTests(command: string): Promise<TestResult> {
    const { execSync } = await import("node:child_process");
    try {
      const output = execSync(command, {
        cwd: this.config.workDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 120_000,
      });
      return parseTestOutput(output);
    } catch (err: unknown) {
      const output = (err as { stdout?: string; stderr?: string }).stdout ?? "";
      const stderr = (err as { stderr?: string }).stderr ?? "";
      return parseTestOutput(output + "\n" + stderr);
    }
  }
}
