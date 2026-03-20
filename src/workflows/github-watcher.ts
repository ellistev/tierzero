/**
 * GitHub Issue Watcher.
 * 
 * Polls a GitHub repo for issues with a trigger label,
 * picks them up, and feeds them to the IssuePipeline.
 */

import { GitHubConnector, type GitHubConfig } from "../connectors/github";
import { IssuePipeline, type PipelineConfig, type PipelineResult, type CodeAgent } from "./issue-pipeline";
import { PRCreator } from "./pr-creator";
import type { Ticket } from "../connectors/types";
import { createLogger } from "../infra/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatcherConfig {
  /** GitHub connection config */
  github: GitHubConfig;
  /** Working directory (git repo root) */
  workDir: string;
  /** Poll interval in ms (default: 60000) */
  pollIntervalMs?: number;
  /** Label that triggers the agent (default: "tierzero-agent") */
  triggerLabel?: string;
  /** Label added when work starts (default: "in-progress") */
  inProgressLabel?: string;
  /** Label added when PR is created (default: "pr-created") */
  prCreatedLabel?: string;
  /** GitHub username to assign issues to */
  assignTo?: string;
  /** Max concurrent pipelines (default: 1) */
  maxConcurrent?: number;
  /** Test command (default: "npm test") */
  testCommand?: string;
  /** Code agent implementation */
  codeAgent: CodeAgent;
  /** Logger */
  logger?: WatcherLogger;
  /** Auto-merge PRs when tests pass (default: false) */
  autoMerge?: boolean;
  /** Merge method (default: "squash") */
  mergeMethod?: "merge" | "squash" | "rebase";
  /** GitHub usernames allowed to create issues the watcher will process */
  trustedAuthors?: string[];
  /** If true, only process issues from trustedAuthors. If false, process all labeled issues (UNSAFE for public repos) */
  requireTrustedAuthor?: boolean;
  /** Callback when PR is created - used by notification system */
  onPRCreated?: (data: { issueNumber: number; prNumber: number; prUrl: string; title: string; testsRun: number; testsPassed: number }) => void;
}

export interface WatcherLogger {
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export interface WatcherState {
  /** Issue IDs currently being worked on */
  activeIssues: Set<string>;
  /** Issue IDs that have been completed (success or failed) */
  completedIssues: Set<string>;
  /** Issue IDs that have permanently failed (max retries exceeded) */
  failedIssues: Set<string>;
  /** Retry counts per issue */
  retryCounts: Map<string, number>;
  /** Results from completed pipelines */
  results: PipelineResult[];
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

const _watcherLog = createLogger("watcher");
const defaultLogger: WatcherLogger = {
  log: (msg: string) => _watcherLog.info(msg),
  error: (msg: string) => _watcherLog.error(msg),
};

export class GitHubWatcher {
  private readonly config: WatcherConfig;
  private readonly connector: GitHubConnector;
  private readonly logger: WatcherLogger;
  private readonly state: WatcherState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: WatcherConfig) {
    this.config = config;
    this.connector = new GitHubConnector(config.github);
    this.logger = config.logger ?? defaultLogger;
    this.state = {
      activeIssues: new Set(),
      completedIssues: new Set(),
      failedIssues: new Set(),
      retryCounts: new Map(),
      results: [],
    };
  }

  /** Start polling for issues */
  start(): void {
    if (this.running) return;
    this.running = true;
    const interval = this.config.pollIntervalMs ?? 60_000;
    this.logger.log(`Watching ${this.config.github.owner}/${this.config.github.repo} every ${interval / 1000}s`);
    this.logger.log(`Trigger label: "${this.config.triggerLabel ?? "tierzero-agent"}"`);
    if (this.config.autoMerge) {
      this.logger.log(`Auto-merge: enabled (${this.config.mergeMethod ?? "squash"})`);
    }

    // Security: warn if author filtering is disabled
    if (this.config.requireTrustedAuthor === false) {
      this.logger.log(`⚠️  WARNING: Author filtering disabled. ANY labeled issue will be processed.`);
      this.logger.log(`⚠️  This is UNSAFE on public repositories. Set trustedAuthors to restrict.`);
    } else {
      const trusted = this.config.trustedAuthors ?? [this.config.github.owner];
      this.logger.log(`Trusted authors: ${trusted.join(", ")}`);
    }

    // Run immediately, then on interval
    // Use an async wrapper to keep the process alive even if poll throws
    const safePoll = async () => {
      try {
        await this.poll();
      } catch (err) {
        this.logger.error(`Poll error: ${err}`);
      }
    };
    safePoll();
    this.timer = setInterval(safePoll, interval);
  }

  /** Stop polling */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log("Watcher stopped");
  }

  /** Get current state (for monitoring) */
  getState(): WatcherState {
    return this.state;
  }

  /** Check if watcher is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Single poll cycle - exported for testing */
  async poll(): Promise<Ticket[]> {
    const triggerLabel = this.config.triggerLabel ?? "tierzero-agent";
    const maxConcurrent = this.config.maxConcurrent ?? 1;

    // List open issues with trigger label
    const { tickets } = await this.connector.listTickets({
      status: "open",
      projectKey: triggerLabel, // Uses labels filter
    });

    // Filter: only issues with the trigger label, not already active/completed
    const candidates = tickets.filter((t) => {
      const hasLabel = t.tags?.includes(triggerLabel);
      const isActive = this.state.activeIssues.has(t.id);
      const isCompleted = this.state.completedIssues.has(t.id);
      const isFailed = this.state.failedIssues.has(t.id);
      const hasInProgress = t.tags?.includes(this.config.inProgressLabel ?? "in-progress");
      if (!hasLabel || isActive || isCompleted || isFailed || hasInProgress) return false;

      // Security: only process issues from trusted authors
      if (this.config.requireTrustedAuthor !== false) {
        const trusted = this.config.trustedAuthors ?? [this.config.github.owner];
        const author = t.reporter?.name ?? t.reporter?.id;
        if (!trusted.includes(author)) {
          this.logger.log(`Skipping #${t.id}: author "${author}" not in trusted list`);
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0) return [];

    // Sort by priority label (lowest first), then by issue number ascending
    candidates.sort((a, b) => {
      const aPri = GitHubWatcher.getPriority(a);
      const bPri = GitHubWatcher.getPriority(b);
      if (aPri !== bPri) return aPri - bPri;
      return parseInt(a.id) - parseInt(b.id);
    });

    // Respect concurrency limit
    const slotsAvailable = maxConcurrent - this.state.activeIssues.size;
    if (slotsAvailable <= 0) {
      this.logger.log(`${candidates.length} issues waiting, but ${maxConcurrent} slot(s) full`);
      return [];
    }

    const toProcess = candidates.slice(0, slotsAvailable);
    this.logger.log(`Found ${candidates.length} issues, processing ${toProcess.length}`);

    // Process each issue
    for (const ticket of toProcess) {
      this.state.activeIssues.add(ticket.id);

      // Assign if configured
      if (this.config.assignTo) {
        try {
          await this.connector.updateTicket(ticket.id, {
            assigneeId: this.config.assignTo,
          });
        } catch {
          // Best effort
        }
      }

      // Run pipeline (async but tracked)
      this.runPipeline(ticket).catch((err) => {
        this.logger.error(`Pipeline error for #${ticket.id}: ${err}`);
      });
    }

    return toProcess;
  }

  /**
   * Extract priority from a ticket's labels.
   * Looks for `priority-N` labels; returns N or 999 if none found.
   */
  static getPriority(ticket: Ticket): number {
    const label = ticket.tags?.find((t) => /^priority-(\d+)$/.test(t));
    if (!label) return 999;
    return parseInt(label.match(/^priority-(\d+)$/)![1], 10);
  }

  /**
   * Sanitize issue content: detect suspicious shell injection patterns.
   * Returns { sanitized, warnings } where warnings lists any suspicious patterns found.
   */
  static sanitizeContent(body: string): { sanitized: string; warnings: string[] } {
    const warnings: string[] = [];
    const patterns: Array<{ regex: RegExp; label: string }> = [
      { regex: /`[^`]*`/g, label: "backtick command substitution" },
      { regex: /\$\([^)]*\)/g, label: "$(command) substitution" },
      { regex: /;\s*(rm|curl|wget|nc|bash|sh|eval|exec)\b/gi, label: "chained shell command" },
      { regex: /\|\s*(bash|sh|zsh)\b/gi, label: "pipe to shell" },
      { regex: />\s*\/etc\//g, label: "write to /etc/" },
      { regex: /\bsudo\b/gi, label: "sudo usage" },
    ];

    for (const { regex, label } of patterns) {
      const matches = body.match(regex);
      if (matches) {
        warnings.push(`Suspicious pattern (${label}): ${matches.slice(0, 3).join(", ")}`);
      }
    }

    return { sanitized: body, warnings };
  }

  private async runPipeline(ticket: Ticket): Promise<void> {
    const maxRetries = 2;
    const retryCount = this.state.retryCounts.get(ticket.id) ?? 0;

    // Log priority
    const priority = GitHubWatcher.getPriority(ticket);
    this.logger.log(`Starting work on #${ticket.id} (priority ${priority}): ${ticket.title}`);

    // Audit trail: log full issue content before processing
    this.logger.log(`[audit] Processing #${ticket.id} by ${ticket.reporter?.name ?? ticket.reporter?.id ?? "unknown"}: ${ticket.title}`);
    if (ticket.description) {
      this.logger.log(`[audit] Issue body: ${ticket.description}`);
    }

    // Sanitize issue content and warn on suspicious patterns
    if (ticket.description) {
      const { warnings } = GitHubWatcher.sanitizeContent(ticket.description);
      for (const w of warnings) {
        this.logger.log(`⚠️  [sanitize] #${ticket.id}: ${w}`);
      }
    }

    const pipeline = new IssuePipeline({
      github: this.connector,
      prConfig: {
        token: this.config.github.token,
        owner: this.config.github.owner,
        repo: this.config.github.repo,
      },
      workDir: this.config.workDir,
      inProgressLabel: this.config.inProgressLabel ?? "in-progress",
      prCreatedLabel: this.config.prCreatedLabel ?? "pr-created",
      codeAgent: this.config.codeAgent,
      testCommand: this.config.testCommand,
      logger: this.logger,
      autoMerge: this.config.autoMerge,
      mergeMethod: this.config.mergeMethod,
      onPRCreated: this.config.onPRCreated,
    });

    try {
      const result = await pipeline.run(ticket);
      this.state.results.push(result);
      this.logger.log(
        `#${ticket.id} ${result.status}: ${result.prUrl ?? "no PR"} (${result.testsPassed}/${result.testsRun} tests)`
      );

      if (result.status === "success" || result.status === "partial") {
        this.state.completedIssues.add(ticket.id);
      } else if (retryCount >= maxRetries) {
        this.logger.error(`#${ticket.id} failed after ${maxRetries + 1} attempts. Giving up.`);
        this.state.failedIssues.add(ticket.id);
      } else {
        this.state.retryCounts.set(ticket.id, retryCount + 1);
        this.logger.log(`#${ticket.id} failed, will retry (attempt ${retryCount + 1}/${maxRetries + 1})`);
      }
    } catch (err) {
      if (retryCount >= maxRetries) {
        this.logger.error(`#${ticket.id} crashed after ${maxRetries + 1} attempts: ${err}. Giving up.`);
        this.state.failedIssues.add(ticket.id);
      } else {
        this.state.retryCounts.set(ticket.id, retryCount + 1);
        this.logger.error(`#${ticket.id} crashed, will retry (attempt ${retryCount + 1}/${maxRetries + 1}): ${err}`);
      }
    } finally {
      this.state.activeIssues.delete(ticket.id);
    }
  }
}
