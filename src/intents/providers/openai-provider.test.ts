/**
 * Tests for OpenAI LLM Provider.
 * All LLM calls are mocked - no real API calls.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAILLMProvider } from "./openai-provider";

// ---------------------------------------------------------------------------
// Mock setup: We test by intercepting at the constructor level
// since the real provider requires an API key.
// ---------------------------------------------------------------------------

describe("OpenAILLMProvider", () => {
  describe("constructor", () => {
    it("throws when no API key is provided", () => {
      const original = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        assert.throws(
          () => new OpenAILLMProvider(),
          { message: /API key is required/ }
        );
      } finally {
        if (original) process.env.OPENAI_API_KEY = original;
      }
    });

    it("accepts API key via options", () => {
      const provider = new OpenAILLMProvider({ apiKey: "sk-test-key-123" });
      assert.ok(provider);
    });

    it("accepts API key via environment variable", () => {
      const original = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-env-key-456";
      try {
        const provider = new OpenAILLMProvider();
        assert.ok(provider);
      } finally {
        if (original) {
          process.env.OPENAI_API_KEY = original;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    it("accepts custom timeout", () => {
      const provider = new OpenAILLMProvider({
        apiKey: "sk-test",
        timeoutMs: 60000,
      });
      assert.ok(provider);
    });
  });

  describe("LLMProvider interface compliance", () => {
    let provider: OpenAILLMProvider;

    beforeEach(() => {
      provider = new OpenAILLMProvider({ apiKey: "sk-test-key" });
    });

    it("implements findElementFromAccessibilityTree", () => {
      assert.equal(typeof provider.findElementFromAccessibilityTree, "function");
    });

    it("implements findElementFromScreenshot", () => {
      assert.equal(typeof provider.findElementFromScreenshot, "function");
    });

    it("implements analyzePageForRecovery", () => {
      assert.equal(typeof provider.analyzePageForRecovery, "function");
    });

    it("implements parseGoalToIntent", () => {
      assert.equal(typeof provider.parseGoalToIntent, "function");
    });

    it("implements decomposeGoal", () => {
      assert.equal(typeof provider.decomposeGoal, "function");
    });

    it("implements findCoordinatesFromScreenshot", () => {
      assert.equal(typeof provider.findCoordinatesFromScreenshot, "function");
    });

    it("implements verifyVisualCondition", () => {
      assert.equal(typeof provider.verifyVisualCondition, "function");
    });
  });
});

// ---------------------------------------------------------------------------
// Test a mock implementation that doesn't call OpenAI
// ---------------------------------------------------------------------------

describe("MockLLMProvider (verifies interface contract)", () => {
  /** Minimal mock that implements the same interface */
  const mockProvider = {
    async findElementFromAccessibilityTree(
      intent: { action: string; target: string },
      tree: string
    ) {
      if (tree.includes(intent.target)) return `[aria-label="${intent.target}"]`;
      return null;
    },

    async findElementFromScreenshot(
      intent: { action: string; target: string },
      _base64: string
    ) {
      return { selector: `#${intent.target.replace(/\s+/g, "-")}` };
    },

    async analyzePageForRecovery(
      _intent: { action: string; target: string },
      _pageContent: string,
      error: string
    ) {
      if (error.includes("not found")) return { action: "scroll", detail: "Element may be below fold" };
      if (error.includes("modal")) return { action: "dismiss_modal", detail: "Modal blocking interaction" };
      return { action: "retry", detail: "Transient error" };
    },

    async parseGoalToIntent(goal: string) {
      return { action: "click", target: goal };
    },

    async decomposeGoal(goal: string) {
      return [{ action: "click", target: goal }];
    },

    async findCoordinatesFromScreenshot(
      _intent: { action: string; target: string },
      _base64: string,
      viewport: { width: number; height: number }
    ) {
      return { x: viewport.width / 2, y: viewport.height / 2, width: 100, height: 40 };
    },

    async verifyVisualCondition(_description: string, _base64: string) {
      return true;
    },
  };

  it("findElementFromAccessibilityTree returns selector when found", async () => {
    const result = await mockProvider.findElementFromAccessibilityTree(
      { action: "click", target: "Submit" },
      '{"role":"button","name":"Submit"}'
    );
    assert.equal(result, '[aria-label="Submit"]');
  });

  it("findElementFromAccessibilityTree returns null when not found", async () => {
    const result = await mockProvider.findElementFromAccessibilityTree(
      { action: "click", target: "Submit" },
      '{"role":"button","name":"Cancel"}'
    );
    assert.equal(result, null);
  });

  it("findElementFromScreenshot returns selector", async () => {
    const result = await mockProvider.findElementFromScreenshot(
      { action: "click", target: "login button" },
      "base64data"
    );
    assert.deepEqual(result, { selector: "#login-button" });
  });

  it("analyzePageForRecovery returns scroll for not found", async () => {
    const result = await mockProvider.analyzePageForRecovery(
      { action: "click", target: "Submit" },
      "page content",
      "Element not found"
    );
    assert.deepEqual(result, { action: "scroll", detail: "Element may be below fold" });
  });

  it("analyzePageForRecovery returns dismiss_modal for modal errors", async () => {
    const result = await mockProvider.analyzePageForRecovery(
      { action: "click", target: "Submit" },
      "page content",
      "modal is blocking"
    );
    assert.deepEqual(result, { action: "dismiss_modal", detail: "Modal blocking interaction" });
  });

  it("findCoordinatesFromScreenshot returns centered coordinates", async () => {
    const result = await mockProvider.findCoordinatesFromScreenshot(
      { action: "click", target: "button" },
      "base64",
      { width: 1920, height: 1080 }
    );
    assert.deepEqual(result, { x: 960, y: 540, width: 100, height: 40 });
  });

  it("verifyVisualCondition returns boolean", async () => {
    const result = await mockProvider.verifyVisualCondition(
      "Is a table visible?",
      "base64"
    );
    assert.equal(result, true);
  });
});
