/**
 * Task-to-Issue Context Adapter.
 *
 * Converts NormalizedTask (from orchestrator) to IssueContext (expected by
 * Claude Code agent / IssuePipeline).
 */

import type { NormalizedTask } from "./agent-registry";
import type { IssueContext } from "../workflows/issue-pipeline";

/**
 * Convert a NormalizedTask to an IssueContext for the agent pipeline.
 * Derives a stable issue number from the taskId UUID prefix.
 */
export function taskToIssueContext(task: NormalizedTask): IssueContext {
  // Derive a stable number from the first 8 hex chars of the UUID
  const hexPrefix = task.taskId.replace(/-/g, "").slice(0, 8);
  const number = parseInt(hexPrefix, 16) % 100000;

  return {
    number,
    title: task.title,
    description: task.description,
    comments: [],
    labels: [task.category, task.priority],
  };
}
