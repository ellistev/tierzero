import type { Page } from "playwright";
import type { Intent, ResolvedIntent, ResolutionStrategy, RecoveryStrategy, SelectorCacheQuery, LLMProvider } from "./types";
import { IntentExecution } from "../domain/intent-execution/IntentExecution";
import { AttemptIntent, ResolveSelector, SucceedIntent, FailIntent, AttemptRecovery, SucceedRecovery, FailRecovery, EscalateIntent } from "../domain/intent-execution/commands";
import { CachedStrategy, AriaStrategy, VisionStrategy, LLMStrategy } from "./resolver";
import { DismissDialogRecovery, LLMRecovery } from "./recovery";

export interface IntentEngineOptions {
  /** Selector cache for fast lookups */
  cache?: SelectorCacheQuery;
  /** LLM provider for vision/accessibility-based resolution */
  llm?: LLMProvider;
  /** Custom resolution strategies (overrides defaults) */
  strategies?: ResolutionStrategy[];
  /** Custom recovery strategies (overrides defaults) */
  recoveryStrategies?: RecoveryStrategy[];
  /** Max recovery attempts per intent */
  maxRecoveryAttempts?: number;
  /** CQRS command handler for emitting events */
  commandHandler?: (AggregateClass: unknown, aggregateId: string, command: unknown, metadata?: unknown) => Promise<unknown>;
}

export interface IntentResult {
  success: boolean;
  selector?: string;
  method?: string;
  durationMs: number;
  error?: string;
  recoveryAttempts: number;
}

export class IntentEngine {
  private readonly strategies: ResolutionStrategy[];
  private readonly recoveryStrategies: RecoveryStrategy[];
  private readonly maxRecoveryAttempts: number;
  private readonly commandHandler?: IntentEngineOptions["commandHandler"];

  constructor(opts: IntentEngineOptions = {}) {
    this.maxRecoveryAttempts = opts.maxRecoveryAttempts ?? 2;
    this.commandHandler = opts.commandHandler;

    // Build strategy chain
    if (opts.strategies) {
      this.strategies = opts.strategies;
    } else {
      const strategies: ResolutionStrategy[] = [];
      if (opts.cache) strategies.push(new CachedStrategy(opts.cache));
      strategies.push(new AriaStrategy());
      if (opts.llm) {
        strategies.push(new LLMStrategy(opts.llm));
        strategies.push(new VisionStrategy(opts.llm));
      }
      this.strategies = strategies;
    }

    // Build recovery chain
    if (opts.recoveryStrategies) {
      this.recoveryStrategies = opts.recoveryStrategies;
    } else {
      const recoveries: RecoveryStrategy[] = [new DismissDialogRecovery()];
      if (opts.llm) recoveries.push(new LLMRecovery(opts.llm));
      this.recoveryStrategies = recoveries;
    }
  }

  /**
   * Execute an intent on a page with full fallback chain.
   * Never throws - always returns a result.
   */
  async execute(intent: Intent, page: Page): Promise<IntentResult> {
    const start = Date.now();
    const intentId = `${intent.page}::${intent.name}::${Date.now()}`;
    let recoveryAttempts = 0;

    // Emit AttemptIntent
    await this.emitCommand(intentId, new AttemptIntent(
      intentId, intent.name, intent.goal, intent.page,
      intent.value ?? null, intent.context ?? {}, new Date().toISOString()
    ), { page: intent.page, intentName: intent.name });

    // Try resolution strategies
    const resolved = await this.tryStrategies(intent, page, intentId);
    if (resolved) {
      // Execute the action on the resolved element
      const actionResult = await this.executeAction(intent, page, resolved);
      if (actionResult.success) {
        const durationMs = Date.now() - start;
        await this.emitCommand(intentId, new SucceedIntent(
          intentId, resolved.selector, resolved.method, durationMs, new Date().toISOString()
        ), { page: intent.page, intentName: intent.name });
        return { success: true, selector: resolved.selector, method: resolved.method, durationMs, recoveryAttempts };
      }
    }

    // Resolution or action failed - attempt recovery
    for (let attempt = 0; attempt < this.maxRecoveryAttempts; attempt++) {
      recoveryAttempts++;
      const error = new Error(resolved ? "Action failed after resolution" : "No strategy could resolve intent");

      const recovery = await this.tryRecovery(intent, page, error, recoveryAttempts, intentId);
      if (!recovery) break;

      // Retry strategies after recovery
      const retryResolved = await this.tryStrategies(intent, page, intentId);
      if (retryResolved) {
        const retryAction = await this.executeAction(intent, page, retryResolved);
        if (retryAction.success) {
          const durationMs = Date.now() - start;
          await this.emitCommand(intentId, new SucceedIntent(
            intentId, retryResolved.selector, retryResolved.method, durationMs, new Date().toISOString()
          ), { page: intent.page, intentName: intent.name });
          return { success: true, selector: retryResolved.selector, method: retryResolved.method, durationMs, recoveryAttempts };
        }
      }
    }

    // All attempts exhausted - escalate
    const durationMs = Date.now() - start;
    const errorMsg = "All resolution and recovery strategies exhausted";
    await this.emitCommand(intentId, new EscalateIntent(intentId, errorMsg, new Date().toISOString()));
    return { success: false, durationMs, error: errorMsg, recoveryAttempts };
  }

  private async tryStrategies(intent: Intent, page: Page, intentId: string): Promise<ResolvedIntent | null> {
    for (const strategy of this.strategies) {
      try {
        const result = await strategy.resolve(intent, page);
        if (result) {
          await this.emitCommand(intentId, new ResolveSelector(
            intentId, result.selector, result.method, result.durationMs, new Date().toISOString()
          ));
          return result;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async tryRecovery(intent: Intent, page: Page, error: Error, attempt: number, intentId: string): Promise<boolean> {
    for (const recovery of this.recoveryStrategies) {
      try {
        const canRecover = await recovery.canRecover(intent, page, error);
        if (!canRecover) continue;

        await this.emitCommand(intentId, new AttemptRecovery(
          intentId, error.message, recovery.name, attempt, new Date().toISOString()
        ));

        const result = await recovery.recover(intent, page, error);
        if (result.recovered) {
          await this.emitCommand(intentId, new SucceedRecovery(
            intentId, recovery.name, result.detail, new Date().toISOString()
          ));
          return true;
        } else {
          await this.emitCommand(intentId, new FailRecovery(
            intentId, recovery.name, result.detail, new Date().toISOString()
          ));
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async executeAction(intent: Intent, page: Page, resolved: ResolvedIntent): Promise<{ success: boolean }> {
    try {
      const locator = page.locator(resolved.selector).first();

      // Determine action from goal
      const goalLower = intent.goal.toLowerCase();
      if (goalLower.startsWith("fill") || goalLower.startsWith("type")) {
        await locator.fill(intent.value ?? "");
      } else if (goalLower.startsWith("select")) {
        await locator.selectOption(intent.value ?? "");
      } else if (goalLower.startsWith("check")) {
        await locator.check();
      } else if (goalLower.startsWith("uncheck")) {
        await locator.uncheck();
      } else {
        // Default: click
        await locator.click();
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async emitCommand(intentId: string, command: unknown, metadata?: unknown): Promise<void> {
    if (!this.commandHandler) return;
    try {
      await this.commandHandler(IntentExecution, intentId, command, metadata);
    } catch {
      // Never crash due to event emission failure
    }
  }
}
