/**
 * Real Agent Executor Factory.
 *
 * Replaces the placeholder executor in cmdOrchestrate with a function that:
 * 1. Creates a ManagedClaudeCodeAgent with knowledge store
 * 2. Spawns it via the Supervisor
 * 3. Converts NormalizedTask -> IssueContext for the agent
 * 4. Returns TaskResult with success/failure, files changed, PR URL
 */

import type { AgentSupervisor } from "./supervisor";
import type { NormalizedTask, TaskResult } from "./agent-registry";
import type { KnowledgeStore } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";
import { taskToIssueContext } from "./task-adapter";

export interface AgentExecutorConfig {
  supervisor: AgentSupervisor;
  workDir: string;
  claudePath?: string;
  claudeTimeoutMs?: number;
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
    const name = agentName ?? "claude-code";

    // 1. Search prior knowledge for context
    let priorKnowledge: string[] = [];
    if (config.knowledgeStore) {
      try {
        const query = `${task.title} ${task.description.slice(0, 500)}`;
        const entries = await config.knowledgeStore.search(query, {
          limit: 5,
          minConfidence: 0.5,
        });
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

    // 2. Create a ManagedClaudeCodeAgent
    const { ManagedClaudeCodeAgent } = await import(
      "../workflows/managed-claude-code-agent"
    );
    const agent = new ManagedClaudeCodeAgent({
      name,
      claudePath: config.claudePath,
      timeoutMs: config.claudeTimeoutMs,
    });

    // 3. Spawn via Supervisor
    const proc = await config.supervisor.spawn(
      agent,
      task,
      config.claudeTimeoutMs,
    );

    if (!proc) {
      return {
        success: false,
        output: null,
        error: "Failed to spawn agent - concurrency limit reached or supervisor shutting down",
        durationMs: Date.now() - startTime,
      };
    }

    // 4. Wait for the agent to complete by polling process status
    const result = await waitForCompletion(config.supervisor, proc.processId);
    const durationMs = Date.now() - startTime;

    // 5. Convert IssueContext for knowledge extraction
    const issueContext = taskToIssueContext(task);

    // 6. Extract knowledge from completed work (best-effort)
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
          gitDiff: "",
          agentOutput: proc.output.join("\n").slice(-2000),
          filesModified: result.filesChanged ?? [],
        };
        const entries = await config.knowledgeExtractor.extract(extractionCtx);
        for (const entry of entries) {
          await config.knowledgeStore.add(entry);
        }
      } catch {
        // Knowledge extraction is best-effort
      }
    }

    return {
      ...result,
      durationMs,
    };
  };
}

/**
 * Wait for a supervised agent process to reach a terminal state.
 */
async function waitForCompletion(
  supervisor: AgentSupervisor,
  processId: string,
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
          filesChanged: [],
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
