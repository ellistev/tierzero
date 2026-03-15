/**
 * Tests for Recording Controller.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecordingController } from "./controller";
import type { RecordedSession, RecordingEvent } from "./types";

// ---------------------------------------------------------------------------
// Mock Page
// ---------------------------------------------------------------------------

function createMockPage() {
  const listeners: Record<string, Function[]> = {};

  return {
    url: () => "https://app.example.com/dashboard",
    title: () => Promise.resolve("Dashboard"),
    evaluate: async () => ({
      visibleText: "Dashboard content",
      forms: [],
      buttons: [],
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
  } as unknown as import("playwright").Page;
}

function makeSession(): RecordedSession {
  return {
    id: "test-session",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    actions: [
      {
        type: "click",
        timestamp: Date.now(),
        pageUrl: "https://app.example.com",
        pageTitle: "App",
        pageStateBefore: "before",
        pageStateAfter: "after",
        stateChanges: [],
        element: {
          selector: "#btn",
          tagName: "button",
          attributes: {},
          text: "Search",
        },
      },
      {
        type: "type",
        timestamp: Date.now(),
        pageUrl: "https://app.example.com",
        pageTitle: "App",
        pageStateBefore: "before",
        pageStateAfter: "after",
        stateChanges: [],
        value: "INC12345",
        element: {
          selector: "#input",
          tagName: "input",
          attributes: { name: "query" },
          ariaLabel: "Search query",
        },
      },
    ],
    startUrl: "https://app.example.com",
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecordingController", () => {
  describe("status management", () => {
    it("starts in idle status", () => {
      const controller = new RecordingController();
      assert.equal(controller.getStatus(), "idle");
    });

    it("transitions to recording on start", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      assert.equal(controller.getStatus(), "recording");
      await controller.stopRecording();
    });

    it("transitions to stopped on stop", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      await controller.stopRecording();
      assert.equal(controller.getStatus(), "stopped");
    });

    it("transitions to paused on pause", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      controller.pauseRecording();
      assert.equal(controller.getStatus(), "paused");
      await controller.stopRecording();
    });

    it("transitions back to recording on resume", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      controller.pauseRecording();
      controller.resumeRecording();
      assert.equal(controller.getStatus(), "recording");
      await controller.stopRecording();
    });
  });

  describe("error handling", () => {
    it("throws when starting while already recording", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      await assert.rejects(
        () => controller.startRecording(page),
        /Already recording/
      );
      await controller.stopRecording();
    });

    it("throws when stopping without active recording", async () => {
      const controller = new RecordingController();
      await assert.rejects(
        () => controller.stopRecording(),
        /No active recording/
      );
    });

    it("throws when pausing while not recording", () => {
      const controller = new RecordingController();
      assert.throws(
        () => controller.pauseRecording(),
        /Cannot pause/
      );
    });

    it("throws when resuming while not paused", () => {
      const controller = new RecordingController();
      assert.throws(
        () => controller.resumeRecording(),
        /Cannot resume/
      );
    });
  });

  describe("annotations", () => {
    it("adds annotations during recording", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      await controller.startRecording(page);
      controller.addAnnotation("This is step 1");
      controller.addAnnotation("Now filling the form");
      const session = await controller.stopRecording();

      const annotations = session.metadata.annotations as string[];
      assert.equal(annotations.length, 2);
      assert.equal(annotations[0], "This is step 1");
    });
  });

  describe("events", () => {
    it("emits status change events", async () => {
      const events: RecordingEvent[] = [];
      const controller = new RecordingController();
      controller.onEvent((e) => events.push(e));

      const page = createMockPage();
      await controller.startRecording(page);
      await controller.stopRecording();

      const statusChanges = events.filter((e) => e.type === "status_change");
      assert.ok(statusChanges.length >= 2); // recording, stopped
    });

    it("emits annotation events", () => {
      const events: RecordingEvent[] = [];
      const controller = new RecordingController();
      controller.onEvent((e) => events.push(e));

      controller.addAnnotation("test note");

      const annotationEvents = events.filter((e) => e.type === "annotation_added");
      assert.equal(annotationEvents.length, 1);
      assert.equal(annotationEvents[0].data.note, "test note");
    });

    it("supports removing event handlers", async () => {
      const events: RecordingEvent[] = [];
      const handler = (e: RecordingEvent) => events.push(e);
      const controller = new RecordingController();

      controller.onEvent(handler);
      controller.addAnnotation("first");
      controller.offEvent(handler);
      controller.addAnnotation("second");

      assert.equal(events.filter((e) => e.type === "annotation_added").length, 1);
    });

    it("handles errors in event handlers gracefully", async () => {
      const controller = new RecordingController();
      controller.onEvent(() => {
        throw new Error("Handler error");
      });

      // Should not throw
      controller.addAnnotation("test");
    });
  });

  describe("generateFromRecording", () => {
    it("generates workflow and skill from a session", async () => {
      const controller = new RecordingController();
      const session = makeSession();

      const { workflow, skill } = await controller.generateFromRecording(session);

      assert.ok(workflow.id);
      assert.ok(workflow.name);
      assert.ok(workflow.steps.length > 0);
      assert.ok(skill.manifest);
      assert.ok(skill.files["index.ts"]);
    });

    it("sets status to generating during pipeline", async () => {
      const statuses: string[] = [];
      const controller = new RecordingController();
      controller.onEvent((e) => {
        if (e.type === "status_change") {
          statuses.push(e.data.to as string);
        }
      });

      await controller.generateFromRecording(makeSession());

      assert.ok(statuses.includes("generating"));
    });
  });

  describe("session management", () => {
    it("stores the last session", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      assert.equal(controller.getLastSession(), null);

      await controller.startRecording(page);
      const session = await controller.stopRecording();

      assert.ok(controller.getLastSession());
      assert.equal(controller.getLastSession()?.id, session.id);
    });

    it("exposes the recorder instance", async () => {
      const controller = new RecordingController();
      const page = createMockPage();

      assert.equal(controller.getRecorder(), null);

      await controller.startRecording(page);
      assert.ok(controller.getRecorder());

      await controller.stopRecording();
      assert.equal(controller.getRecorder(), null);
    });
  });
});
