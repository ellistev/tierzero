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
import { PRReviewer, type PRReviewConfig, type PRReviewResult } from "./pr-reviewer";
import { LLMReviewer } from "./llm-reviewer";
import type { GitHubConnector } from "../connectors/github";
import type { Ticket } from "../connectors/types";
import { IssuePipelineAggregate } from "../domain/issue-pipeline/IssuePipelineAggregate";
import { StartPipeline, CompleteAgentWork, RecordTestRun, RecordTestFix, CreatePR, CompletePipeline, FailPipeline } from "../domain/issue-pipeline/commands";
import type { IEventStore, ESEventData } from "../infra/interfaces";
import type { Deployer, DeployConfig, DeployResult } from "../deploy/deployer";
import { createLogger } from "../infra/logger";
import { checkStagedFiles } from "../security/pre-commit-check";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoDeployConfig {
  /** Whether to auto-deploy after PR merge */
  enabled: boolean;
  /** Target environment for auto-deploy */
  environment: string;
  /** Deploy configuration */
  deployConfig: DeployConfig;
}

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
  /** PR review configuration */
  prReview?: PRReviewConfig;
  /** Callback when PR review blocks merge */
  onReviewBlocked?: (data: { prNumber: number; score: number; findings: number; errors: number }) => void;
  /** Auto-deploy configuration */
  autoDeploy?: AutoDeployConfig;
  /** Deployer instance for auto-deploy */
  deployer?: Deployer;
  /** Callback when deploy completes successfully */
  onDeployComplete?: (result: DeployResult) => void;
  /** Callback when deploy fails */
  onDeployFailed?: (result: Partial<DeployResult>) => void;
  /** Callback when PR is created - used by notification system */
  onPRCreated?: (data: { issueNumber: number; prNumber: number; prUrl: string; title: string; testsRun: number; testsPassed: number }) => void;
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

  /**
   * Given review findings as fix instructions, attempt to fix the code.
   * Returns updated summary.
   */
  fixReviewFindings(instructions: string, workDir: string): Promise<CodeAgentResult>;
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

const _pipelineLog = createLogger("pipeline");
const defaultLogger: PipelineLogger = {
  log: (msg: string) => _pipelineLog.info(msg),
  error: (msg: string) => _pipelineLog.error(msg),
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

      const changedFilesForPr = this.git.getChangedFiles();
      if (changedFilesForPr.length === 0) {
        result.status = "failed";
        result.error = "No committed code changes were produced";

        const failEvents = aggregate.execute(
          new FailPipeline(pipelineId, result.error, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, failEvents);

        await this.config.github.addComment(ticket.id, "TierZero produced no committed changes, so no PR was created.");
        this.git.resetToMain();
        return result;
      }

      const secretCheck = checkStagedFiles(changedFilesForPr);
      if (!secretCheck.passed) {
        result.status = "failed";
        result.error = "Secret scan failed before PR creation";

        const failEvents = aggregate.execute(
          new FailPipeline(pipelineId, result.error, new Date().toISOString())
        );
        await this.emitEvents(streamId, aggregate, failEvents);

        const findingsSummary = secretCheck.findings
          .map((f) => `- \`${f.file}:${f.line}\` ${f.pattern} (${f.match})`)
          .join("\n");

        await this.config.github.addComment(
          ticket.id,
          `TierZero blocked PR creation because the pending changes tripped the secret scanner.\n\n${findingsSummary}`,
        );
        this.git.resetToMain();
        return result;
      }

      this.logger.log(`Pushing branch ${branch}...`);
      this.git.push(branch);

      // 7. Create PR
      this.logger.log("Creating pull request...");
      const prBody = PRCreator.buildPRBody({
        issueNumber,
        summary: result.summary,
        filesChanged: changedFilesForPr,
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

      // After PR is created, emit event for notification system
      if (this.config.onPRCreated) {
        this.config.onPRCreated({
          issueNumber,
          prNumber: prResult.number,
          prUrl: prResult.url,
          title: ticket.title,
          testsRun: result.testsRun,
          testsPassed: result.testsPassed,
        });
      }

      const prEvents = aggregate.execute(
        new CreatePR(pipelineId, prResult.number, prResult.url, !testResult.passed, new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, prEvents);

      const completeEvents = aggregate.execute(
        new CompletePipeline(pipelineId, result.status as "success" | "partial", new Date().toISOString())
      );
      await this.emitEvents(streamId, aggregate, completeEvents);

      // 8. PR Review (if enabled) with review-fix loop
      let reviewApproved = true;
      if (this.config.prReview?.enabled !== false && testResult.passed && prResult.number) {
        if (issueContext.labels.includes("force-merge")) {
          this.logger.log("force-merge label detected, skipping review");
        } else {
          this.logger.log("Running PR review...");
          const reviewer = new PRReviewer(this.config.prReview);
          const useLLM = this.config.prReview?.useLLM === true && !!this.config.prReview?.llmAdapter;
          let diff = this.git.getDiff("main");

          // Context options for LLM deep review
          const contextOpts = {
            workDir: this.config.workDir,
            issueTitle: issueContext.title,
            issueBody: issueContext.description,
            testOutput: testResult.output,
          };

          let reviewResult: PRReviewResult;
          if (useLLM) {
            this.logger.log("Running static rules + LLM deep review...");
            reviewResult = await reviewer.deepReview(diff, result.filesChanged, contextOpts);
          } else {
            reviewResult = reviewer.review(diff, result.filesChanged);
          }

          // Review-fix loop: if review fails, feed findings back to agent
          const maxReviewFixes = 2;
          let reviewAttempts = 0;

          while (!reviewResult.approved && reviewAttempts < maxReviewFixes) {
            reviewAttempts++;
            this.logger.log(`Review fix attempt ${reviewAttempts}/${maxReviewFixes}`);

            // Post findings as comment
            await this.pr.commentOnPR(prResult.number, reviewer.formatFindings(reviewResult));

            // Build fix instructions from findings (include LLM suggestions if available)
            let fixInstructions = IssuePipeline.buildFixInstructions(reviewResult);
            if (reviewResult.llmReview) {
              fixInstructions += "\n\n" + LLMReviewer.buildFixInstructions(reviewResult.llmReview);
            }

            // Feed back to agent
            await this.config.codeAgent.fixReviewFindings(fixInstructions, this.config.workDir);

            // Commit fix
            if (this.git.hasChanges()) {
              this.git.commitAll(`fix: address review findings (attempt ${reviewAttempts})`);
              this.git.push(branch);
            }

            // Re-run tests
            testResult = await this.runTests(testCmd);
            if (!testResult.passed) {
              // Fix broke tests - try to fix those too
              await this.config.codeAgent.fixTests(testResult.output, this.config.workDir);
              if (this.git.hasChanges()) {
                this.git.commitAll(`fix: repair tests after review fix (attempt ${reviewAttempts})`);
                this.git.push(branch);
              }
              testResult = await this.runTests(testCmd);
            }

            // Re-run review
            diff = this.git.getDiff("main");
            if (useLLM) {
              contextOpts.testOutput = testResult.output;
              reviewResult = await reviewer.deepReview(diff, result.filesChanged, contextOpts);
            } else {
              reviewResult = reviewer.review(diff, result.filesChanged);
            }

            // Post update on PR
            await this.pr.commentOnPR(prResult.number,
              `## Review Fix Attempt ${reviewAttempts}: ${reviewResult.approved ? "APPROVED" : "Still failing"} (Score: ${reviewResult.score}/100)`
            );
          }

          if (!reviewResult.approved) {
            this.logger.log(`PR review BLOCKED after ${reviewAttempts} fix attempts: score ${reviewResult.score}, ${reviewResult.findings.length} findings`);
            reviewApproved = false;
            result.status = "partial";

            // Escalation: post final summary with remaining issues
            const remaining = reviewResult.findings.map((f) => `- **${f.rule}** \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.message}`).join("\n");
            await this.pr.commentOnPR(prResult.number,
              `## TierZero Review Escalation\n\nTierZero tried ${reviewAttempts} times to fix review findings but couldn't resolve:\n\n${remaining}\n\nPlease review manually.`
            );

            if (this.config.onReviewBlocked) {
              this.config.onReviewBlocked({
                prNumber: prResult.number,
                score: reviewResult.score,
                findings: reviewResult.findings.length,
                errors: reviewResult.findings.filter((f) => f.severity === "error").length,
              });
            }
          } else {
            this.logger.log(`PR review APPROVED: score ${reviewResult.score}`);
            await this.pr.commentOnPR(prResult.number, `## TierZero Review: ${reviewResult.score}/100\n\n${reviewResult.summary}`);
          }
        }
      }

      // 9. Auto-merge if enabled and tests pass and review approved
      if (this.config.autoMerge && testResult.passed && prResult.number && reviewApproved) {
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

      // 10. Auto-deploy after merge if configured
      if (this.config.autoDeploy?.enabled && this.config.deployer && this.config.autoMerge && testResult.passed) {
        this.logger.log(`Auto-deploying to ${this.config.autoDeploy.environment}...`);
        try {
          const deployVersion = this.git.getHeadSha?.() ?? branch;
          const deployResult = await this.config.deployer.deploy({
            environment: this.config.autoDeploy.environment,
            version: deployVersion,
            config: this.config.autoDeploy.deployConfig,
          });
          if (deployResult.success) {
            this.logger.log(`Deploy to ${this.config.autoDeploy.environment} succeeded (${deployResult.durationMs}ms)`);
            (result as PipelineResult & { deployResult?: unknown }).deployResult = deployResult;
            this.config.onDeployComplete?.(deployResult);
          } else {
            this.logger.error(`Deploy failed: ${deployResult.error}`);
            if (deployResult.rolledBack) {
              this.logger.log(`Deploy failed, rolled back to previous version`);
            }
            this.config.onDeployFailed?.(deployResult);
          }
        } catch (deployErr) {
          this.logger.error(`Auto-deploy failed: ${deployErr instanceof Error ? deployErr.message : String(deployErr)}`);
          this.config.onDeployFailed?.({ error: String(deployErr) });
        }
      }

      // 11. Update issue
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

  /**
   * Build fix instructions markdown from review findings.
   */
  static buildFixInstructions(reviewResult: PRReviewResult): string {
    const sections: string[] = ["# Review Findings to Fix", "", "The following issues were found during PR review. Fix each one:", ""];

    const errors = reviewResult.findings.filter((f) => f.severity === "error");
    const warnings = reviewResult.findings.filter((f) => f.severity === "warning");
    const infos = reviewResult.findings.filter((f) => f.severity === "info");

    if (errors.length > 0) {
      sections.push("## Errors (must fix)");
      for (const f of errors) {
        const loc = f.line ? `:${f.line}` : "";
        sections.push(`- **${f.rule}** in \`${f.file}${loc}\`: ${f.message}`);
      }
      sections.push("");
    }

    if (warnings.length > 0) {
      sections.push("## Warnings (should fix)");
      for (const f of warnings) {
        const loc = f.line ? `:${f.line}` : "";
        sections.push(`- **${f.rule}** in \`${f.file}${loc}\`: ${f.message}`);
      }
      sections.push("");
    }

    if (infos.length > 0) {
      sections.push("## Info (nice to fix)");
      for (const f of infos) {
        const loc = f.line ? `:${f.line}` : "";
        sections.push(`- **${f.rule}** in \`${f.file}${loc}\`: ${f.message}`);
      }
      sections.push("");
    }

    return sections.join("\n");
  }

  private async runTests(command: string): Promise<TestResult> {
    const [rawCmd, ...args] = command.split(/\s+/);
    const cmd = process.platform === "win32" && rawCmd.toLowerCase() === "npm"
      ? "npm.cmd"
      : rawCmd;

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
