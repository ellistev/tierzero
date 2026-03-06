import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IntentEngine } from "./engine";
import type { Intent, ResolvedIntent, ResolutionStrategy, RecoveryStrategy, SelectorCacheQuery, LLMProvider } from "./types";

// --- Mock helpers ---

function createMockPage(options: {
  locatorVisible?: boolean;
  locatorAction?: "succeed" | "fail";
} = {}): unknown {
  const { locatorVisible = true, locatorAction = "succeed" } = options;
  return {
    locator(selector: string) {
      return {
        first() {
          return {
            async isVisible() { return locatorVisible; },
            async click() { if (locatorAction === "fail") throw new Error("click failed"); },
            async fill() { if (locatorAction === "fail") throw new Error("fill failed"); },
            async selectOption() { if (locatorAction === "fail") throw new Error("select failed"); },
            async check() { if (locatorAction === "fail") throw new Error("check failed"); },
            async uncheck() { if (locatorAction === "fail") throw new Error("uncheck failed"); },
          };
        },
      };
    },
  };
}

function createMockStrategy(
  method: string,
  result: ResolvedIntent | null
): ResolutionStrategy {
  let callCount = 0;
  return {
    method: method as ResolvedIntent["method"],
    async resolve() {
      callCount++;
      return result;
    },
    get _callCount() { return callCount; },
  } as ResolutionStrategy & { _callCount: number };
}

function createFailThenSucceedStrategy(method: string, result: ResolvedIntent): ResolutionStrategy & { _callCount: number } {
  let callCount = 0;
  return {
    method: method as ResolvedIntent["method"],
    async resolve() {
      callCount++;
      return callCount > 1 ? result : null;
    },
    get _callCount() { return callCount; },
  };
}

function createMockRecovery(
  name: string,
  canRecoverResult: boolean,
  recoverResult: { recovered: boolean; detail: string }
): RecoveryStrategy {
  return {
    name,
    async canRecover() { return canRecoverResult; },
    async recover() { return recoverResult; },
  };
}

const testIntent: Intent = {
  name: "click-search",
  goal: "Click the Search button",
  page: "/admin",
};

// --- Tests ---

describe("IntentEngine", () => {
  it("should succeed with first strategy", async () => {
    const resolved: ResolvedIntent = { selector: "button#search", method: "cached", durationMs: 10 };
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", resolved)],
      recoveryStrategies: [],
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
    assert.equal(result.selector, "button#search");
    assert.equal(result.method, "cached");
    assert.equal(result.recoveryAttempts, 0);
  });

  it("should fall back to second strategy when first fails", async () => {
    const resolved: ResolvedIntent = { selector: "role=button[name='Search']", method: "aria", durationMs: 30 };
    const engine = new IntentEngine({
      strategies: [
        createMockStrategy("cached", null),
        createMockStrategy("aria", resolved),
      ],
      recoveryStrategies: [],
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
    assert.equal(result.method, "aria");
  });

  it("should escalate when all strategies fail and no recovery", async () => {
    const engine = new IntentEngine({
      strategies: [
        createMockStrategy("cached", null),
        createMockStrategy("aria", null),
      ],
      recoveryStrategies: [],
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error!.includes("exhausted"));
  });

  it("should attempt recovery and retry on failure", async () => {
    const resolved: ResolvedIntent = { selector: "button#search", method: "aria", durationMs: 20 };
    const strategy = createFailThenSucceedStrategy("aria", resolved);
    const recovery = createMockRecovery("dismiss-dialog", true, { recovered: true, detail: "Dismissed" });

    const engine = new IntentEngine({
      strategies: [strategy],
      recoveryStrategies: [recovery],
      maxRecoveryAttempts: 2,
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
    assert.equal(result.recoveryAttempts, 1);
    assert.equal(strategy._callCount, 2);
  });

  it("should escalate after max recovery attempts", async () => {
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", null)],
      recoveryStrategies: [
        createMockRecovery("dismiss", true, { recovered: true, detail: "Dismissed" }),
      ],
      maxRecoveryAttempts: 2,
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, false);
    assert.equal(result.recoveryAttempts, 2);
  });

  it("should skip recovery strategies that cannot recover", async () => {
    const resolved: ResolvedIntent = { selector: "button#search", method: "aria", durationMs: 20 };
    const strategy = createFailThenSucceedStrategy("aria", resolved);

    const engine = new IntentEngine({
      strategies: [strategy],
      recoveryStrategies: [
        createMockRecovery("cant-help", false, { recovered: false, detail: "nope" }),
        createMockRecovery("can-help", true, { recovered: true, detail: "fixed" }),
      ],
      maxRecoveryAttempts: 2,
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
    assert.equal(result.recoveryAttempts, 1);
  });

  it("should escalate when recovery fails", async () => {
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", null)],
      recoveryStrategies: [
        createMockRecovery("dismiss", true, { recovered: false, detail: "Could not dismiss" }),
      ],
      maxRecoveryAttempts: 1,
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, false);
    assert.equal(result.recoveryAttempts, 1);
  });

  it("should emit commands when commandHandler is provided", async () => {
    const emitted: unknown[] = [];
    const resolved: ResolvedIntent = { selector: "button#search", method: "cached", durationMs: 10 };

    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", resolved)],
      recoveryStrategies: [],
      commandHandler: async (_agg, _id, cmd) => { emitted.push(cmd); return {}; },
    });

    await engine.execute(testIntent, createMockPage() as never);
    // Should have emitted: AttemptIntent, ResolveSelector, SucceedIntent
    assert.ok(emitted.length >= 3);
  });

  it("should not crash when commandHandler throws", async () => {
    const resolved: ResolvedIntent = { selector: "button#search", method: "cached", durationMs: 10 };
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", resolved)],
      recoveryStrategies: [],
      commandHandler: async () => { throw new Error("emit failed"); },
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
  });

  it("should work without commandHandler", async () => {
    const resolved: ResolvedIntent = { selector: "button#search", method: "cached", durationMs: 10 };
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", resolved)],
      recoveryStrategies: [],
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, true);
  });

  it("should handle fill action from goal", async () => {
    const resolved: ResolvedIntent = { selector: "input#name", method: "aria", durationMs: 10 };
    const engine = new IntentEngine({
      strategies: [createMockStrategy("aria", resolved)],
      recoveryStrategies: [],
    });

    const fillIntent: Intent = {
      name: "fill-name",
      goal: "Fill the Name field",
      page: "/form",
      value: "John Doe",
    };

    const result = await engine.execute(fillIntent, createMockPage() as never);
    assert.equal(result.success, true);
  });

  it("should return duration for escalated intents", async () => {
    const engine = new IntentEngine({
      strategies: [createMockStrategy("cached", null)],
      recoveryStrategies: [],
    });

    const result = await engine.execute(testIntent, createMockPage() as never);
    assert.equal(result.success, false);
    assert.ok(result.durationMs >= 0);
  });

  it("should use default strategies when none specified but cache and LLM provided", () => {
    const mockCache: SelectorCacheQuery = { async get() { return null; } };
    const mockLLM: LLMProvider = {
      async findElementFromAccessibilityTree() { return null; },
      async findElementFromScreenshot() { return null; },
      async analyzePageForRecovery() { return null; },
    };

    const engine = new IntentEngine({ cache: mockCache, llm: mockLLM });
    // Should not throw - engine is constructed with default strategy chain
    assert.ok(engine);
  });

  it("should use default strategies without LLM (cached + aria only)", () => {
    const mockCache: SelectorCacheQuery = { async get() { return null; } };
    const engine = new IntentEngine({ cache: mockCache });
    assert.ok(engine);
  });

  it("should work with no options at all", () => {
    const engine = new IntentEngine();
    assert.ok(engine);
  });
});
