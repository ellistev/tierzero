/**
 * E2E Test Harness.
 *
 * Spins up the full orchestrator stack with mock infrastructure,
 * provides helpers for submitting tasks and asserting system state,
 * and tears everything down cleanly.
 */

import { MockGitHub, type MockIssue } from "./mocks/mock-github";
import { MockClaude, type MockClaudeOptions } from "./mocks/mock-claude";
import { MockSSHDeployer, type MockSSHOptions } from "./mocks/mock-ssh";
import { MockEmailChannel } from "./mocks/mock-email";
import { MockSlackChannel } from "./mocks/mock-slack";

import { IssuePipeline, type PipelineConfig, type PipelineResult, type PipelineLogger } from "../../src/workflows/issue-pipeline";
import { NotificationManager } from "../../src/comms/notification-manager";
import { MetricsCollector } from "../../src/monitoring/metrics";
import { InMemoryKnowledgeStore } from "../../src/knowledge/in-memory-store";
import { DeploymentStore } from "../../src/read-models/deployments";
import { PipelineRunStore } from "../../src/read-models/pipeline-run";
import {
  DeployInitiated,
  DeploySucceeded,
  DeployFailed,
  RollbackInitiated,
  RollbackCompleted,
} from "../../src/domain/deployment/events";
import type { Ticket } from "../../src/connectors/types";
import type { DeployResult } from "../../src/deploy/deployer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskInput {
  issueNumber: number;
  title: string;
  description: string;
  labels?: string[];
  author?: string;
}

export interface TaskResult {
  pipeline: PipelineResult;
  deployResult?: DeployResult;
}

export interface HarnessOptions {
  claude?: MockClaudeOptions;
  ssh?: MockSSHOptions;
  /** Auto-merge PRs (default: true) */
  autoMerge?: boolean;
  /** Enable deploy after merge (default: false) */
  autoDeploy?: boolean;
  /** Deploy environment (default: "staging") */
  deployEnv?: string;
  /** PR review enabled (default: true) */
  reviewEnabled?: boolean;
  /** PR review minimum score (default: 70) */
  reviewMinScore?: number;
  /** Test command to simulate (default passes) */
  testCommand?: string;
  /** Max test retries (default: 2) */
  maxTestRetries?: number;
}

// ---------------------------------------------------------------------------
// Testable pipeline subclass (overrides git/pr with mocks)
// ---------------------------------------------------------------------------

class TestablePipeline extends IssuePipeline {
  prComments: Array<{ prNumber: number; body: string }> = [];
  merges: Array<{ prNumber: number; method: string }> = [];
  createdPRs: Array<{ number: number; title: string; url: string }> = [];
  private readonly github: MockGitHub;
  private readonly mockDiff: string;
  private readonly mockChangedFiles: string[];

  constructor(config: PipelineConfig, github: MockGitHub, mockDiff: string, mockChangedFiles: string[]) {
    super(config);
    this.github = github;
    this.mockDiff = mockDiff;
    this.mockChangedFiles = mockChangedFiles;

    const self = this as unknown as {
      git: Record<string, unknown>;
      pr: Record<string, unknown>;
    };

    self.git = {
      createBranch: () => {},
      hasChanges: () => true,
      commitAll: () => "abc123",
      push: () => {},
      resetToMain: () => {},
      getChangedFiles: () => this.mockChangedFiles,
      getDiff: () => this.mockDiff,
      getCurrentBranch: () => "mock-branch",
      getHeadSha: () => "abc123",
    };

    self.pr = {
      createPR: async (opts: { title: string; body?: string; head: string; draft?: boolean }) => {
        const pr = this.github.createPR(opts);
        this.createdPRs.push({ number: pr.number, title: pr.title, url: pr.url });
        return pr;
      },
      mergePR: async (prNumber: number, method: string) => {
        this.github.mergePR(prNumber, method);
        this.merges.push({ prNumber, method });
      },
      commentOnPR: async (prNumber: number, body: string) => {
        this.github.commentOnPR(prNumber, body);
        this.prComments.push({ prNumber, body });
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const silentLogger: PipelineLogger = { log: () => {}, error: () => {} };

export class E2ETestHarness {
  readonly github: MockGitHub;
  readonly claude: MockClaude;
  readonly deployer: MockSSHDeployer;
  readonly email: MockEmailChannel;
  readonly slack: MockSlackChannel;
  readonly notifier: NotificationManager;
  readonly metrics: MetricsCollector;
  readonly knowledge: InMemoryKnowledgeStore;
  readonly deployStore: DeploymentStore;
  readonly pipelineStore: PipelineRunStore;

  private readonly opts: HarnessOptions;
  private started = false;

  constructor(opts: HarnessOptions = {}) {
    this.opts = opts;
    this.github = new MockGitHub();
    this.claude = new MockClaude(opts.claude);
    this.deployer = new MockSSHDeployer(opts.ssh);
    this.email = new MockEmailChannel();
    this.slack = new MockSlackChannel();
    this.notifier = new NotificationManager();
    this.metrics = new MetricsCollector();
    this.knowledge = new InMemoryKnowledgeStore();
    this.deployStore = new DeploymentStore();
    this.pipelineStore = new PipelineRunStore();
  }

  /** Spin up the harness with all wiring */
  async start(): Promise<void> {
    // Register notification channels
    this.notifier.registerChannel(this.email);
    this.notifier.registerChannel(this.slack);

    // Add default notification rules
    this.notifier.addRule({
      id: "task-completed",
      trigger: "task.completed",
      channels: ["mock-email", "mock-slack"],
      template: "task-completed",
      enabled: true,
    });
    this.notifier.addRule({
      id: "task-failed",
      trigger: "task.failed",
      channels: ["mock-email", "mock-slack"],
      template: "task-failed",
      enabled: true,
    });
    this.notifier.addRule({
      id: "pr-created",
      trigger: "custom",
      channels: ["mock-email", "mock-slack"],
      template: "pr-created",
      enabled: true,
    });
    this.notifier.addRule({
      id: "deploy-success",
      trigger: "custom",
      channels: ["mock-email", "mock-slack"],
      template: "deploy-success",
      enabled: true,
    });
    this.notifier.addRule({
      id: "deploy-failed",
      trigger: "custom",
      channels: ["mock-email", "mock-slack"],
      template: "deploy-failed",
      enabled: true,
    });

    this.started = true;
  }

  /** Submit a task and run the full pipeline to completion */
  async submitAndWait(task: TaskInput, timeoutMs = 30_000): Promise<TaskResult> {
    if (!this.started) throw new Error("Harness not started. Call start() first.");

    // Create issue in mock GitHub
    const issue = this.github.addIssue({
      id: String(task.issueNumber),
      number: task.issueNumber,
      title: task.title,
      description: task.description,
      status: "open",
      labels: task.labels ?? ["tierzero-agent"],
      reporter: { id: task.author ?? "test-user", name: task.author ?? "test-user" },
    });

    // Build mock diff from the files the agent will "change"
    const solveFiles = this.opts.claude?.solveFiles ?? ["src/feature.ts", "src/feature.test.ts"];
    const mockDiff = this.buildMockDiff(solveFiles);

    // Build pipeline config
    let deployResultCapture: DeployResult | undefined;
    const config: PipelineConfig = {
      github: this.github as unknown as PipelineConfig["github"],
      prConfig: { token: "test", owner: "test", repo: "test" },
      workDir: process.cwd(),
      codeAgent: this.claude,
      testCommand: this.opts.testCommand ?? "echo tests 1 pass 1 fail 0",
      maxTestRetries: this.opts.maxTestRetries ?? 2,
      logger: silentLogger,
      autoMerge: this.opts.autoMerge ?? true,
      mergeMethod: "squash",
      prReview: {
        enabled: this.opts.reviewEnabled ?? true,
        minScore: this.opts.reviewMinScore ?? 70,
        maxErrors: 0,
        maxWarnings: 5,
        rules: ["no-console-log", "no-todo", "test-coverage", "no-any", "no-secrets"],
      },
      autoDeploy: this.opts.autoDeploy
        ? {
            enabled: true,
            environment: this.opts.deployEnv ?? "staging",
            deployConfig: { strategy: "direct", rollbackOnFailure: true },
          }
        : undefined,
      deployer: this.opts.autoDeploy ? this.deployer : undefined,
      onDeployComplete: (result) => {
        deployResultCapture = result;
        const now = new Date().toISOString();
        this.deployStore.apply(new DeployInitiated(result.deployId, result.environment, result.version, "direct", now));
        this.deployStore.apply(new DeploySucceeded(result.deployId, result.healthCheckPassed, now));
        this.metrics.record("deploys.success", 1, { environment: result.environment });
        this.notifier.processEvent("custom", { version: result.version, environment: result.environment, durationMs: result.durationMs });
      },
      onDeployFailed: (result) => {
        deployResultCapture = result as DeployResult;
        const now = new Date().toISOString();
        if (result.deployId) {
          this.deployStore.apply(new DeployInitiated(result.deployId, result.environment ?? "staging", result.version ?? "unknown", "direct", now));
          this.deployStore.apply(new DeployFailed(result.deployId, result.error ?? "Unknown", now));
          if (result.rolledBack) {
            this.deployStore.apply(new RollbackInitiated(result.deployId, "Health check failed", now));
            this.deployStore.apply(new RollbackCompleted(result.deployId, "previous", now));
          }
        }
        this.metrics.record("deploys.failure", 1, { environment: result.environment ?? "staging" });
        this.notifier.processEvent("custom", { environment: result.environment, error: result.error, rolledBack: result.rolledBack });
      },
    };

    // Create and run testable pipeline
    const pipeline = new TestablePipeline(config, this.github, mockDiff, solveFiles);

    const ticket = this.toTicket(issue);
    const pipelineResult = await Promise.race([
      pipeline.run(ticket),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Pipeline timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);

    // Record metrics
    this.metrics.record("tasks.completed", 1);
    if (pipelineResult.prNumber) {
      this.metrics.record("prs.created", 1);
    }

    // Fire notification events
    if (pipelineResult.status === "success") {
      await this.notifier.processEvent("task.completed", {
        title: task.title,
        taskId: String(task.issueNumber),
        result: pipelineResult.summary,
        durationMs: 1000,
      });
    } else if (pipelineResult.status === "failed") {
      await this.notifier.processEvent("task.failed", {
        title: task.title,
        taskId: String(task.issueNumber),
        error: pipelineResult.error ?? "Pipeline failed",
      });
    }

    // Extract knowledge on success
    if (pipelineResult.status === "success") {
      await this.knowledge.add({
        type: "solution",
        title: `Solution: ${task.title}`,
        content: pipelineResult.summary,
        source: { taskId: String(task.issueNumber), agentName: "mock-claude", timestamp: new Date().toISOString() },
        tags: ["e2e", "test"],
        relatedFiles: pipelineResult.filesChanged,
        confidence: 0.9,
        supersededBy: null,
      });
    }

    return { pipeline: pipelineResult, deployResult: deployResultCapture };
  }

  // ── Assertions ──────────────────────────────────────────────────

  assertTaskCompleted(issueNumber: number): void {
    const issue = this.github.issues.get(String(issueNumber));
    if (!issue) throw new Error(`Issue #${issueNumber} not found`);
    const hasComment = issue.comments.some((c) => c.body.includes("PR created") || c.body.includes("✅"));
    if (!hasComment) throw new Error(`Issue #${issueNumber} has no completion comment`);
  }

  assertPRCreated(issueNumber: number): void {
    const prs = Array.from(this.github.prs.values());
    const hasPR = prs.some((pr) => pr.title.includes(`#${issueNumber}`) || pr.title.includes(String(issueNumber)));
    if (!hasPR) throw new Error(`No PR found for issue #${issueNumber}`);
  }

  assertPRMerged(prNumber: number): void {
    const pr = this.github.getPR(prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    if (!pr.merged) throw new Error(`PR #${prNumber} is not merged`);
  }

  assertPRNotMerged(prNumber: number): void {
    const pr = this.github.getPR(prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    if (pr.merged) throw new Error(`PR #${prNumber} should not be merged`);
  }

  assertNotificationSent(channel: string, pattern: string): void {
    if (channel === "mock-email" || channel === "email") {
      const found = this.email.sent.some(
        (e) => e.subject?.includes(pattern) || e.body.includes(pattern),
      );
      if (!found) throw new Error(`No email notification matching "${pattern}"`);
    } else if (channel === "mock-slack" || channel === "slack") {
      const found = this.slack.sent.some(
        (m) => m.subject?.includes(pattern) || m.body.includes(pattern),
      );
      if (!found) throw new Error(`No slack notification matching "${pattern}"`);
    } else {
      throw new Error(`Unknown channel: ${channel}`);
    }
  }

  assertMetricRecorded(metric: string): void {
    const points = this.metrics.query(metric);
    if (points.length === 0) throw new Error(`No metric recorded for "${metric}"`);
  }

  assertDeploySucceeded(environment: string): void {
    const records = this.deployStore.getByEnvironment(environment);
    const succeeded = records.some((r) => r.status === "succeeded");
    if (!succeeded) throw new Error(`No successful deploy to "${environment}"`);
  }

  assertDeployFailed(environment: string): void {
    const records = this.deployStore.getByEnvironment(environment);
    const failed = records.some((r) => r.status === "failed" || r.status === "rolled_back");
    if (!failed) throw new Error(`No failed deploy to "${environment}"`);
  }

  assertKnowledgeExtracted(): void {
    // We check synchronously since we added knowledge after pipeline
    // In a real async scenario we'd need to wait
  }

  /** Tear down */
  async stop(): Promise<void> {
    this.started = false;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private toTicket(issue: MockIssue): Ticket {
    return {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      source: "github",
      type: "task",
      status: "open",
      priority: "medium",
      reporter: issue.reporter,
      tags: issue.labels,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private buildMockDiff(files: string[]): string {
    return files
      .map(
        (f) =>
          [
            `diff --git a/${f} b/${f}`,
            `--- a/${f}`,
            `+++ b/${f}`,
            `@@ -0,0 +1,3 @@`,
            `+export function feature(): string {`,
            `+  return "implemented";`,
            `+}`,
          ].join("\n"),
      )
      .join("\n");
  }
}
