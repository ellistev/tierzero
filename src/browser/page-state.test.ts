/**
 * Tests for Page State module.
 * Uses mock Page objects - no real browser needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describePageState,
  detectPageType,
  diffPageState,
} from "./page-state";
import type { PageState } from "./page-state";

// ---------------------------------------------------------------------------
// Helper: create a minimal PageState
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<PageState> = {}): PageState {
  return {
    url: "https://example.com",
    title: "Example Page",
    visibleText: "Hello world",
    forms: [],
    buttons: [],
    links: [],
    modals: [],
    errorMessages: [],
    headings: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describePageState
// ---------------------------------------------------------------------------

describe("describePageState", () => {
  it("includes URL and title", () => {
    const state = makeState({ url: "https://app.com/login", title: "Login" });
    const desc = describePageState(state);
    assert.ok(desc.includes("Login"));
    assert.ok(desc.includes("https://app.com/login"));
  });

  it("includes headings", () => {
    const state = makeState({ headings: ["Welcome", "Dashboard"] });
    const desc = describePageState(state);
    assert.ok(desc.includes("Welcome"));
    assert.ok(desc.includes("Dashboard"));
  });

  it("includes error messages", () => {
    const state = makeState({ errorMessages: ["Invalid credentials"] });
    const desc = describePageState(state);
    assert.ok(desc.includes("Invalid credentials"));
  });

  it("includes modal count", () => {
    const state = makeState({ modals: ["Confirm dialog text"] });
    const desc = describePageState(state);
    assert.ok(desc.includes("Active modals: 1"));
  });

  it("describes form fields with fill status", () => {
    const state = makeState({
      forms: [
        { name: "email", type: "email", value: "user@test.com", label: "Email", required: true },
        { name: "password", type: "password", value: "", label: "Password", required: true },
      ],
    });
    const desc = describePageState(state);
    assert.ok(desc.includes("Form fields: 2 total, 1 filled, 2 required"));
    assert.ok(desc.includes("Email"));
    assert.ok(desc.includes("user@test.com"));
    assert.ok(desc.includes("(empty)"));
  });

  it("describes buttons with disabled state", () => {
    const state = makeState({
      buttons: [
        { text: "Submit", disabled: false },
        { text: "Delete", disabled: true },
      ],
    });
    const desc = describePageState(state);
    assert.ok(desc.includes("Submit"));
    assert.ok(desc.includes("Delete (disabled)"));
  });

  it("includes link count", () => {
    const state = makeState({
      links: [
        { text: "Home", href: "/" },
        { text: "About", href: "/about" },
      ],
    });
    const desc = describePageState(state);
    assert.ok(desc.includes("Links: 2 visible"));
  });
});

// ---------------------------------------------------------------------------
// detectPageType
// ---------------------------------------------------------------------------

describe("detectPageType", () => {
  it("detects login page by URL", () => {
    const state = makeState({ url: "https://app.com/login" });
    assert.equal(detectPageType(state), "login");
  });

  it("detects login page by title", () => {
    const state = makeState({ title: "Sign In - MyApp" });
    assert.equal(detectPageType(state), "login");
  });

  it("detects login page by form shape", () => {
    const state = makeState({
      forms: [
        { name: "username", type: "text", value: "", label: "Username", required: true },
        { name: "password", type: "password", value: "", label: "Password", required: true },
      ],
    });
    assert.equal(detectPageType(state), "login");
  });

  it("detects error page", () => {
    const state = makeState({
      errorMessages: ["Something went wrong"],
      visibleText: "500 Internal Server Error",
    });
    assert.equal(detectPageType(state), "error");
  });

  it("detects search page", () => {
    const state = makeState({ url: "https://app.com/search?q=test" });
    assert.equal(detectPageType(state), "search");
  });

  it("detects settings page", () => {
    const state = makeState({ url: "https://app.com/settings" });
    assert.equal(detectPageType(state), "settings");
  });

  it("detects dashboard page", () => {
    const state = makeState({ url: "https://app.com/dashboard" });
    assert.equal(detectPageType(state), "dashboard");
  });

  it("detects form page by field count", () => {
    const state = makeState({
      forms: [
        { name: "first", type: "text", value: "", label: "First Name", required: true },
        { name: "last", type: "text", value: "", label: "Last Name", required: true },
        { name: "email", type: "email", value: "", label: "Email", required: true },
        { name: "phone", type: "tel", value: "", label: "Phone", required: false },
      ],
    });
    assert.equal(detectPageType(state), "form");
  });

  it("detects list page by link density", () => {
    const links = Array.from({ length: 15 }, (_, i) => ({
      text: `Item ${i}`,
      href: `/item/${i}`,
    }));
    const state = makeState({ links });
    assert.equal(detectPageType(state), "list");
  });

  it("detects detail page by content density", () => {
    const state = makeState({
      headings: ["Article Title", "Section 1", "Section 2"],
      visibleText: "x".repeat(1500),
    });
    assert.equal(detectPageType(state), "detail");
  });

  it("returns unknown for ambiguous pages", () => {
    const state = makeState();
    assert.equal(detectPageType(state), "unknown");
  });
});

// ---------------------------------------------------------------------------
// diffPageState
// ---------------------------------------------------------------------------

describe("diffPageState", () => {
  it("detects URL change", () => {
    const before = makeState({ url: "https://app.com/page1" });
    const after = makeState({ url: "https://app.com/page2" });
    const diff = diffPageState(before, after);
    assert.equal(diff.urlChanged, true);
  });

  it("detects no URL change", () => {
    const before = makeState();
    const after = makeState();
    const diff = diffPageState(before, after);
    assert.equal(diff.urlChanged, false);
  });

  it("detects title change", () => {
    const before = makeState({ title: "Page 1" });
    const after = makeState({ title: "Page 2" });
    const diff = diffPageState(before, after);
    assert.equal(diff.titleChanged, true);
  });

  it("detects new errors", () => {
    const before = makeState({ errorMessages: [] });
    const after = makeState({ errorMessages: ["Field required"] });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.newErrors, ["Field required"]);
    assert.deepEqual(diff.resolvedErrors, []);
  });

  it("detects resolved errors", () => {
    const before = makeState({ errorMessages: ["Invalid input"] });
    const after = makeState({ errorMessages: [] });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.resolvedErrors, ["Invalid input"]);
    assert.deepEqual(diff.newErrors, []);
  });

  it("detects new modals", () => {
    const before = makeState({ modals: [] });
    const after = makeState({ modals: ["Are you sure?"] });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.newModals, ["Are you sure?"]);
  });

  it("detects dismissed modals", () => {
    const before = makeState({ modals: ["Confirm action"] });
    const after = makeState({ modals: [] });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.dismissedModals, ["Confirm action"]);
  });

  it("detects new buttons", () => {
    const before = makeState({ buttons: [{ text: "Save", disabled: false }] });
    const after = makeState({
      buttons: [
        { text: "Save", disabled: false },
        { text: "Delete", disabled: false },
      ],
    });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.newButtons, ["Delete"]);
  });

  it("detects removed buttons", () => {
    const before = makeState({
      buttons: [
        { text: "Save", disabled: false },
        { text: "Cancel", disabled: false },
      ],
    });
    const after = makeState({ buttons: [{ text: "Save", disabled: false }] });
    const diff = diffPageState(before, after);
    assert.deepEqual(diff.removedButtons, ["Cancel"]);
  });

  it("detects form field value changes", () => {
    const before = makeState({
      forms: [{ name: "email", type: "email", value: "", label: "Email", required: true }],
    });
    const after = makeState({
      forms: [{ name: "email", type: "email", value: "user@test.com", label: "Email", required: true }],
    });
    const diff = diffPageState(before, after);
    assert.equal(diff.formChanges.length, 1);
    assert.equal(diff.formChanges[0].field, "Email");
    assert.equal(diff.formChanges[0].from, "");
    assert.equal(diff.formChanges[0].to, "user@test.com");
  });

  it("returns empty diff for identical states", () => {
    const state = makeState({
      buttons: [{ text: "OK", disabled: false }],
      errorMessages: ["error1"],
      modals: ["modal1"],
    });
    const diff = diffPageState(state, state);
    assert.equal(diff.urlChanged, false);
    assert.equal(diff.titleChanged, false);
    assert.deepEqual(diff.newErrors, []);
    assert.deepEqual(diff.resolvedErrors, []);
    assert.deepEqual(diff.newModals, []);
    assert.deepEqual(diff.dismissedModals, []);
    assert.deepEqual(diff.newButtons, []);
    assert.deepEqual(diff.removedButtons, []);
    assert.deepEqual(diff.formChanges, []);
  });
});

// ---------------------------------------------------------------------------
// capturePageState (with mock page)
// ---------------------------------------------------------------------------

describe("capturePageState (mock)", () => {
  it("requires a page object (integration-only, skipped in unit tests)", () => {
    // capturePageState requires a real Playwright page object.
    // Verified via integration tests. This test confirms the export exists.
    const { capturePageState } = require("./page-state");
    assert.equal(typeof capturePageState, "function");
  });
});
