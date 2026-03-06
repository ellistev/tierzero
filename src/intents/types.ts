import type { Page } from "playwright";

/**
 * An Intent describes WHAT to achieve on a page, not HOW.
 * The IntentEngine resolves the "how" adaptively.
 */
export interface Intent {
  /** Unique name for this intent (e.g. "click-search-button") */
  name: string;
  /** Human-readable goal (e.g. "Click the Search button") */
  goal: string;
  /** Page URL pattern this intent applies to */
  page: string;
  /** Optional value to fill/select (for fill/select intents) */
  value?: string;
  /** Optional additional context for LLM-based resolution */
  context?: Record<string, unknown>;
}

/**
 * Result of resolving an intent to a concrete selector.
 */
export interface ResolvedIntent {
  selector: string;
  method: ResolutionMethod;
  durationMs: number;
}

export type ResolutionMethod = "cached" | "aria" | "vision" | "llm";

/**
 * A resolution strategy that can find an element on a page.
 * Strategies are tried in order by the IntentEngine.
 */
export interface ResolutionStrategy {
  readonly method: ResolutionMethod;
  resolve(intent: Intent, page: Page): Promise<ResolvedIntent | null>;
}

/**
 * A recovery strategy for when the page is in an unexpected state.
 */
export interface RecoveryStrategy {
  readonly name: string;
  canRecover(intent: Intent, page: Page, error: Error): Promise<boolean>;
  recover(intent: Intent, page: Page, error: Error): Promise<{ recovered: boolean; detail: string }>;
}

/**
 * LLM provider interface - abstracted for pluggability and testing.
 */
export interface LLMProvider {
  /**
   * Given an accessibility tree (text), find the best selector for the intent.
   */
  findElementFromAccessibilityTree(
    intent: Intent,
    accessibilityTree: string
  ): Promise<string | null>;

  /**
   * Given a screenshot (base64), find coordinates or selector for the intent.
   */
  findElementFromScreenshot(
    intent: Intent,
    screenshotBase64: string
  ): Promise<string | null>;

  /**
   * Analyze unexpected page state and suggest recovery actions.
   */
  analyzePageForRecovery(
    intent: Intent,
    pageContent: string,
    error: string
  ): Promise<{ action: "navigate" | "dismiss" | "wait" | "escalate"; detail: string } | null>;
}

/**
 * Cached selector entry from the read model.
 */
export interface CachedSelector {
  selector: string;
  method: string;
  successCount: number;
  lastUsed: string;
  avgDurationMs: number;
}

/**
 * Interface for querying the selector cache read model.
 */
export interface SelectorCacheQuery {
  get(page: string, intentName: string): Promise<CachedSelector | null>;
}
