/**
 * Tests for Multi-Step Action Chains.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionChain } from "./chain";
import type { ChainStep } from "./chain";
import { IntentEngine } from "./engine";
import type { Intent, ResolvedIntent, Strategy, StrategyContext, IntentEvent } from "./types";
import type { PageState } from "../browser/page-state";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Strategy that always succeeds */
class AlwaysSucceedStrategy implements Strategy {
  readonly name = "mock-succeed";
  async resolve(intent: Intent): Promise<ResolvedIntent> {
    return {
      intent,
      selector: "#mock",
      confidence: 1,
      strategy: this.name,
    };
  }
}

/** Strategy that always fails */
class AlwaysFailStrategy implements Strategy {
  readonly name = "mock-fail";
  async resolve(): Promise<null> {
    return null;
  }
}

/** Create a mock page that returns predictable state */
function createMockPage(overrides: Partial<{
  url: string;
  title: string;
  innerText: string;
  clickThrows: boolean;
}> = {}) {
  const config = {
    url: "https://app.com/page",
    title: "Test Page",
    innerText: "Hello World",
    clickThrows: false,
    ...overrides,
  };

  return {
    url: () => config.url,
    title: () => Promise.resolve(config.title),
    click: async () => {
      if (config.clickThrows) throw new Error("Click failed");
    },
    fill: async () => {},
    evaluate: async (fn: Function) => {
      // Handle capturePageState's evaluate calls
      if (typeof fn === "function") {
        try {
          return fn();
        } catch {
          return {
            visibleText: config.innerText,
            forms: [],
            buttons: [],
            links: [],
            modals: [],
            errorMessages: [],
            headings: [],
          };
        }
      }
      return config.innerText;
    },
    locator: () => ({
      first: () => ({
        isVisible: async () => false,
        click: async () => {},
      }),
    }),
    keyboard: {
      press: async () => {},
      type: async () => {},
    },
    mouse: {
      click: async () => {},
      move: async () => {},
    },
    screenshot: async () => Buffer.from("fake"),
    accessibility: { snapshot: async () => ({}) },
    viewportSize: () => ({ width: 1920, height: 1080 }),
  } as unknown as import("playwright").Page;
}

// ---------------------------------------------------------------------------
// ActionChain
// ---------------------------------------------------------------------------

describe("ActionChain", () => {
  it("executes a single step successfully", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "button" } },
    ];

    const chain = new ActionChain(steps, { engine, page });
    const result = await chain.execute();

    assert.equal(result.success, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].status, "completed");
  });

  it("executes multiple steps in sequence", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "button1" } },
      { intent: { action: "fill", target: "input1", value: "hello" } },
      { intent: { action: "click", target: "submit" } },
    ];

    const chain = new ActionChain(steps, { engine, page, defaultDelayMs: 0 });
    const result = await chain.execute();

    assert.equal(result.success, true);
    assert.equal(result.steps.length, 3);
    assert.ok(result.steps.every((s) => s.status === "completed"));
  });

  it("fails when a step cannot be resolved", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysFailStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "nonexistent" }, maxRetries: 0 },
    ];

    const chain = new ActionChain(steps, { engine, page, defaultDelayMs: 0 });
    const result = await chain.execute();

    assert.equal(result.success, false);
    assert.equal(result.steps[0].status, "failed");
    assert.ok(result.steps[0].error?.includes("Could not resolve"));
  });

  it("skips steps when condition returns false", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      {
        intent: { action: "click", target: "dismiss" },
        condition: (state: PageState) => state.modals.length > 0,
      },
      { intent: { action: "click", target: "next" } },
    ];

    const chain = new ActionChain(steps, { engine, page, defaultDelayMs: 0 });
    const result = await chain.execute();

    assert.equal(result.success, true);
    assert.equal(result.steps[0].status, "skipped");
    assert.equal(result.steps[1].status, "completed");
  });

  it("emits events for chain lifecycle", async () => {
    const events: IntentEvent[] = [];
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "button" } },
    ];

    const chain = new ActionChain(steps, {
      engine,
      page,
      eventHandler: (e) => events.push(e),
      defaultDelayMs: 0,
    });

    await chain.execute();

    const types = events.map((e) => e.type);
    assert.ok(types.includes("ActionChainStarted"));
    assert.ok(types.includes("ChainStepStarted"));
    assert.ok(types.includes("ChainStepCompleted"));
    assert.ok(types.includes("ActionChainCompleted"));
  });

  it("emits failure event when chain fails", async () => {
    const events: IntentEvent[] = [];
    const engine = new IntentEngine({ strategies: [new AlwaysFailStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "missing" }, maxRetries: 0 },
    ];

    const chain = new ActionChain(steps, {
      engine,
      page,
      eventHandler: (e) => events.push(e),
      defaultDelayMs: 0,
    });

    await chain.execute();

    const types = events.map((e) => e.type);
    assert.ok(types.includes("ActionChainFailed"));
  });

  it("records totalDuration", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const chain = new ActionChain(
      [{ intent: { action: "click", target: "btn" } }],
      { engine, page, defaultDelayMs: 0 }
    );

    const result = await chain.execute();
    assert.equal(typeof result.totalDuration, "number");
    assert.ok(result.totalDuration >= 0);
  });

  it("captures state before and after each step", async () => {
    const engine = new IntentEngine({ strategies: [new AlwaysSucceedStrategy()] });
    const page = createMockPage();

    const chain = new ActionChain(
      [{ intent: { action: "click", target: "btn" } }],
      { engine, page, defaultDelayMs: 0 }
    );

    const result = await chain.execute();
    assert.ok(result.steps[0].stateBefore);
    assert.ok(result.steps[0].stateAfter);
    assert.ok(result.steps[0].diff);
  });

  it("stops execution on first failure", async () => {
    const callCount = { value: 0 };

    class CountingStrategy implements Strategy {
      readonly name = "counting";
      async resolve(intent: Intent): Promise<ResolvedIntent | null> {
        callCount.value++;
        if (intent.target === "fail") return null;
        return { intent, selector: "#ok", confidence: 1, strategy: "counting" };
      }
    }

    const engine = new IntentEngine({ strategies: [new CountingStrategy()] });
    const page = createMockPage();

    const steps: ChainStep[] = [
      { intent: { action: "click", target: "ok" } },
      { intent: { action: "click", target: "fail" }, maxRetries: 0 },
      { intent: { action: "click", target: "never-reached" } },
    ];

    const chain = new ActionChain(steps, { engine, page, defaultDelayMs: 0 });
    const result = await chain.execute();

    assert.equal(result.success, false);
    assert.equal(result.steps.length, 2); // Third step never executed
  });
});
