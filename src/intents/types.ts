/**
 * Core types for the TierZero Intent Engine.
 */

// Re-export Page type for convenience (Playwright is a peer dep)
export type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export interface Intent {
  /** Action to perform: click, fill, navigate, select, hover, scroll, etc. */
  action: string;
  /** Human-readable description of the target element */
  target: string;
  /** Value for fill/select actions */
  value?: string;
  /** CSS or ARIA selector if already known */
  selector?: string;
  /** Coordinate-based target if known */
  coordinates?: { x: number; y: number; width?: number; height?: number };
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Resolved Intent (output of the strategy chain)
// ---------------------------------------------------------------------------

export interface ResolvedIntent {
  intent: Intent;
  selector?: string;
  coordinates?: { x: number; y: number };
  confidence: number;
  strategy: string;
}

// ---------------------------------------------------------------------------
// LLM Provider Interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /**
   * Parse an accessibility tree and return the best CSS/aria selector
   * for the element matching the intent.
   */
  findElementFromAccessibilityTree(
    intent: Intent,
    tree: string
  ): Promise<string | null>;

  /**
   * Analyze a screenshot and return a selector or coordinates
   * for the element matching the intent.
   */
  findElementFromScreenshot(
    intent: Intent,
    base64: string
  ): Promise<{ selector?: string; coordinates?: { x: number; y: number } } | null>;

  /**
   * Diagnose the current page state after an error and suggest a recovery action.
   */
  analyzePageForRecovery(
    intent: Intent,
    pageContent: string,
    error: string
  ): Promise<{ action: string; detail: string } | null>;

  /**
   * Parse a natural language goal into a structured Intent.
   */
  parseGoalToIntent?(goal: string): Promise<Intent>;

  /**
   * Decompose a complex goal into a sequence of atomic intents.
   */
  decomposeGoal?(goal: string): Promise<Intent[]>;

  /**
   * Identify element coordinates from a screenshot.
   */
  findCoordinatesFromScreenshot?(
    intent: Intent,
    base64: string,
    viewport: { width: number; height: number }
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;

  /**
   * Verify whether a visual condition is met on a screenshot.
   */
  verifyVisualCondition?(
    description: string,
    base64: string
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Strategy Interface
// ---------------------------------------------------------------------------

export interface StrategyContext {
  page: import("playwright").Page;
  llm?: LLMProvider;
  cache?: SelectorCache;
}

export interface Strategy {
  readonly name: string;
  resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null>;
}

// ---------------------------------------------------------------------------
// Selector Cache
// ---------------------------------------------------------------------------

export interface SelectorCache {
  get(intentKey: string): string | undefined;
  set(intentKey: string, selector: string): void;
  invalidate(intentKey: string): void;
}

// ---------------------------------------------------------------------------
// Engine Events (CQRS)
// ---------------------------------------------------------------------------

export interface IntentEvent {
  type: string;
  intentId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export type IntentEventHandler = (event: IntentEvent) => void;
