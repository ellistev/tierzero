/**
 * Real Agent Executor Factory.
 *
 * Replaces the placeholder executor in cmdOrchestrate with a function that:
 * 1. Creates a ManagedClaudeCodeAgent with knowledge store
 * 2. Spawns it via the Supervisor
 * 3. Converts NormalizedTask -> IssueContext for the agent
 * 4. Returns TaskResult with success/failure, files changed, PR URL
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSupervisor } from "./supervisor";
import type { NormalizedTask, TaskResult } from "./agent-registry";
import { mergeKnowledgeScope, normalizeScopeValue } from "../knowledge/scope";
import type { KnowledgeEntry, KnowledgeScope, KnowledgeStore } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";

export interface AgentExecutorConfig {
  supervisor: AgentSupervisor;
  workDir: string;
  agentType?: string;
  claudePath?: string;
  claudeTimeoutMs?: number;
  codexPath?: string;
  codexModel?: string;
  codexTimeoutMs?: number;
  testCommand?: string;
  github?: {
    token: string;
    owner: string;
    repo: string;
  };
  knowledgeStore?: KnowledgeStore;
  knowledgeExtractor?: KnowledgeExtractor;
}

/**
 * Create a real agent executor function that uses the Supervisor
 * to spawn and manage ManagedClaudeCodeAgent instances.
 */
export function createAgentExecutor(
  config: AgentExecutorConfig,
  agentName?: string,
): (task: NormalizedTask) => Promise<TaskResult> {
  return async (task: NormalizedTask): Promise<TaskResult> => {
    const startTime = Date.now();
    const name = agentName ?? config.agentType ?? "claude-code";

    // 1. Search prior knowledge for context
    const taskScope = deriveKnowledgeScope(task);
    let priorKnowledgeEntries: KnowledgeEntry[] = [];
    let priorKnowledge: string[] = [];
    if (config.knowledgeStore) {
      try {
        const query = `${task.title} ${task.description.slice(0, 500)}`;
        const entries = await config.knowledgeStore.search(query, {
          limit: 5,
          minConfidence: 0.5,
          scope: taskScope,
        });
        priorKnowledgeEntries = entries;
        priorKnowledge = entries.map(
          (e) => `[${e.type}] ${e.title}: ${e.content}`,
        );
        for (const entry of entries) {
          await config.knowledgeStore.recordUsage(entry.id);
        }
      } catch {
        // Knowledge search is best-effort
      }
    }

    const taskForExecution = enrichTaskWithPriorKnowledge(task, priorKnowledge);
    const artifactDir = writeRunArtifactsStart(config.workDir, {
      task,
      taskForExecution,
      priorKnowledgeEntries,
      taskScope,
      agentName: name,
    });

    // 2. Create the configured managed agent
    const agent = await createManagedAgent(config, name);

    // 3. Spawn via Supervisor
    const proc = await config.supervisor.spawn(
      agent,
      taskForExecution,
      config.claudeTimeoutMs,
    );

    if (!proc) {
      writeRunArtifactsResult(artifactDir, {
        success: false,
        durationMs: Date.now() - startTime,
        error: "Failed to spawn agent - concurrency limit reached or supervisor shutting down",
        filesChanged: [],
        output: null,
        processOutput: "",
      });
      return {
        success: false,
        output: null,
        error: "Failed to spawn agent - concurrency limit reached or supervisor shutting down",
        durationMs: Date.now() - startTime,
      };
    }

    // 4. Wait for the agent to complete by polling process status
    const result = await waitForCompletion(
      config.supervisor,
      proc.processId,
      config.workDir,
    );
    const durationMs = Date.now() - startTime;
    const processOutput = proc.output.join("\n");

    // 5. Extract knowledge from completed work (best-effort)
    if (
      result.success &&
      config.knowledgeExtractor &&
      config.knowledgeStore
    ) {
      try {
        const extractionCtx: ExtractionContext = {
          taskId: task.taskId,
          taskTitle: task.title,
          taskDescription: task.description,
          agentName: name,
          gitDiff: collectGitDiff(config.workDir),
          agentOutput: proc.output.join("\n").slice(-2000),
          filesModified: result.filesChanged ?? [],
        };
        const entries = await config.knowledgeExtractor.extract(extractionCtx);
        for (const entry of entries) {
          await config.knowledgeStore.add({
            ...entry,
            scope: mergeKnowledgeScope(entry.scope, taskScope),
          });
        }
      } catch {
        // Knowledge extraction is best-effort
      }
    }

    writeRunArtifactsResult(artifactDir, {
      success: result.success,
      durationMs,
      error: result.error,
      filesChanged: result.filesChanged ?? [],
      output: result.output,
      processOutput,
    });

    return {
      ...result,
      durationMs,
    };
  };
}

export function deriveKnowledgeScope(task: NormalizedTask): KnowledgeScope | undefined {
  const sources = [task.source.metadata, asRecord(task.source.payload)].filter(asRecord);

  const tenant = findScopeValue(sources, [
    "tenant",
    "tenantId",
    "customer",
    "customerId",
    "account",
    "accountId",
    "organization",
    "organizationId",
    "org",
    "workspace",
    "workspaceId",
  ]);

  const workflowType = findScopeValue(sources, [
    "workflowType",
    "workflow",
    "intent",
    "requestType",
    "taskType",
    "ticketType",
    "playbook",
  ]) ?? normalizeScopeValue(task.category);

  const queue = findScopeValue(sources, [
    "queue",
    "queueName",
    "board",
    "serviceDesk",
    "serviceDeskId",
    "project",
    "projectKey",
  ]);

  return mergeKnowledgeScope(undefined, {
    tenant,
    workflowType,
    queue,
  });
}

export function enrichTaskWithPriorKnowledge(
  task: NormalizedTask,
  priorKnowledge: string[],
): NormalizedTask {
  if (priorKnowledge.length === 0) return task;

  const knowledgeSection = [
    task.description.trim(),
    "",
    "## Prior Knowledge",
    "Use the following prior lessons and patterns if they are relevant:",
    ...priorKnowledge.map((entry, index) => `${index + 1}. ${entry}`),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ...task,
    description: knowledgeSection,
  };
}

/**
 * Wait for a supervised agent process to reach a terminal state.
 */
async function waitForCompletion(
  supervisor: AgentSupervisor,
  processId: string,
  workDir?: string,
): Promise<TaskResult> {
  const POLL_INTERVAL = 500;
  const MAX_WAIT = 15 * 60 * 1000; // 15 minutes max
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    const proc = supervisor.getProcess(processId);
    if (!proc) {
      return {
        success: false,
        output: null,
        error: "Agent process not found",
        durationMs: Date.now() - start,
      };
    }

    switch (proc.status) {
      case "completed":
        return {
          success: true,
          output: {
            message: `Agent completed task`,
            outputLines: proc.output.length,
          },
          filesChanged: workDir ? collectChangedFiles(workDir) : [],
          durationMs: Date.now() - start,
        };

      case "failed":
        return {
          success: false,
          output: null,
          error: `Agent failed: ${proc.output.slice(-3).join("\n")}`,
          durationMs: Date.now() - start,
        };

      case "killed":
        return {
          success: false,
          output: null,
          error: "Agent was killed",
          durationMs: Date.now() - start,
        };

      case "hung":
        return {
          success: false,
          output: null,
          error: "Agent hung - no heartbeat",
          durationMs: Date.now() - start,
        };

      default:
        // Still running or starting - wait
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  return {
    success: false,
    output: null,
    error: "Timed out waiting for agent completion",
    durationMs: Date.now() - start,
  };
}

async function createManagedAgent(config: AgentExecutorConfig, name: string) {
  if (config.agentType === "codex") {
    const { ManagedCodexAgent } = await import("../workflows/managed-codex-agent");
    return new ManagedCodexAgent({
      name,
      codexPath: config.codexPath,
      timeoutMs: config.codexTimeoutMs,
      model: config.codexModel,
    });
  }

  const { ManagedClaudeCodeAgent } = await import("../workflows/managed-claude-code-agent");
  return new ManagedClaudeCodeAgent({
    name,
    claudePath: config.claudePath,
    timeoutMs: config.claudeTimeoutMs,
  });
}

function collectChangedFiles(workDir: string): string[] {
  try {
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--"], {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return [...new Set([...changed, ...untracked])];
  } catch {
    return [];
  }
}

function collectGitDiff(workDir: string): string {
  try {
    return execFileSync("git", ["diff", "HEAD", "--"], {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 1024 * 1024,
    }).slice(0, 5000);
  } catch {
    return "";
  }
}

function findScopeValue(sources: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const source of sources) {
    const found = findScopeValueInRecord(source, new Set(keys), 0);
    if (found) return found;
  }
  return undefined;
}

function findScopeValueInRecord(
  record: Record<string, unknown>,
  keys: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 2) return undefined;

  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key) && typeof value === "string") {
      return normalizeScopeValue(value);
    }
  }

  for (const value of Object.values(record)) {
    if (asRecord(value)) {
      const found = findScopeValueInRecord(value, keys, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

interface RunArtifactStartPayload {
  task: NormalizedTask;
  taskForExecution: NormalizedTask;
  priorKnowledgeEntries: KnowledgeEntry[];
  taskScope?: KnowledgeScope;
  agentName: string;
}

interface RunArtifactResultPayload {
  success: boolean;
  durationMs: number;
  error?: string;
  filesChanged: string[];
  output: unknown;
  processOutput: string;
}

function writeRunArtifactsStart(workDir: string, payload: RunArtifactStartPayload): string {
  const artifactDir = join(workDir, ".tierzero", "run-artifacts", payload.task.taskId);
  const now = new Date().toISOString();

  mkdirSync(artifactDir, { recursive: true });
  writeJson(join(artifactDir, "manifest.json"), {
    taskId: payload.task.taskId,
    title: payload.task.title,
    category: payload.task.category,
    priority: payload.task.priority,
    agentName: payload.agentName,
    status: "running",
    createdAt: now,
    updatedAt: now,
    scope: payload.taskScope ?? null,
  });
  writeJson(join(artifactDir, "input.json"), {
    task: payload.task,
    taskForExecution: payload.taskForExecution,
    scope: payload.taskScope ?? null,
  });
  writeJson(join(artifactDir, "knowledge-bank.json"), payload.priorKnowledgeEntries);
  writeFileSync(join(artifactDir, "input-task.md"), renderInputTask(payload.taskForExecution), "utf-8");

  return artifactDir;
}

function writeRunArtifactsResult(artifactDir: string, payload: RunArtifactResultPayload): void {
  const now = new Date().toISOString();
  writeJson(join(artifactDir, "output.json"), {
    success: payload.success,
    durationMs: payload.durationMs,
    error: payload.error ?? null,
    filesChanged: payload.filesChanged,
    output: payload.output,
    processOutput: payload.processOutput,
  });
  writeJson(join(artifactDir, "manifest.json"), {
    ...readJson(join(artifactDir, "manifest.json")),
    status: payload.success ? "completed" : "failed",
    updatedAt: now,
  });
}

function renderInputTask(task: NormalizedTask): string {
  return [
    `# ${task.title}`,
    "",
    `- Task ID: ${task.taskId}`,
    `- Category: ${task.category}`,
    `- Priority: ${task.priority}`,
    "",
    "## Description",
    task.description || "(empty)",
  ].join("\n");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
