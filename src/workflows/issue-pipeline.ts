/**
 * Issue-to-PR Pipeline.
 * 
 * Takes a GitHub issue, plans work, executes code changes,
 * runs tests, and creates a PR. The actual code generation
 * is delegated to an LLM-based code agent (pluggable).
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { GitOps } from "./git-ops";
import { PRCreator, type PRCreatorConfig } from "./pr-creator";
import type { GitHubConnector } from "../connectors/github";
import type { Ticket } from "../connectors/types";
import { IssuePipelineAggregate } from "../domain/issue-pipeline/IssuePipelineAggregate";
import { StartPipeline, CompleteAgentWork, RecordTestRun, RecordTestFix, CreatePR, CompletePipeline, FailPipeline } from "../domain/issue-pipeline/commands";
import type { IEventStore, ESEventData } from "../infra/interfaces";

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
  /** Event store for pipeline audit trail */
  eventStore?: IEventStore;
  /** Auto-merge PRs when tests pass (default: false) */
  autoMerge?: boolean;
  /** Merge method (default: "squash") */
  mergeMethod?: "merge" | "squash" | "rebase";
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
// Streaming subprocess helper
// ---------------------------------------------------------------------------

export interface SpawnStreamingOpts {
  cwd?: string;
  timeout?: number;
  onData?: (chunk: string) => void;
}

/**
 * Spawn a command, stream stdout/stderr to a callback in real-time,
 * and return the collected output when complete.
 */
export function spawnStreaming(
  command: string,
  args: string[],
  opts: SpawnStreamingOpts = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    const chunks: string[] = [];
    const onData = opts.onData ?? ((chunk: string) => process.stdout.write(chunk));

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Command timed out after ${opts.timeout}ms`));
      }, opts.timeout);
    }

    child.stdout.on("data", (buf: Buffer) => {
      const text = buf.toString();
      chunks.push(text);
      onData(text);
    });

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      chunks.push(text);
      onData(text);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const output = chunks.join("");
      if (code !== 0) {
        const err = Object.assign(
          new Error(`Command exited with code ${code}`),
          { stdout: output, stderr: "", code },
        );
        reject(err);
      } else {
        resolve(output);
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
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
  private readonly eventStore: IEventStore | null;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.git = new GitOps({ cwd: config.workDir });
    this.pr = new PRCreator(config.prConfig);
    this.logger = config.logger ?? defaultLogger;
    this.eventStore = config.eventStore ?? null;
  }

  private async emitEvents(streamId: string, aggregate: IssuePipelineAggregate, events: unknown[]): Promise<void> {
    for (const event of events) {
      aggregate.hydrate(event);
    }
    if (this.eventStore) {
      const esEvents: ESEventData[] = events.map((e) => ({
        eventId: randomUUID(),
        eventType: (e as { constructor: { type: string } }).constructor.type,
        data: e,
        metadata: { timestamp: Date.now() },
      }));
      await this.eventStore.appendToStream(streamId, esEvents, this.eventStore.EXPECT_ANY);
    }
  }

  /**
   * Run the full pipeline for a single issue.
   */
  async run(ticket: Ticket): Promise<PipelineResult> {
    const issueNumber = parseInt(ticket.id);
    const branch = GitOps.branchName(issueNumber, ticket.title);
    const pipelineId = randomUUID();
    const streamId = `IssuePipeline-${pipelineId}`;
    const aggregate = new IssuePipelineAggregate();
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
      // 1. Start pipeline + update issue status
      this.logger.log(`Starting work on #${issueNumber}: ${ticket.title}`);
      const startEvents = aggregate.execute(
        new StartPipeline(pipelineId, issueNumber, ticket.title, branch, new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, startEvents);

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

      const agentEvents = aggregate.execute(
        new CompleteAgentWork(pipelineId, agentResult.summary, agentResult.filesChanged, new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, agentEvents);

      // 5. Run tests
      const testCmd = this.config.testCommand ?? "npm test";
      const maxRetries = this.config.maxTestRetries ?? 2;
      let testResult = await this.runTests(testCmd);
      let retries = 0;

      const testEvents = aggregate.execute(
        new RecordTestRun(pipelineId, testResult.passed, testResult.total, testResult.passing, testResult.failing, 1, new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, testEvents);

      while (!testResult.passed && retries < maxRetries) {
        this.logger.log(`Tests failed (${testResult.failing} failures). Retry ${retries + 1}/${maxRetries}...`);
        const fixResult = await this.config.codeAgent.fixTests(testResult.output, this.config.workDir);
        result.summary += `\n\nFix attempt ${retries + 1}: ${fixResult.summary}`;
        result.filesChanged = [...new Set([...result.filesChanged, ...fixResult.filesChanged])];

        const fixEvents = aggregate.execute(
          new RecordTestFix(pipelineId, retries + 1, fixResult.summary, fixResult.filesChanged, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, fixEvents);

        testResult = await this.runTests(testCmd);
        retries++;

        const retryTestEvents = aggregate.execute(
          new RecordTestRun(pipelineId, testResult.passed, testResult.total, testResult.passing, testResult.failing, retries + 1, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, retryTestEvents);
      }

      result.testsRun = testResult.total;
      result.testsPassed = testResult.passing;

      // 6. Commit and push
      if (!this.git.hasChanges() && result.filesChanged.length === 0) {
        result.status = "failed";
        result.error = "No code changes were made";

        const failEvents = aggregate.execute(
          new FailPipeline(pipelineId, result.error, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, failEvents);

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

      const prEvents = aggregate.execute(
        new CreatePR(pipelineId, prResult.number, prResult.url, !testResult.passed, new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, prEvents);

      const completeEvents = aggregate.execute(
        new CompletePipeline(pipelineId, result.status as "success" | "partial", new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, completeEvents);

      // 8. Auto-merge if enabled and tests pass
      if (this.config.autoMerge && testResult.passed && prResult.number) {
        this.logger.log(`Auto-merging PR #${prResult.number}...`);
        try {
          await this.pr.mergePR(prResult.number, this.config.mergeMethod ?? "squash");
          this.logger.log(`PR #${prResult.number} merged successfully`);

          // Pull latest main after merge
          this.git.resetToMain();
        } catch (mergeErr) {
          this.logger.error(`Auto-merge failed: ${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}`);
        }
      }

      // 9. Update issue
      const statusEmoji = testResult.passed ? "✅" : "⚠️";
      const mergeStatus = this.config.autoMerge && testResult.passed ? " (auto-merged)" : "";
      await this.config.github.addComment(
        ticket.id,
        `${statusEmoji} PR created: ${prResult.url}${mergeStatus}\n\nTests: ${result.testsPassed}/${result.testsRun} passing\n\n${result.summary}`
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
        const failEvents = aggregate.execute(
          new FailPipeline(pipelineId, result.error, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, failEvents);
      } catch {
        // Best effort - aggregate may not be in a valid state to accept FailPipeline
      }

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
    const [cmd, ...args] = command.split(/\s+/);
    try {
      const output = await spawnStreaming(cmd, args, {
        cwd: this.config.workDir,
        timeout: 120_000,
        onData: (chunk) => {
          for (const line of chunk.split("\n").filter(Boolean)) {
            this.logger.log(`  ${line}`);
          }
        },
      });
      return parseTestOutput(output);
    } catch (err: unknown) {
      const output = (err as { stdout?: string }).stdout ?? "";
      return parseTestOutput(output);
    }
  }
}
