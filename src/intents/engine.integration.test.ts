/**
 * Integration tests for IntentEngine with CoordinateStrategy.
 * Verifies the full strategy chain works together.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IntentEngine } from "./engine";
import { CoordinateStrategy } from "./resolver";
import type { Intent, ResolvedIntent, Strategy, StrategyContext, LLMProvider } from "./types";

// ---------------------------------------------------------------------------
// Mock LLM that returns predictable results
// ---------------------------------------------------------------------------

function createMockLLM(): LLMProvider {
  return {
    async findElementFromAccessibilityTree(intent, tree) {
      if (tree.includes(intent.target)) return `[data-testid="${intent.target}"]`;
      return null;
    },
    async findElementFromScreenshot(intent) {
      return { selector: `#${intent.target.replace(/\s+/g, "-")}` };
    },
    async analyzePageForRecovery() {
      return { action: "retry", detail: "Try again" };
    },
    async findCoordinatesFromScreenshot(intent, _base64, viewport) {
      return { x: viewport.width / 2, y: viewport.height / 2, width: 100, height: 40 };
    },
    async verifyVisualCondition() {
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntentEngine with CoordinateStrategy", () => {
  it("includes CoordinateStrategy when added to chain", () => {
    const engine = new IntentEngine();
    engine.addStrategy(new CoordinateStrategy());

    const names = engine.getStrategies().map((s) => s.name);
    assert.ok(names.includes("coordinate"));
    // Should be last in chain
    assert.equal(names[names.length - 1], "coordinate");
  });

  it("CoordinateStrategy is after VisionStrategy in default chain", () => {
    const engine = new IntentEngine();
    engine.addStrategy(new CoordinateStrategy());

    const names = engine.getStrategies().map((s) => s.name);
    const visionIdx = names.indexOf("vision");
    const coordIdx = names.indexOf("coordinate");
    assert.ok(coordIdx > visionIdx);
  });

  it("CoordinateStrategy requires LLM with findCoordinatesFromScreenshot", async () => {
    const strategy = new CoordinateStrategy();
    const result = await strategy.resolve(
      { action: "click", target: "button" },
      { page: {} as import("playwright").Page } // No LLM
    );
    assert.equal(result, null);
  });

  it("CoordinateStrategy requires viewport size", async () => {
    const strategy = new CoordinateStrategy();
    const mockPage = {
      viewportSize: () => null,
    } as unknown as import("playwright").Page;

    const mockLLM = createMockLLM();
    const result = await strategy.resolve(
      { action: "click", target: "button" },
      { page: mockPage, llm: mockLLM }
    );
    assert.equal(result, null);
  });

  it("CoordinateStrategy returns coordinates on success", async () => {
    const strategy = new CoordinateStrategy();
    const mockPage = {
      viewportSize: () => ({ width: 1920, height: 1080 }),
      screenshot: async () => Buffer.from("fake-png"),
    } as unknown as import("playwright").Page;

    const mockLLM = createMockLLM();
    const result = await strategy.resolve(
      { action: "click", target: "submit" },
      { page: mockPage, llm: mockLLM }
    );

    assert.ok(result);
    assert.equal(result!.strategy, "coordinate");
    assert.ok(result!.coordinates);
    assert.equal(result!.coordinates!.x, 960);
    assert.equal(result!.coordinates!.y, 540);
    assert.equal(result!.confidence, 0.5);
  });
});

describe("Full strategy chain resolution", () => {
  it("falls through strategies until one succeeds", async () => {
    const callOrder: string[] = [];

    class TrackingStrategy implements Strategy {
      constructor(
        readonly name: string,
        private result: ResolvedIntent | null
      ) {}

      async resolve(intent: Intent, context: StrategyContext) {
        callOrder.push(this.name);
        return this.result;
      }
    }

    const intent: Intent = { action: "click", target: "save" };
    const engine = new IntentEngine({
      strategies: [
        new TrackingStrategy("s1", null),
        new TrackingStrategy("s2", null),
        new TrackingStrategy("s3", {
          intent,
          selector: "#save",
          confidence: 0.7,
          strategy: "s3",
        }),
        new TrackingStrategy("s4", null),
      ],
    });

    const mockPage = {} as import("playwright").Page;
    const result = await engine.resolve(intent, mockPage);

    assert.ok(result);
    assert.equal(result!.strategy, "s3");
    assert.deepEqual(callOrder, ["s1", "s2", "s3"]);
  });
});
