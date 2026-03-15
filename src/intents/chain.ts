/**
 * Multi-Step Action Chains - Execute sequences of intents
 * with state verification between steps.
 */

import type { Page } from "playwright";
import type { Intent, IntentEvent, IntentEventHandler, LLMProvider } from "./types";
import { IntentEngine } from "./engine";
import { executeResolvedIntent } from "./resolver";
import { capturePageState, diffPageState } from "../browser/page-state";
import type { PageState, PageStateDiff } from "../browser/page-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainStep {
  intent: Intent;
  /** Optional: expected state after this step */
  expectedState?: {
    urlContains?: string;
    titleContains?: string;
    noErrors?: boolean;
  };
  /** Condition: skip this step if predicate returns false */
  condition?: (state: PageState) => boolean;
  /** Max retries for this step */
  maxRetries?: number;
  /** Delay (ms) after executing this step */
  delayAfterMs?: number;
}

export interface ChainStepResult {
  step: ChainStep;
  status: "completed" | "failed" | "skipped" | "retried";
  attempts: number;
  stateBefore: PageState;
  stateAfter?: PageState;
  diff?: PageStateDiff;
  error?: string;
  timestamp: string;
}

export interface ChainResult {
  success: boolean;
  steps: ChainStepResult[];
  totalDuration: number;
}

export interface ActionChainOptions {
  engine: IntentEngine;
  page: Page;
  llm?: LLMProvider;
  eventHandler?: IntentEventHandler;
  defaultRetries?: number;
  defaultDelayMs?: number;
}

// ---------------------------------------------------------------------------
// ActionChain
// ---------------------------------------------------------------------------

export class ActionChain {
  private steps: ChainStep[];
  private engine: IntentEngine;
  private page: Page;
  private llm?: LLMProvider;
  private eventHandler?: IntentEventHandler;
  private defaultRetries: number;
  private defaultDelayMs: number;

  constructor(steps: ChainStep[], options: ActionChainOptions) {
    this.steps = steps;
    this.engine = options.engine;
    this.page = options.page;
    this.llm = options.llm;
    this.eventHandler = options.eventHandler;
    this.defaultRetries = options.defaultRetries ?? 2;
    this.defaultDelayMs = options.defaultDelayMs ?? 500;
  }

  /**
   * Execute all steps in sequence.
   */
  async execute(): Promise<ChainResult> {
    const startTime = Date.now();
    const results: ChainStepResult[] = [];
    const chainId = `chain-${Date.now()}`;

    this.emit({
      type: "ActionChainStarted",
      intentId: chainId,
      timestamp: new Date().toISOString(),
      data: { stepCount: this.steps.length },
    });

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const stepResult = await this.executeStep(step, i, chainId);
      results.push(stepResult);

      if (stepResult.status === "failed") {
        this.emit({
          type: "ActionChainFailed",
          intentId: chainId,
          timestamp: new Date().toISOString(),
          data: {
            failedStepIndex: i,
            error: stepResult.error,
            completedSteps: i,
          },
        });

        return {
          success: false,
          steps: results,
          totalDuration: Date.now() - startTime,
        };
      }
    }

    this.emit({
      type: "ActionChainCompleted",
      intentId: chainId,
      timestamp: new Date().toISOString(),
      data: { stepCount: results.length },
    });

    return {
      success: true,
      steps: results,
      totalDuration: Date.now() - startTime,
    };
  }

  private async executeStep(
    step: ChainStep,
    index: number,
    chainId: string
  ): Promise<ChainStepResult> {
    const maxRetries = step.maxRetries ?? this.defaultRetries;
    const delayMs = step.delayAfterMs ?? this.defaultDelayMs;

    // Capture state before
    const stateBefore = await capturePageState(this.page);

    // Check condition
    if (step.condition && !step.condition(stateBefore)) {
      this.emit({
        type: "ChainStepSkipped",
        intentId: chainId,
        timestamp: new Date().toISOString(),
        data: { stepIndex: index, reason: "condition not met" },
      });

      return {
        step,
        status: "skipped",
        attempts: 0,
        stateBefore,
        timestamp: new Date().toISOString(),
      };
    }

    // Handle modal dismissal before proceeding
    if (stateBefore.modals.length > 0) {
      try {
        await this.dismissModals();
      } catch {
        // Modal dismissal is best-effort
      }
    }

    // Attempt execution with retries
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        this.emit({
          type: "ChainStepStarted",
          intentId: chainId,
          timestamp: new Date().toISOString(),
          data: { stepIndex: index, attempt, intent: step.intent },
        });

        // Resolve and execute
        const resolved = await this.engine.resolve(step.intent, this.page);
        if (!resolved) {
          throw new Error(
            `Could not resolve intent: ${step.intent.action} on "${step.intent.target}"`
          );
        }

        await executeResolvedIntent(resolved, this.page);

        // Wait for page to settle
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        // Capture state after
        const stateAfter = await capturePageState(this.page);
        const diff = diffPageState(stateBefore, stateAfter);

        // Verify expected state
        if (step.expectedState) {
          this.verifyExpectedState(step.expectedState, stateAfter);
        }

        this.emit({
          type: "ChainStepCompleted",
          intentId: chainId,
          timestamp: new Date().toISOString(),
          data: { stepIndex: index, attempt, diff },
        });

        return {
          step,
          status: attempt > 1 ? "retried" : "completed",
          attempts: attempt,
          stateBefore,
          stateAfter,
          diff,
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        if (attempt <= maxRetries) {
          this.emit({
            type: "ChainStepRetrying",
            intentId: chainId,
            timestamp: new Date().toISOString(),
            data: { stepIndex: index, attempt, error },
          });

          // Try recovery via LLM
          if (this.llm) {
            try {
              const pageContent =
                (await this.page.evaluate(
                  () => document.body?.innerText ?? ""
                )) ?? "";
              const recovery = await this.llm.analyzePageForRecovery(
                step.intent,
                pageContent,
                error
              );
              if (recovery?.action === "wait") {
                await new Promise((r) => setTimeout(r, 2000));
              } else if (recovery?.action === "dismiss_modal") {
                await this.dismissModals();
              } else if (recovery?.action === "scroll") {
                await this.page.evaluate(() => window.scrollBy(0, 300));
              } else if (recovery?.action === "refresh") {
                await this.page.reload();
              }
            } catch {
              // Recovery failed, continue with retry
            }
          }

          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        return {
          step,
          status: "failed",
          attempts: attempt,
          stateBefore,
          error,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Unreachable
    return {
      step,
      status: "failed",
      attempts: maxRetries + 1,
      stateBefore,
      error: "Exhausted retries",
      timestamp: new Date().toISOString(),
    };
  }

  private verifyExpectedState(
    expected: NonNullable<ChainStep["expectedState"]>,
    state: PageState
  ): void {
    if (expected.urlContains && !state.url.includes(expected.urlContains)) {
      throw new Error(
        `Expected URL to contain "${expected.urlContains}" but got "${state.url}"`
      );
    }
    if (
      expected.titleContains &&
      !state.title.includes(expected.titleContains)
    ) {
      throw new Error(
        `Expected title to contain "${expected.titleContains}" but got "${state.title}"`
      );
    }
    if (expected.noErrors && state.errorMessages.length > 0) {
      throw new Error(
        `Expected no errors but found: ${state.errorMessages.join("; ")}`
      );
    }
  }

  private async dismissModals(): Promise<void> {
    // Try common dismiss patterns
    const dismissSelectors = [
      "[role='dialog'] button[aria-label='Close']",
      "[role='dialog'] button:has-text('Close')",
      "[role='dialog'] button:has-text('Cancel')",
      "[role='dialog'] button:has-text('Dismiss')",
      ".modal-close",
      "button.close",
    ];

    for (const selector of dismissSelectors) {
      try {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 500 })) {
          await el.click();
          await new Promise((r) => setTimeout(r, 300));
          return;
        }
      } catch {
        // Continue trying
      }
    }

    // Fallback: press Escape
    await this.page.keyboard.press("Escape");
  }

  private emit(event: IntentEvent): void {
    this.eventHandler?.(event);
  }
}
