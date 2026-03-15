/**
 * Tests for Page State Assertions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertOnPage,
  assertElementVisible,
  assertNoErrors,
  assertFormFilled,
  AssertionError,
} from "./assertions";
import type { LLMProvider } from "./types";

// ---------------------------------------------------------------------------
// Mock Page helpers
// ---------------------------------------------------------------------------

function createMockPage(config: {
  url?: string;
  bodyText?: string;
  evalResult?: unknown;
  screenshotBuffer?: Buffer;
} = {}) {
  const url = config.url ?? "https://app.com/dashboard";
  const bodyText = config.bodyText ?? "Welcome to the dashboard";

  return {
    url: () => url,
    evaluate: async (fn: Function, args?: unknown) => {
      if (config.evalResult !== undefined) return config.evalResult;
      // Default: return empty errors array for assertNoErrors
      if (typeof fn === "function") {
        try {
          return fn(args);
        } catch {
          return [];
        }
      }
      return bodyText;
    },
    screenshot: async () => config.screenshotBuffer ?? Buffer.from("fake-png"),
  } as unknown as import("playwright").Page;
}

// ---------------------------------------------------------------------------
// assertOnPage
// ---------------------------------------------------------------------------

describe("assertOnPage", () => {
  it("passes for exact URL match", async () => {
    const page = createMockPage({ url: "https://app.com/login" });
    await assertOnPage(page, "https://app.com/login");
  });

  it("passes for substring match", async () => {
    const page = createMockPage({ url: "https://app.com/dashboard?tab=overview" });
    await assertOnPage(page, "/dashboard");
  });

  it("passes for regex match", async () => {
    const page = createMockPage({ url: "https://app.com/users/123/profile" });
    await assertOnPage(page, /\/users\/\d+\/profile/);
  });

  it("throws AssertionError for URL mismatch", async () => {
    const page = createMockPage({ url: "https://app.com/login" });
    await assert.rejects(
      () => assertOnPage(page, "/dashboard"),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("/dashboard"));
        assert.ok(err.message.includes("/login"));
        return true;
      }
    );
  });

  it("throws AssertionError for regex mismatch", async () => {
    const page = createMockPage({ url: "https://app.com/login" });
    await assert.rejects(
      () => assertOnPage(page, /\/dashboard/),
      (err: Error) => err instanceof AssertionError
    );
  });
});

// ---------------------------------------------------------------------------
// assertElementVisible
// ---------------------------------------------------------------------------

describe("assertElementVisible", () => {
  it("passes when text exists in page (no LLM)", async () => {
    const page = createMockPage({
      evalResult: "Welcome to the search results table with many items",
    });
    await assertElementVisible(page, "search results table");
  });

  it("throws when text not found (no LLM)", async () => {
    const page = createMockPage({ evalResult: "Empty page content" });
    await assert.rejects(
      () => assertElementVisible(page, "search results table"),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("search results table"));
        return true;
      }
    );
  });

  it("uses LLM vision when available", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async verifyVisualCondition() {
        return true;
      },
    };

    const page = createMockPage();
    await assertElementVisible(page, "a data table", mockLLM as LLMProvider);
  });

  it("throws when LLM says element not visible", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async verifyVisualCondition() {
        return false;
      },
    };

    const page = createMockPage();
    await assert.rejects(
      () => assertElementVisible(page, "a data table", mockLLM as LLMProvider),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("LLM-verified"));
        return true;
      }
    );
  });

  it("falls back to text search when LLM throws", async () => {
    const mockLLM: Partial<LLMProvider> = {
      async verifyVisualCondition() {
        throw new Error("LLM error");
      },
    };

    const page = createMockPage({ evalResult: "page has a data table here" });
    await assertElementVisible(page, "data table", mockLLM as LLMProvider);
  });
});

// ---------------------------------------------------------------------------
// assertNoErrors
// ---------------------------------------------------------------------------

describe("assertNoErrors", () => {
  it("passes when no errors found", async () => {
    const page = createMockPage({ evalResult: [] });
    await assertNoErrors(page);
  });

  it("throws when errors found", async () => {
    const page = createMockPage({
      evalResult: ["Validation failed: email required"],
    });
    await assert.rejects(
      () => assertNoErrors(page),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("email required"));
        return true;
      }
    );
  });

  it("reports multiple errors", async () => {
    const page = createMockPage({
      evalResult: ["Error 1", "Error 2"],
    });
    await assert.rejects(
      () => assertNoErrors(page),
      (err: Error) => {
        assert.ok(err.message.includes("Error 1"));
        assert.ok(err.message.includes("Error 2"));
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// assertFormFilled
// ---------------------------------------------------------------------------

describe("assertFormFilled", () => {
  it("passes when field has expected value", async () => {
    const page = createMockPage({
      evalResult: { found: true, value: "user@test.com" },
    });
    await assertFormFilled(page, "email", "user@test.com");
  });

  it("throws when field not found", async () => {
    const page = createMockPage({
      evalResult: { found: false, value: "" },
    });
    await assert.rejects(
      () => assertFormFilled(page, "email", "expected"),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("not found"));
        return true;
      }
    );
  });

  it("throws when value does not match", async () => {
    const page = createMockPage({
      evalResult: { found: true, value: "wrong@value.com" },
    });
    await assert.rejects(
      () => assertFormFilled(page, "email", "correct@value.com"),
      (err: Error) => {
        assert.ok(err instanceof AssertionError);
        assert.ok(err.message.includes("wrong@value.com"));
        assert.ok(err.message.includes("correct@value.com"));
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// AssertionError
// ---------------------------------------------------------------------------

describe("AssertionError", () => {
  it("is an instance of Error", () => {
    const err = new AssertionError("test");
    assert.ok(err instanceof Error);
  });

  it("has correct name", () => {
    const err = new AssertionError("test");
    assert.equal(err.name, "AssertionError");
  });

  it("has correct message", () => {
    const err = new AssertionError("something failed");
    assert.equal(err.message, "something failed");
  });
});
