/**
 * Tests for CDP Event Recorder.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CDPRecorder } from "./cdp-recorder";
import type { RecordedElement } from "./types";

// ---------------------------------------------------------------------------
// Mock Page
// ---------------------------------------------------------------------------

function createMockPage(overrides: Partial<{
  url: string;
  title: string;
}> = {}) {
  const config = {
    url: "https://app.example.com/dashboard",
    title: "Dashboard",
    ...overrides,
  };

  const listeners: Record<string, Function[]> = {};

  return {
    url: () => config.url,
    title: () => Promise.resolve(config.title),
    evaluate: async () => ({
      visibleText: "Dashboard content",
      forms: [],
      buttons: [{ text: "Submit", disabled: false }],
      links: [],
      modals: [],
      errorMessages: [],
      headings: ["Dashboard"],
    }),
    on: (event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    off: (event: string, handler: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {},
        detach: async () => {},
      }),
    }),
    _listeners: listeners,
  } as unknown as import("playwright").Page;
}

function createMockElement(overrides: Partial<RecordedElement> = {}): RecordedElement {
  return {
    selector: "#search-btn",
    tagName: "button",
    attributes: {},
    text: "Search",
    ariaRole: "button",
    ariaLabel: "Search",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CDPRecorder", () => {
  it("starts and stops recording", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page);

    assert.equal(recorder.isRecording(), false);
    await recorder.start();
    assert.equal(recorder.isRecording(), true);

    const session = await recorder.stop();
    assert.equal(recorder.isRecording(), false);
    assert.ok(session.id.startsWith("rec-"));
    assert.ok(session.startTime);
    assert.ok(session.endTime);
    assert.equal(session.startUrl, "https://app.example.com/dashboard");
  });

  it("records click actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordClick(createMockElement());
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "click");
    assert.equal(session.actions[0].element?.text, "Search");
    assert.equal(session.actions[0].pageUrl, "https://app.example.com/dashboard");
  });

  it("records type actions with value", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordType(
      createMockElement({ selector: "#query", tagName: "input", text: "", ariaLabel: "Search query" }),
      "correlation-id-123"
    );
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "type");
    assert.equal(session.actions[0].value, "correlation-id-123");
  });

  it("records select actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordSelect(
      createMockElement({ tagName: "select", ariaLabel: "Priority" }),
      "High"
    );
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "select");
    assert.equal(session.actions[0].value, "High");
  });

  it("records check actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordCheck(
      createMockElement({ tagName: "input", ariaLabel: "Agree to terms" }),
      true
    );
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "check");
    assert.equal(session.actions[0].value, "true");
  });

  it("records submit actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordSubmit(createMockElement({ tagName: "form", text: "Contact Form" }));
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "submit");
  });

  it("records upload actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordUpload(
      createMockElement({ tagName: "input", ariaLabel: "File upload" }),
      "report.pdf"
    );
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "upload");
    assert.equal(session.actions[0].value, "report.pdf");
  });

  it("records wait actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordWait("Loading spinner");
    const session = await recorder.stop();

    assert.equal(session.actions.length, 1);
    assert.equal(session.actions[0].type, "wait");
    assert.equal(session.actions[0].value, "Loading spinner");
  });

  it("records multiple actions in sequence", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordClick(createMockElement({ text: "Search tab" }));
    await recorder.recordType(createMockElement({ tagName: "input" }), "query");
    await recorder.recordClick(createMockElement({ text: "Go" }));
    const session = await recorder.stop();

    assert.equal(session.actions.length, 3);
    assert.equal(session.actions[0].type, "click");
    assert.equal(session.actions[1].type, "type");
    assert.equal(session.actions[2].type, "click");
  });

  it("does not record when not started", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.recordClick(createMockElement());
    assert.equal(recorder.getActions().length, 0);
  });

  it("captures page state before and after actions", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 0 });

    await recorder.start();
    await recorder.recordClick(createMockElement());
    const session = await recorder.stop();

    assert.ok(session.actions[0].pageStateBefore);
    assert.ok(session.actions[0].pageStateAfter);
  });

  it("generates unique session IDs", async () => {
    const page = createMockPage();
    const r1 = new CDPRecorder(page);
    const r2 = new CDPRecorder(page);

    await r1.start();
    await r2.start();
    const s1 = await r1.stop();
    const s2 = await r2.stop();

    assert.notEqual(s1.id, s2.id);
  });

  it("throttles rapid actions by default", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page, { throttleMs: 5000 });

    await recorder.start();
    await recorder.recordClick(createMockElement({ text: "First" }));
    await recorder.recordClick(createMockElement({ text: "Second" }));
    const session = await recorder.stop();

    // Second click should be throttled
    assert.equal(session.actions.length, 1);
  });

  it("handles start when already recording", async () => {
    const page = createMockPage();
    const recorder = new CDPRecorder(page);

    await recorder.start();
    await recorder.start(); // Should be a no-op
    assert.equal(recorder.isRecording(), true);
    await recorder.stop();
  });
});
