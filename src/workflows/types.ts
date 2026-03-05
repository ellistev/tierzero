/**
 * Workflow engine types.
 * 
 * A Workflow is a sequence of steps that an agent can execute
 * to resolve a specific type of ticket. Workflows are matched
 * to tickets via RAG (knowledge base runbooks describe when
 * to use each workflow).
 * 
 * Types are GENERIC - no dependency on any specific ticketing system.
 * Ticket types are defined by skills (ServiceNow, Jira, etc).
 */

import type { Browser } from "playwright";
import type { SkillLoader } from "../skills/loader";

export type WorkflowDecision =
  | "execute"     // Workflow can handle this ticket
  | "escalate"    // Outside this workflow's scope
  | "needs_info"  // Not enough info to execute
  | "skip";       // Already done or not applicable

/**
 * Generic ticket representation.
 * Skills produce this; workflows consume it.
 */
export interface Ticket {
  /** Ticket identifier (e.g. INC0099001, JIRA-123) */
  id: string;
  /** Short description / title */
  title: string;
  /** Full description */
  description: string;
  /** Ticket source system */
  source: string;
  /** Arbitrary fields extracted by the ticketing skill */
  fields: Record<string, unknown>;
}

export interface WorkflowContext {
  /** The browser instance for automation */
  browser: Browser;
  /** Loaded skills (for accessing capabilities) */
  skills: SkillLoader;
  /** Directory for storing downloaded files, logs, etc. */
  workDir: string;
  /** Logger for step-by-step output */
  logger: WorkflowLogger;
  /** If true, log actions but don't execute them */
  dryRun?: boolean;
  /** CQRS command handler for emitting domain events (optional - available when CQRS infra is bootstrapped) */
  commandHandler?: <TState extends Record<string, unknown>, TCommand>(
    AggregateClass: { new (): import("../infra/aggregate").Aggregate<TState>; type: string },
    aggregateId: string,
    command: TCommand
  ) => void;
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
 * A WorkflowExecutor handles a specific type of ticket.
 * 
 * To teach TierZero a new workflow:
 * 1. Write a runbook in your demo's runbooks/ (teaches the RAG what to match)
 * 2. Implement a WorkflowExecutor (the actual automation code)
 * 3. Drop it in your demo's workflows/ folder
 * 4. TierZero hot-loads it at startup
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
   */
  canHandle(ticket: Ticket): WorkflowDecision;

  /**
   * Execute the workflow. Does the actual work.
   */
  execute(ticket: Ticket, ctx: WorkflowContext): Promise<WorkflowResult>;
}
