/**
 * Tests for Smart Intent Parser.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseIntentFallback,
  parseIntent,
  decomposeIntent,
  decomposeIntentFallback,
} from "./parser";
import type { Intent, LLMProvider } from "./types";

// ---------------------------------------------------------------------------
// parseIntentFallback (regex-based)
// ---------------------------------------------------------------------------

describe("parseIntentFallback", () => {
  it("parses click action", () => {
    const intent = parseIntentFallback("click the submit button");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "submit button");
  });

  it("parses click on action", () => {
    const intent = parseIntentFallback("click on the login link");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "login link");
  });

  it("parses tap action as click", () => {
    const intent = parseIntentFallback("tap the menu icon");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "menu icon");
  });

  it("parses press action as click", () => {
    const intent = parseIntentFallback("press the Enter key");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "Enter key");
  });

  it("parses fill action with target and value", () => {
    const intent = parseIntentFallback('fill the email field with "user@test.com"');
    assert.equal(intent.action, "fill");
    assert.equal(intent.target, "email field");
    assert.equal(intent.value, "user@test.com");
  });

  it("parses type action as fill", () => {
    const intent = parseIntentFallback("type in the search box with 'hello'");
    assert.equal(intent.action, "fill");
    assert.equal(intent.target, "search box");
    assert.equal(intent.value, "hello");
  });

  it("parses fill with reversed syntax (value into target)", () => {
    const intent = parseIntentFallback('enter "John" into the name field');
    assert.equal(intent.action, "fill");
    assert.equal(intent.target, "name field");
    assert.equal(intent.value, "John");
  });

  it("parses set/change action as fill", () => {
    const intent = parseIntentFallback('set the quantity to "5"');
    assert.equal(intent.action, "fill");
    assert.equal(intent.target, "quantity");
    assert.equal(intent.value, "5");
  });

  it("parses select action", () => {
    const intent = parseIntentFallback('select "USD" from the currency dropdown');
    assert.equal(intent.action, "select");
    assert.equal(intent.target, "currency dropdown");
    assert.equal(intent.value, "USD");
  });

  it("parses navigate action", () => {
    const intent = parseIntentFallback("go to https://example.com");
    assert.equal(intent.action, "navigate");
    assert.equal(intent.target, "https://example.com");
  });

  it("parses open as navigate", () => {
    const intent = parseIntentFallback("open the settings page");
    assert.equal(intent.action, "navigate");
    assert.equal(intent.target, "the settings page");
  });

  it("parses hover action", () => {
    const intent = parseIntentFallback("hover over the profile menu");
    assert.equal(intent.action, "hover");
    assert.equal(intent.target, "profile menu");
  });

  it("parses scroll action", () => {
    const intent = parseIntentFallback("scroll down to the footer");
    assert.equal(intent.action, "scroll");
    assert.equal(intent.target, "down to the footer");
  });

  it("parses wait action", () => {
    const intent = parseIntentFallback("wait for the loading spinner");
    assert.equal(intent.action, "wait");
    assert.equal(intent.target, "the loading spinner");
  });

  it("parses check action", () => {
    const intent = parseIntentFallback("check the terms checkbox");
    assert.equal(intent.action, "check");
    assert.equal(intent.target, "terms checkbox");
  });

  it("parses uncheck action", () => {
    const intent = parseIntentFallback("uncheck the newsletter option");
    assert.equal(intent.action, "uncheck");
    assert.equal(intent.target, "newsletter option");
  });

  it("defaults to click for unrecognized patterns", () => {
    const intent = parseIntentFallback("the big red button");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "the big red button");
  });

  it("trims whitespace", () => {
    const intent = parseIntentFallback("  click the button  ");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "button");
  });
});

// ---------------------------------------------------------------------------
// parseIntent (LLM-based with fallback)
// ---------------------------------------------------------------------------

describe("parseIntent", () => {
  it("falls back to regex when no LLM provided", async () => {
    const intent = await parseIntent("click the save button");
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "save button");
  });

  it("uses LLM parseGoalToIntent when available", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async parseGoalToIntent(goal: string) {
        return { action: "fill", target: "search input", value: "test query" };
      },
    };

    const intent = await parseIntent("search for test query", mockLLM as LLMProvider);
    assert.equal(intent.action, "fill");
    assert.equal(intent.target, "search input");
    assert.equal(intent.value, "test query");
  });

  it("falls back to regex when LLM throws", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async parseGoalToIntent() {
        throw new Error("LLM timeout");
      },
    };

    const intent = await parseIntent("click the button", mockLLM as LLMProvider);
    assert.equal(intent.action, "click");
    assert.equal(intent.target, "button");
  });

  it("falls back when LLM has no parseGoalToIntent", async () => {
    const mockLLM = {
      async findElementFromAccessibilityTree() { return null; },
      async findElementFromScreenshot() { return null; },
      async analyzePageForRecovery() { return null; },
    } as LLMProvider;

    const intent = await parseIntent("hover over the menu", mockLLM);
    assert.equal(intent.action, "hover");
  });
});

// ---------------------------------------------------------------------------
// decomposeIntentFallback
// ---------------------------------------------------------------------------

describe("decomposeIntentFallback", () => {
  it("splits on 'then'", () => {
    const intents = decomposeIntentFallback("click login then fill the email field with 'test@test.com'");
    assert.equal(intents.length, 2);
    assert.equal(intents[0].action, "click");
    assert.equal(intents[1].action, "fill");
  });

  it("splits on 'and then'", () => {
    const intents = decomposeIntentFallback("click save and then click confirm");
    assert.equal(intents.length, 2);
    assert.equal(intents[0].action, "click");
    assert.equal(intents[1].action, "click");
  });

  it("splits on ', then'", () => {
    const intents = decomposeIntentFallback("hover over menu, then click settings");
    assert.equal(intents.length, 2);
    assert.equal(intents[0].action, "hover");
    assert.equal(intents[1].action, "click");
  });

  it("splits on 'and' when both parts look like actions", () => {
    const intents = decomposeIntentFallback("click save and click confirm");
    assert.equal(intents.length, 2);
    assert.equal(intents[0].action, "click");
    assert.equal(intents[1].action, "click");
  });

  it("does not split on 'and' when parts are not actions", () => {
    const intents = decomposeIntentFallback("the save and confirm button");
    assert.equal(intents.length, 1);
    assert.equal(intents[0].target, "the save and confirm button");
  });

  it("returns single intent for simple goals", () => {
    const intents = decomposeIntentFallback("click the button");
    assert.equal(intents.length, 1);
    assert.equal(intents[0].action, "click");
  });
});

// ---------------------------------------------------------------------------
// decomposeIntent (LLM-based)
// ---------------------------------------------------------------------------

describe("decomposeIntent", () => {
  it("falls back to regex when no LLM provided", async () => {
    const intents = await decomposeIntent("click save then click confirm");
    assert.equal(intents.length, 2);
  });

  it("uses LLM decomposeGoal when available", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async decomposeGoal() {
        return [
          { action: "fill", target: "username", value: "admin" },
          { action: "fill", target: "password", value: "secret" },
          { action: "click", target: "login button" },
        ];
      },
    };

    const intents = await decomposeIntent(
      "log in as admin",
      mockLLM as LLMProvider
    );
    assert.equal(intents.length, 3);
    assert.equal(intents[0].action, "fill");
    assert.equal(intents[2].action, "click");
  });

  it("falls back when LLM throws", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async decomposeGoal() {
        throw new Error("timeout");
      },
    };

    const intents = await decomposeIntent(
      "click save then click confirm",
      mockLLM as LLMProvider
    );
    assert.equal(intents.length, 2);
  });
});
