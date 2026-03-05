/**
 * Workflow engine types.
 * 
 * A Workflow is a sequence of steps that an agent can execute
 * to resolve a specific type of ticket. Workflows are matched
 * to tickets via RAG (knowledge base runbooks describe when
 * to use each workflow).
 */

import type { Browser } from "playwright";
import type { ScrapedTicketDetail } from "../browser/servicenow-scraper";

export type WorkflowDecision =
  | "execute"     // Workflow can handle this ticket
  | "escalate"    // Outside this workflow's scope
  | "needs_info"  // Not enough info to execute
  | "skip";       // Already done or not applicable

export interface WorkflowContext {
  /** The browser instance for automation */
  browser: Browser;
  /** Directory for storing downloaded files, logs, etc. */
  workDir: string;
  /** Logger for step-by-step output */
  logger: WorkflowLogger;
  /** If true, log actions but don't execute them */
  dryRun?: boolean;
}

export interface WorkflowLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  step: (stepName: string, detail: string) => void;
}

export interface WorkflowResult {
  success: boolean;
  decision: WorkflowDecision;
  /** What the workflow did (or would have done in dry-run) */
  summary: string;
  /** Message to post on the ticket */
  ticketComment?: string;
  /** Whether to post as internal note vs public comment */
  commentIsInternal?: boolean;
  /** Detailed step log */
  steps: WorkflowStep[];
  /** Error message if failed */
  error?: string;
  /** Arbitrary data produced by the workflow */
  data?: Record<string, unknown>;
}

export interface WorkflowStep {
  name: string;
  status: "completed" | "failed" | "skipped";
  detail: string;
  timestamp: string;
}

/**
 * A WorkflowExecutor is a module that can handle a specific type of ticket.
 * 
 * To teach TierZero a new workflow:
 * 1. Write a runbook in knowledge/runbooks/ (teaches the RAG what to match)
 * 2. Write a workflow definition in knowledge/workflows/ (machine-readable config)
 * 3. Implement a WorkflowExecutor (the actual automation code)
 * 4. Register it in the WorkflowRegistry
 */
export interface WorkflowExecutor {
  /** Unique identifier for this workflow */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this workflow handles */
  readonly description: string;
  
  /**
   * Quick check: can this workflow handle the given ticket?
   * Should be fast (no browser automation, no API calls).
   * Used for initial filtering before RAG confirmation.
   */
  canHandle(ticket: ScrapedTicketDetail): WorkflowDecision;

  /**
   * Execute the workflow. Does the actual work.
   */
  execute(ticket: ScrapedTicketDetail, ctx: WorkflowContext): Promise<WorkflowResult>;
}
