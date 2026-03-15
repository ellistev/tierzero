/**
 * Tests for IntentEngine.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  IntentEngine,
  CachedStrategy,
  AriaStrategy,
  LLMStrategy,
  VisionStrategy,
  InMemorySelectorCache,
} from "./engine";
import type { Intent, ResolvedIntent, Strategy, StrategyContext, IntentEvent } from "./types";

// ---------------------------------------------------------------------------
// Mock Strategy for testing
// ---------------------------------------------------------------------------

class MockStrategy implements Strategy {
  readonly name: string;
  private result: ResolvedIntent | null;
  public calledWith: { intent: Intent; context: StrategyContext } | null = null;

  constructor(name: string, result: ResolvedIntent | null) {
    this.name = name;
    this.result = result;
  }

  async resolve(intent: Intent, context: StrategyContext): Promise<ResolvedIntent | null> {
    this.calledWith = { intent, context };
    return this.result;
  }
}

class FailingStrategy implements Strategy {
  readonly name = "failing";
  async resolve(): Promise<ResolvedIntent | null> {
    throw new Error("Strategy failed");
  }
}

// ---------------------------------------------------------------------------
// InMemorySelectorCache
// ---------------------------------------------------------------------------

describe("InMemorySelectorCache", () => {
  it("stores and retrieves selectors", () => {
    const cache = new InMemorySelectorCache();
    cache.set("click:button", "#submit");
    assert.equal(cache.get("click:button"), "#submit");
  });

  it("returns undefined for missing keys", () => {
    const cache = new InMemorySelectorCache();
    assert.equal(cache.get("nonexistent"), undefined);
  });

  it("invalidates selectors", () => {
    const cache = new InMemorySelectorCache();
    cache.set("click:button", "#submit");
    cache.invalidate("click:button");
    assert.equal(cache.get("click:button"), undefined);
  });
});

// ---------------------------------------------------------------------------
// IntentEngine
// ---------------------------------------------------------------------------

describe("IntentEngine", () => {
  const testIntent: Intent = { action: "click", target: "submit button" };

  it("initializes with default strategies", () => {
    const engine = new IntentEngine();
    const strategies = engine.getStrategies();
    assert.equal(strategies.length, 4);
    assert.equal(strategies[0].name, "cached");
    assert.equal(strategies[1].name, "aria");
    assert.equal(strategies[2].name, "llm");
    assert.equal(strategies[3].name, "vision");
  });

  it("accepts custom strategies", () => {
    const mock = new MockStrategy("custom", null);
    const engine = new IntentEngine({ strategies: [mock] });
    assert.equal(engine.getStrategies().length, 1);
    assert.equal(engine.getStrategies()[0].name, "custom");
  });

  it("addStrategy appends to the chain", () => {
    const engine = new IntentEngine({ strategies: [] });
    const mock = new MockStrategy("added", null);
    engine.addStrategy(mock);
    assert.equal(engine.getStrategies().length, 1);
  });

  it("insertStrategy inserts at position", () => {
    const s1 = new MockStrategy("first", null);
    const s2 = new MockStrategy("second", null);
    const s3 = new MockStrategy("inserted", null);
    const engine = new IntentEngine({ strategies: [s1, s2] });
    engine.insertStrategy(s3, 1);
    const names = engine.getStrategies().map((s) => s.name);
    assert.deepEqual(names, ["first", "inserted", "second"]);
  });

  it("resolve returns first successful strategy result", async () => {
    const failStrat = new MockStrategy("fail", null);
    const successStrat = new MockStrategy("success", {
      intent: testIntent,
      selector: "#submit",
      confidence: 0.8,
      strategy: "success",
    });
    const neverCalled = new MockStrategy("never", {
      intent: testIntent,
      selector: "#other",
      confidence: 0.9,
      strategy: "never",
    });

    const engine = new IntentEngine({
      strategies: [failStrat, successStrat, neverCalled],
    });

    // Mock page
    const mockPage = {} as import("playwright").Page;
    const result = await engine.resolve(testIntent, mockPage);

    assert.ok(result);
    assert.equal(result!.selector, "#submit");
    assert.equal(result!.strategy, "success");
    assert.ok(failStrat.calledWith);
    assert.ok(successStrat.calledWith);
    assert.equal(neverCalled.calledWith, null); // Should not be called
  });

  it("resolve returns null when all strategies fail", async () => {
    const s1 = new MockStrategy("s1", null);
    const s2 = new MockStrategy("s2", null);
    const engine = new IntentEngine({ strategies: [s1, s2] });

    const mockPage = {} as import("playwright").Page;
    const result = await engine.resolve(testIntent, mockPage);
    assert.equal(result, null);
  });

  it("resolve skips throwing strategies", async () => {
    const failing = new FailingStrategy();
    const success = new MockStrategy("success", {
      intent: testIntent,
      selector: "#ok",
      confidence: 0.7,
      strategy: "success",
    });

    const engine = new IntentEngine({ strategies: [failing, success] });
    const mockPage = {} as import("playwright").Page;
    const result = await engine.resolve(testIntent, mockPage);

    assert.ok(result);
    assert.equal(result!.selector, "#ok");
  });

  it("resolve caches successful selector results", async () => {
    const cache = new InMemorySelectorCache();
    const success = new MockStrategy("success", {
      intent: testIntent,
      selector: "#cached-selector",
      confidence: 0.8,
      strategy: "success",
    });

    const engine = new IntentEngine({ strategies: [success], cache });
    const mockPage = {} as import("playwright").Page;

    await engine.resolve(testIntent, mockPage);
    assert.equal(cache.get("click:submit button"), "#cached-selector");
  });

  it("emits events during resolution", async () => {
    const events: IntentEvent[] = [];
    const success = new MockStrategy("s", {
      intent: testIntent,
      selector: "#x",
      confidence: 1,
      strategy: "s",
    });

    const engine = new IntentEngine({
      strategies: [success],
      eventHandler: (e) => events.push(e),
    });

    const mockPage = {} as import("playwright").Page;
    await engine.resolve(testIntent, mockPage);

    assert.equal(events.length, 2);
    assert.equal(events[0].type, "IntentResolutionStarted");
    assert.equal(events[1].type, "IntentResolved");
  });

  it("emits failure event when all strategies fail", async () => {
    const events: IntentEvent[] = [];
    const engine = new IntentEngine({
      strategies: [new MockStrategy("nope", null)],
      eventHandler: (e) => events.push(e),
    });

    const mockPage = {} as import("playwright").Page;
    await engine.resolve(testIntent, mockPage);

    assert.equal(events.length, 2);
    assert.equal(events[1].type, "IntentResolutionFailed");
  });
});

// ---------------------------------------------------------------------------
// CachedStrategy
// ---------------------------------------------------------------------------

describe("CachedStrategy", () => {
  it("returns null without cache", async () => {
    const strategy = new CachedStrategy();
    const result = await strategy.resolve(
      { action: "click", target: "button" },
      { page: {} as import("playwright").Page }
    );
    assert.equal(result, null);
  });

  it("returns cached selector", async () => {
    const cache = new InMemorySelectorCache();
    cache.set("click:button", "#btn");
    const strategy = new CachedStrategy();

    const result = await strategy.resolve(
      { action: "click", target: "button" },
      { page: {} as import("playwright").Page, cache }
    );

    assert.ok(result);
    assert.equal(result!.selector, "#btn");
    assert.equal(result!.strategy, "cached");
    assert.equal(result!.confidence, 0.9);
  });
});
