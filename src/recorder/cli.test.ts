/**
 * Tests for Recording CLI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RecordCLI } from "./cli";
import type { RecordedSession } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tierzero-cli-test-"));
}

function makeSession(): RecordedSession {
  return {
    id: "test-session-123",
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-01T00:05:00Z",
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
    ],
    startUrl: "https://app.example.com",
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecordCLI", () => {
  describe("help", () => {
    it("shows help for unknown commands", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["unknown"]);
      assert.ok(result.includes("Commands:"));
      assert.ok(result.includes("record start"));
    });

    it("shows help for empty args", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute([]);
      assert.ok(result.includes("Commands:"));
    });
  });

  describe("start", () => {
    it("starts recording with valid URL", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["start", "https://example.com"]);
      assert.ok(result.includes("Recording started"));
    });

    it("rejects missing URL", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["start"]);
      assert.ok(result.includes("Error"));
      assert.ok(result.includes("URL is required"));
    });

    it("rejects invalid URL", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["start", "not-a-url"]);
      assert.ok(result.includes("Error"));
      assert.ok(result.includes("Invalid URL"));
    });
  });

  describe("stop", () => {
    it("returns stop message", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["stop"]);
      assert.ok(result.includes("Recording stopped"));
    });
  });

  describe("generate", () => {
    it("generates from a session file", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });

      // Write a session file
      const session = makeSession();
      const sessionPath = path.join(tmpDir, "session.json");
      fs.writeFileSync(sessionPath, JSON.stringify(session));

      const result = await cli.execute(["generate", "session.json"]);
      assert.ok(result.includes("Workflow generated"));
      assert.ok(result.includes("Skill generated"));

      // Clean up
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("rejects missing session file argument", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["generate"]);
      assert.ok(result.includes("Error"));
      assert.ok(result.includes("Session file is required"));
    });

    it("rejects non-existent session file", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });
      const result = await cli.execute(["generate", "nonexistent.json"]);
      assert.ok(result.includes("Error"));
      assert.ok(result.includes("not found"));
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("handles invalid JSON gracefully", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });

      fs.writeFileSync(path.join(tmpDir, "bad.json"), "not json");
      const result = await cli.execute(["generate", "bad.json"]);
      assert.ok(result.includes("Error"));

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("replay", () => {
    it("rejects missing workflow file", async () => {
      const cli = new RecordCLI();
      const result = await cli.execute(["replay"]);
      assert.ok(result.includes("Error"));
    });

    it("handles missing workflow file path", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });
      const result = await cli.execute(["replay", "nonexistent.json"]);
      assert.ok(result.includes("Error") || result.includes("not found"));
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("returns replay message for valid file", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });

      fs.writeFileSync(path.join(tmpDir, "workflow.json"), "{}");
      const result = await cli.execute(["replay", "workflow.json"]);
      assert.ok(result.includes("Replay"));

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("list", () => {
    it("returns no sessions when directory does not exist", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });
      const result = await cli.execute(["list"]);
      assert.ok(result.includes("No recorded sessions"));
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("lists recorded sessions", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });

      // Create sessions directory and file
      const sessionsDir = path.join(tmpDir, ".tierzero", "recordings");
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, "test-session.json"),
        JSON.stringify(makeSession())
      );

      const result = await cli.execute(["list"]);
      assert.ok(result.includes("Recorded sessions"));
      assert.ok(result.includes("test-session-123"));

      fs.rmSync(tmpDir, { recursive: true });
    });

    it("handles invalid session files gracefully", async () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });

      const sessionsDir = path.join(tmpDir, ".tierzero", "recordings");
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, "bad.json"), "not json");

      const result = await cli.execute(["list"]);
      assert.ok(result.includes("invalid"));

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("saveSession", () => {
    it("saves a session to disk", () => {
      const tmpDir = makeTempDir();
      const cli = new RecordCLI({ workDir: tmpDir });
      const session = makeSession();

      const filePath = cli.saveSession(session);
      assert.ok(fs.existsSync(filePath));

      const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      assert.equal(saved.id, session.id);

      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});
