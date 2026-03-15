/**
 * IntentEngine - Resolves intents into concrete browser actions
 * via a strategy chain: Cached -> Aria -> LLM -> Vision -> Coordinate.
 */

import type {
  Intent,
  ResolvedIntent,
  Strategy,
  StrategyContext,
  LLMProvider,
  SelectorCache,
  IntentEvent,
  IntentEventHandler,
} from "./types";

// ---------------------------------------------------------------------------
// Built-in strategies
// ---------------------------------------------------------------------------

/**
 * CachedStrategy - looks up previously-resolved selectors.
 */
export class CachedStrategy implements Strategy {
  readonly name = "cached";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    if (!context.cache) return null;
    const key = `${intent.action}:${intent.target}`;
    const selector = context.cache.get(key);
    if (!selector) return null;

    return {
      intent,
      selector,
      confidence: 0.9,
      strategy: this.name,
    };
  }
}

/**
 * AriaStrategy - uses Playwright's accessibility tree to find elements.
 */
export class AriaStrategy implements Strategy {
  readonly name = "aria";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    if (intent.selector) {
      return {
        intent,
        selector: intent.selector,
        confidence: 1.0,
        strategy: this.name,
      };
    }

    try {
      const snapshot = await context.page.accessibility.snapshot();
      if (!snapshot) return null;

      const selector = this.findInTree(intent, snapshot);
      if (!selector) return null;

      return { intent, selector, confidence: 0.8, strategy: this.name };
    } catch {
      return null;
    }
  }

  private findInTree(
    intent: Intent,
    node: Record<string, unknown>
  ): string | null {
    const name = (node.name as string) ?? "";
    const role = (node.role as string) ?? "";
    const target = intent.target.toLowerCase();

    if (name.toLowerCase().includes(target)) {
      if (role) return `[role="${role}"][name="${name}"]`;
      return `[aria-label="${name}"]`;
    }

    const children = (node.children as Record<string, unknown>[]) ?? [];
    for (const child of children) {
      const found = this.findInTree(intent, child);
      if (found) return found;
    }

    return null;
  }
}

/**
 * LLMStrategy - sends the accessibility tree to an LLM to find the element.
 */
export class LLMStrategy implements Strategy {
  readonly name = "llm";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    if (!context.llm) return null;

    try {
      const snapshot = await context.page.accessibility.snapshot();
      if (!snapshot) return null;

      const tree = JSON.stringify(snapshot, null, 2);
      const selector = await context.llm.findElementFromAccessibilityTree(
        intent,
        tree
      );
      if (!selector) return null;

      return { intent, selector, confidence: 0.7, strategy: this.name };
    } catch {
      return null;
    }
  }
}

/**
 * VisionStrategy - takes a screenshot and asks the LLM to identify the element.
 */
export class VisionStrategy implements Strategy {
  readonly name = "vision";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    if (!context.llm?.findElementFromScreenshot) return null;

    try {
      const buf = await context.page.screenshot({ type: "png" });
      const base64 = buf.toString("base64");

      const result = await context.llm.findElementFromScreenshot(
        intent,
        base64
      );
      if (!result) return null;

      return {
        intent,
        selector: result.selector,
        coordinates: result.coordinates,
        confidence: 0.6,
        strategy: this.name,
      };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory selector cache
// ---------------------------------------------------------------------------

export class InMemorySelectorCache implements SelectorCache {
  private store = new Map<string, string>();

  get(intentKey: string): string | undefined {
    return this.store.get(intentKey);
  }

  set(intentKey: string, selector: string): void {
    this.store.set(intentKey, selector);
  }

  invalidate(intentKey: string): void {
    this.store.delete(intentKey);
  }
}

// ---------------------------------------------------------------------------
// IntentEngine
// ---------------------------------------------------------------------------

export interface IntentEngineOptions {
  strategies?: Strategy[];
  llm?: LLMProvider;
  cache?: SelectorCache;
  eventHandler?: IntentEventHandler;
}

export class IntentEngine {
  private strategies: Strategy[];
  private llm?: LLMProvider;
  private cache?: SelectorCache;
  private eventHandler?: IntentEventHandler;

  constructor(options: IntentEngineOptions = {}) {
    this.llm = options.llm;
    this.cache = options.cache;
    this.eventHandler = options.eventHandler;
    this.strategies = options.strategies ?? [
      new CachedStrategy(),
      new AriaStrategy(),
      new LLMStrategy(),
      new VisionStrategy(),
    ];
  }

  /**
   * Add a strategy to the end of the chain.
   */
  addStrategy(strategy: Strategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Insert a strategy at a specific position.
   */
  insertStrategy(strategy: Strategy, index: number): void {
    this.strategies.splice(index, 0, strategy);
  }

  /**
   * Get the current strategy chain.
   */
  getStrategies(): readonly Strategy[] {
    return this.strategies;
  }

  /**
   * Resolve an intent by walking the strategy chain.
   */
  async resolve(
    intent: Intent,
    page: import("playwright").Page
  ): Promise<ResolvedIntent | null> {
    const context: StrategyContext = {
      page,
      llm: this.llm,
      cache: this.cache,
    };

    const intentId = `${intent.action}:${intent.target}:${Date.now()}`;

    this.emit({
      type: "IntentResolutionStarted",
      intentId,
      timestamp: new Date().toISOString(),
      data: { intent },
    });

    for (const strategy of this.strategies) {
      try {
        const result = await strategy.resolve(intent, context);
        if (result) {
          // Cache successful resolutions
          if (this.cache && result.selector) {
            const key = `${intent.action}:${intent.target}`;
            this.cache.set(key, result.selector);
          }

          this.emit({
            type: "IntentResolved",
            intentId,
            timestamp: new Date().toISOString(),
            data: {
              intent,
              strategy: result.strategy,
              selector: result.selector,
              coordinates: result.coordinates,
              confidence: result.confidence,
            },
          });

          return result;
        }
      } catch {
        // Strategy failed, try next
      }
    }

    this.emit({
      type: "IntentResolutionFailed",
      intentId,
      timestamp: new Date().toISOString(),
      data: { intent, strategiesTried: this.strategies.map((s) => s.name) },
    });

    return null;
  }

  private emit(event: IntentEvent): void {
    this.eventHandler?.(event);
  }
}
