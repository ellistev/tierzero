import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { StructuredLogger, createLogger, getRootLogger, resetRootLogger } from "./logger";
import type { LogLevel } from "./logger";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("StructuredLogger", () => {
  beforeEach(() => {
    resetRootLogger();
  });

  describe("JSON format", () => {
    it("outputs correct JSON structure", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        component: "watcher",
        write: (line) => lines.push(line),
      });

      logger.info("Found 3 issues", { count: 3, label: "tierzero-agent" });

      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, "info");
      assert.equal(parsed.component, "watcher");
      assert.equal(parsed.msg, "Found 3 issues");
      assert.equal(parsed.data.count, 3);
      assert.equal(parsed.data.label, "tierzero-agent");
      assert.ok(parsed.timestamp);
      // Verify ISO format
      assert.ok(new Date(parsed.timestamp).toISOString() === parsed.timestamp);
    });

    it("omits data field when no data provided", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        component: "test",
        write: (line) => lines.push(line),
      });

      logger.info("Simple message");

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.msg, "Simple message");
      assert.equal(parsed.data, undefined);
    });

    it("includes all log levels", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        level: "debug",
        component: "test",
        write: (line) => lines.push(line),
      });

      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");

      assert.equal(lines.length, 4);
      assert.equal(JSON.parse(lines[0]).level, "debug");
      assert.equal(JSON.parse(lines[1]).level, "info");
      assert.equal(JSON.parse(lines[2]).level, "warn");
      assert.equal(JSON.parse(lines[3]).level, "error");
    });
  });

  describe("log levels filter", () => {
    it("filters below threshold", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        level: "warn",
        component: "test",
        write: (line) => lines.push(line),
      });

      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should appear");
      logger.error("should appear");

      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).level, "warn");
      assert.equal(JSON.parse(lines[1]).level, "error");
    });

    it("error level only shows errors", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        level: "error",
        component: "test",
        write: (line) => lines.push(line),
      });

      logger.debug("no");
      logger.info("no");
      logger.warn("no");
      logger.error("yes");

      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).level, "error");
    });

    it("debug level shows everything", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "json",
        level: "debug",
        component: "test",
        write: (line) => lines.push(line),
      });

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      assert.equal(lines.length, 4);
    });
  });

  describe("pretty format", () => {
    it("includes component and level in output", () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({
        format: "pretty",
        component: "pipeline",
        write: (line) => lines.push(line),
      });

      logger.info("Starting work");

      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes("INFO"), `Expected INFO in: ${lines[0]}`);
      assert.ok(lines[0].includes("[pipeline]"), `Expected [pipeline] in: ${lines[0]}`);
      assert.ok(lines[0].includes("Starting work"), `Expected message in: ${lines[0]}`);
    });
  });

  describe("child logger", () => {
    it("creates child with inherited settings", () => {
      const lines: string[] = [];
      const parent = new StructuredLogger({
        format: "json",
        level: "debug",
        component: "app",
        write: (line) => lines.push(line),
      });

      const child = parent.child("watcher");
      child.info("Found issues");

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.component, "watcher");
      assert.equal(parsed.msg, "Found issues");
    });
  });

  describe("file output", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `logger-test-${randomUUID()}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    });

    it("writes to log file", () => {
      const logFile = join(tmpDir, "test.log");
      const logger = new StructuredLogger({
        format: "json",
        component: "test",
        logFile,
        write: () => {}, // suppress console
      });

      logger.info("entry 1");
      logger.warn("entry 2");

      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).msg, "entry 1");
      assert.equal(JSON.parse(lines[1]).msg, "entry 2");
    });

    it("rotates when file exceeds max size", () => {
      const logFile = join(tmpDir, "rotate.log");
      const logger = new StructuredLogger({
        format: "json",
        component: "test",
        logFile,
        maxFileSize: 100, // 100 bytes for easy testing
        maxFiles: 3,
        write: () => {},
      });

      // Write enough to trigger rotation
      for (let i = 0; i < 10; i++) {
        logger.info(`Message number ${i} with some padding to fill up space`);
      }

      // Check that rotation happened
      assert.ok(existsSync(logFile), "Current log should exist");
      assert.ok(existsSync(`${logFile}.1`), "Rotated file .1 should exist");
    });
  });

  describe("createLogger and getRootLogger", () => {
    it("createLogger returns child of root", () => {
      resetRootLogger();
      const lines: string[] = [];
      // Initialize root with custom write
      const root = getRootLogger({
        format: "json",
        write: (line) => lines.push(line),
      });

      const logger = root.child("my-component");
      logger.info("test");

      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).component, "my-component");
    });
  });
});
