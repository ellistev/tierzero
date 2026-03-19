/**
 * Workflow Registry.
 * 
 * Maps ticket characteristics to workflow executors.
 * The agent uses RAG to understand WHAT a ticket needs,
 * then the registry finds the right executor to DO it.
 * 
 * Executors are hot-loaded from demo workflow directories at startup.
 */

import type { Ticket, WorkflowExecutor, WorkflowDecision } from "./types";
import { createLogger } from "../infra/logger";
const log = createLogger("registry");

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
   * Find workflows that can handle a ticket.
   */
  match(ticket: Ticket): RegistryMatch[] {
    const matches: RegistryMatch[] = [];

    for (const executor of this.executors.values()) {
      const decision = executor.canHandle(ticket);
      if (decision === "execute") {
        matches.push({ executor, decision, confidence: 1.0 });
      } else if (decision === "needs_info") {
        matches.push({ executor, decision, confidence: 0.5 });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Find the single best executor for a ticket, or null if none match.
   */
  findBest(ticket: Ticket): RegistryMatch | null {
    const matches = this.match(ticket);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Hot-load workflow executors from a directory.
   * Each .ts file must default-export a WorkflowExecutor instance or factory.
   */
  async loadFromDir(dir: string): Promise<number> {
    const fs = await import("fs");
    const path = await import("path");

    if (!fs.existsSync(dir)) return 0;

    let loaded = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
      // Skip YAML workflow definitions
      if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) continue;

      const filePath = path.join(dir, entry.name);
      const fileUrl = "file://" + filePath.replace(/\\/g, "/");

      try {
        const mod = await import(fileUrl);
        const executor: WorkflowExecutor = mod.default ?? mod.executor ?? mod;

        if (executor && typeof executor.canHandle === "function" && executor.id) {
          this.register(executor);
          loaded++;
        } else if (typeof mod.default === "function") {
          // Factory function
          const instance = mod.default();
          if (instance && instance.id) {
            this.register(instance);
            loaded++;
          }
        }
      } catch (err) {
        log.warn(`Failed to load workflow ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return loaded;
  }
}
