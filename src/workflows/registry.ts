/**
 * Workflow Registry.
 * 
 * Maps ticket characteristics to workflow executors.
 * The agent uses RAG to understand WHAT a ticket needs,
 * then the registry finds the right executor to DO it.
 */

import type { ScrapedTicketDetail } from "../browser/servicenow-scraper";
import type { WorkflowExecutor, WorkflowDecision } from "./types";

export interface RegistryMatch {
  executor: WorkflowExecutor;
  decision: WorkflowDecision;
  confidence: number;
}

export class WorkflowRegistry {
  private executors: Map<string, WorkflowExecutor> = new Map();

  /**
   * Register a workflow executor.
   */
  register(executor: WorkflowExecutor): void {
    if (this.executors.has(executor.id)) {
      throw new Error(`Workflow already registered: ${executor.id}`);
    }
    this.executors.set(executor.id, executor);
  }

  /**
   * Get a specific executor by ID.
   */
  get(id: string): WorkflowExecutor | undefined {
    return this.executors.get(id);
  }

  /**
   * List all registered executors.
   */
  list(): WorkflowExecutor[] {
    return [...this.executors.values()];
  }

  /**
   * Find the best workflow for a ticket.
   * Returns all executors that can handle the ticket, sorted by priority.
   */
  match(ticket: ScrapedTicketDetail): RegistryMatch[] {
    const matches: RegistryMatch[] = [];

    for (const executor of this.executors.values()) {
      const decision = executor.canHandle(ticket);
      if (decision === "execute") {
        matches.push({ executor, decision, confidence: 1.0 });
      } else if (decision === "needs_info") {
        matches.push({ executor, decision, confidence: 0.5 });
      }
      // skip and escalate are not matches
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Find the single best executor for a ticket, or null if none match.
   */
  findBest(ticket: ScrapedTicketDetail): RegistryMatch | null {
    const matches = this.match(ticket);
    return matches.length > 0 ? matches[0] : null;
  }
}

/**
 * Create a registry with all built-in workflow executors.
 */
export function createDefaultRegistry(): WorkflowRegistry {
  // Lazy import to avoid circular deps
  const registry = new WorkflowRegistry();

  // Executors are registered by the caller after import
  // This keeps the registry decoupled from specific implementations
  return registry;
}
