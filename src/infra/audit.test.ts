import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuditTrail, resetAuditTrail } from "./audit";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("AuditTrail", () => {
  let tmpDir: string;
  let auditPath: string;
  let audit: AuditTrail;

  beforeEach(() => {
    resetAuditTrail();
    tmpDir = join(tmpdir(), `audit-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    auditPath = join(tmpDir, "audit.log");
    audit = new AuditTrail(auditPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe("record", () => {
    it("appends entries to file", () => {
      audit.record({
        action: "task.submitted",
        actor: "watcher",
        target: "42",
        details: { title: "Fix bug" },
      });

      audit.record({
        action: "agent.spawned",
        actor: "supervisor",
        target: "42",
        details: { agentName: "claude-code" },
      });

      const entries = audit.readAll();
      assert.equal(entries.length, 2);
      assert.equal(entries[0].action, "task.submitted");
      assert.equal(entries[0].actor, "watcher");
      assert.equal(entries[0].target, "42");
      assert.equal(entries[0].details.title, "Fix bug");
      assert.equal(entries[1].action, "agent.spawned");
    });

    it("auto-generates timestamp", () => {
      const before = new Date().toISOString();
      const entry = audit.record({
        action: "test.action",
        actor: "test",
        target: "1",
        details: {},
      });
      const after = new Date().toISOString();

      assert.ok(entry.timestamp >= before);
      assert.ok(entry.timestamp <= after);
    });

    it("preserves custom timestamp", () => {
      const entry = audit.record({
        action: "test.action",
        actor: "test",
        target: "1",
        details: {},
        timestamp: "2026-01-01T00:00:00.000Z",
      });

      assert.equal(entry.timestamp, "2026-01-01T00:00:00.000Z");
    });

    it("includes tenantId when provided", () => {
      audit.record({
        action: "task.submitted",
        actor: "watcher",
        target: "1",
        details: {},
        tenantId: "acme-corp",
      });

      const entries = audit.readAll();
      assert.equal(entries[0].tenantId, "acme-corp");
    });
  });

  describe("query", () => {
    beforeEach(() => {
      audit.record({ action: "task.submitted", actor: "watcher", target: "1", details: {}, timestamp: "2026-03-18T10:00:00.000Z" });
      audit.record({ action: "agent.spawned", actor: "supervisor", target: "1", details: {}, timestamp: "2026-03-18T10:01:00.000Z" });
      audit.record({ action: "pr.created", actor: "claude-code-agent", target: "42", details: {}, timestamp: "2026-03-18T10:02:00.000Z" });
      audit.record({ action: "task.submitted", actor: "watcher", target: "2", details: {}, timestamp: "2026-03-18T11:00:00.000Z" });
      audit.record({ action: "deploy.initiated", actor: "supervisor", target: "2", details: {}, timestamp: "2026-03-18T12:00:00.000Z" });
    });

    it("filters by action", () => {
      const results = audit.query({ action: "task.submitted" });
      assert.equal(results.length, 2);
      assert.ok(results.every(r => r.action === "task.submitted"));
    });

    it("filters by actor", () => {
      const results = audit.query({ actor: "supervisor" });
      assert.equal(results.length, 2);
      assert.ok(results.every(r => r.actor === "supervisor"));
    });

    it("filters by target", () => {
      const results = audit.query({ target: "42" });
      assert.equal(results.length, 1);
      assert.equal(results[0].action, "pr.created");
    });

    it("filters by date range", () => {
      const results = audit.query({
        from: "2026-03-18T10:01:00.000Z",
        to: "2026-03-18T11:00:00.000Z",
      });
      assert.equal(results.length, 3);
    });

    it("supports limit and offset", () => {
      const page1 = audit.query({ limit: 2, offset: 0 });
      const page2 = audit.query({ limit: 2, offset: 2 });

      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);
      assert.notEqual(page1[0].action, page2[0].action);
    });

    it("returns all entries with no filters", () => {
      const results = audit.query();
      assert.equal(results.length, 5);
    });
  });

  describe("survives restart", () => {
    it("data persists across instances", () => {
      audit.record({
        action: "task.submitted",
        actor: "watcher",
        target: "99",
        details: { important: true },
      });

      // Create new instance pointing to same file
      const audit2 = new AuditTrail(auditPath);
      const entries = audit2.readAll();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].target, "99");
      assert.equal(entries[0].details.important, true);
    });
  });

  describe("readRaw", () => {
    it("returns NDJSON content", () => {
      audit.record({ action: "a", actor: "b", target: "c", details: {} });
      audit.record({ action: "d", actor: "e", target: "f", details: {} });

      const raw = audit.readRaw();
      const lines = raw.trim().split("\n");
      assert.equal(lines.length, 2);
      // Each line is valid JSON
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line));
      }
    });

    it("returns empty string for missing file", () => {
      const fresh = new AuditTrail(join(tmpDir, "nonexistent.log"));
      assert.equal(fresh.readRaw(), "");
    });
  });
});
