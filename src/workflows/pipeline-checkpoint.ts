/**
 * Pipeline Checkpointing.
 *
 * Saves pipeline progress at each stage so that interrupted pipelines
 * can be resumed from the last completed stage after a restart.
 * Checkpoints are stored as JSON files in `.tierzero/checkpoints/`.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../infra/logger";

const log = createLogger("pipeline-checkpoint");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "branch-created"
  | "agent-complete"
  | "tests-passed"
  | "pr-created"
  | "merged"
  | "deployed";

export interface PipelineCheckpoint {
  issueNumber: number;
  branch: string;
  stage: PipelineStage;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface CheckpointManager {
  save(checkpoint: PipelineCheckpoint): Promise<void>;
  load(issueNumber: number): Promise<PipelineCheckpoint | null>;
  remove(issueNumber: number): Promise<void>;
  listIncomplete(): Promise<PipelineCheckpoint[]>;
}

export interface CheckpointManagerOptions {
  /** Directory for checkpoint files (default: .tierzero/checkpoints) */
  directory?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FileCheckpointManager implements CheckpointManager {
  private readonly dir: string;

  constructor(options?: CheckpointManagerOptions) {
    this.dir =
      options?.directory ??
      join(process.cwd(), ".tierzero", "checkpoints");
    mkdirSync(this.dir, { recursive: true });
  }

  getDirectory(): string {
    return this.dir;
  }

  async save(checkpoint: PipelineCheckpoint): Promise<void> {
    const filePath = join(this.dir, `issue-${checkpoint.issueNumber}.json`);
    const tmpPath = join(this.dir, `.checkpoint-${randomUUID()}.tmp`);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
    renameSync(tmpPath, filePath);

    log.info("Checkpoint saved", {
      issue: checkpoint.issueNumber,
      stage: checkpoint.stage,
      branch: checkpoint.branch,
    });
  }

  async load(issueNumber: number): Promise<PipelineCheckpoint | null> {
    const filePath = join(this.dir, `issue-${issueNumber}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as PipelineCheckpoint;
    } catch (err) {
      log.error("Failed to load checkpoint", {
        issue: issueNumber,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async remove(issueNumber: number): Promise<void> {
    const filePath = join(this.dir, `issue-${issueNumber}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      log.info("Checkpoint removed", { issue: issueNumber });
    }
  }

  async listIncomplete(): Promise<PipelineCheckpoint[]> {
    if (!existsSync(this.dir)) return [];

    const terminalStages: PipelineStage[] = ["merged", "deployed"];
    const files = readdirSync(this.dir).filter(
      (f) => f.startsWith("issue-") && f.endsWith(".json"),
    );
    const checkpoints: PipelineCheckpoint[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.dir, file), "utf-8");
        const cp = JSON.parse(raw) as PipelineCheckpoint;
        if (!terminalStages.includes(cp.stage)) {
          checkpoints.push(cp);
        }
      } catch {
        // Skip corrupt checkpoint files
      }
    }

    return checkpoints;
  }
}

// ---------------------------------------------------------------------------
// Orphan Cleanup
// ---------------------------------------------------------------------------

export interface OrphanCleanupDeps {
  /** List remote branches matching a pattern */
  listBranches(): string[];
  /** List open PR numbers and their head branches */
  listOpenPRBranches(): Array<{ branch: string; prNumber: number }>;
  /** Delete a remote branch */
  deleteBranch(branch: string): void;
}

export interface OrphanCleanupResult {
  staleBranches: string[];
  orphanedPRs: Array<{ branch: string; prNumber: number }>;
  cleanedCheckpoints: number[];
}

/**
 * On startup, detect and report orphaned resources from previous runs.
 * - Stale feature branches without PRs
 * - Open PRs from previous runs
 * - Completed checkpoints that can be cleaned up
 */
export async function cleanupOrphans(
  deps: OrphanCleanupDeps,
  checkpointManager: CheckpointManager,
  completedIssues: Set<string>,
): Promise<OrphanCleanupResult> {
  const result: OrphanCleanupResult = {
    staleBranches: [],
    orphanedPRs: [],
    cleanedCheckpoints: [],
  };

  // 1. Find feature branches that don't have PRs
  const branches = deps.listBranches();
  const prBranches = deps.listOpenPRBranches();
  const prBranchNames = new Set(prBranches.map((p) => p.branch));

  const featureBranches = branches.filter(
    (b) => b.startsWith("tierzero/") || b.startsWith("feature/"),
  );

  for (const branch of featureBranches) {
    if (!prBranchNames.has(branch)) {
      result.staleBranches.push(branch);
      log.warn("Stale branch detected (no PR)", { branch });
    }
  }

  // 2. Track open PRs from previous runs
  for (const pr of prBranches) {
    if (
      pr.branch.startsWith("tierzero/") ||
      pr.branch.startsWith("feature/")
    ) {
      result.orphanedPRs.push(pr);
      log.info("Open PR from previous run", {
        branch: pr.branch,
        prNumber: pr.prNumber,
      });
    }
  }

  // 3. Clean up checkpoints for completed issues
  const incomplete = await checkpointManager.listIncomplete();
  for (const cp of incomplete) {
    if (completedIssues.has(String(cp.issueNumber))) {
      await checkpointManager.remove(cp.issueNumber);
      result.cleanedCheckpoints.push(cp.issueNumber);
      log.info("Cleaned checkpoint for completed issue", {
        issue: cp.issueNumber,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

export interface GracefulShutdownOptions {
  /** Max time to wait for running agents in ms (default: 60000) */
  timeoutMs?: number;
  /** Called to save current state before exit */
  onSaveState: () => Promise<void>;
  /** Called to check if agents are still running */
  isAgentRunning: () => boolean;
  /** Logger */
  logger?: { log: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Install graceful shutdown handlers for SIGINT and SIGTERM.
 * On signal: wait for running agent to finish (up to timeout), save state, exit.
 * Returns a cleanup function to remove the handlers.
 */
export function installGracefulShutdown(
  options: GracefulShutdownOptions,
): () => void {
  const timeout = options.timeoutMs ?? 60_000;
  const logger = options.logger ?? {
    log: (msg: string) => log.info(msg),
    error: (msg: string) => log.error(msg),
  };
  let shuttingDown = false;

  const handler = async (signal: string) => {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    logger.log(`Received ${signal}, starting graceful shutdown...`);

    // Wait for running agent to finish
    if (options.isAgentRunning()) {
      logger.log(
        `Agent still running, waiting up to ${timeout / 1000}s for completion...`,
      );

      const start = Date.now();
      while (options.isAgentRunning() && Date.now() - start < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (options.isAgentRunning()) {
        logger.error(
          `Agent did not finish within ${timeout / 1000}s, saving state anyway`,
        );
      } else {
        logger.log("Agent finished, proceeding with shutdown");
      }
    }

    // Save state
    try {
      await options.onSaveState();
      logger.log("State saved successfully");
    } catch (err) {
      logger.error(
        `Failed to save state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.log("Shutdown complete");
    process.exit(0);
  };

  const sigintHandler = () => { handler("SIGINT"); };
  const sigtermHandler = () => { handler("SIGTERM"); };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  return () => {
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);
  };
}
