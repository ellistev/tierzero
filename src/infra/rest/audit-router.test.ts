import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuditTrail } from "../audit";
import { auditRouter } from "./audit-router";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Minimal mock for Express Request/Response
function mockReq(query: Record<string, string> = {}): { query: Record<string, string> } {
  return { query };
}

function mockRes(): {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  json: (data: unknown) => void;
  send: (data: unknown) => void;
  setHeader: (key: string, value: string) => void;
} {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    json(data: unknown) { res.body = data; },
    send(data: unknown) { res.body = data; },
    setHeader(key: string, value: string) { res.headers[key] = value; },
  };
  return res;
}

describe("audit-router", () => {
  let tmpDir: string;
  let audit: AuditTrail;
  let router: ReturnType<typeof auditRouter>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `audit-router-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    audit = new AuditTrail(join(tmpDir, "audit.log"));
    router = auditRouter({ audit });

    // Seed data
    audit.record({ action: "task.submitted", actor: "watcher", target: "1", details: { title: "Fix bug" }, timestamp: "2026-03-18T10:00:00.000Z" });
    audit.record({ action: "agent.spawned", actor: "supervisor", target: "1", details: {}, timestamp: "2026-03-18T10:01:00.000Z" });
    audit.record({ action: "pr.created", actor: "claude-code-agent", target: "42", details: { url: "https://github.com/test/pr/1" }, timestamp: "2026-03-18T10:02:00.000Z" });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // Helper to find and call route handler
  function findHandler(method: string, path: string) {
    const stack = (router as unknown as { stack: Array<{ route: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack;
    for (const layer of stack) {
      if (layer.route && layer.route.path === path && layer.route.methods[method]) {
        return layer.route.stack[0].handle;
      }
    }
    throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  }

  describe("GET /api/audit", () => {
    it("returns all entries with no filters", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq();
      const res = mockRes();
      handler(req, res);
      assert.ok(Array.isArray(res.body));
      assert.equal((res.body as unknown[]).length, 3);
    });

    it("filters by action", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq({ action: "task.submitted" });
      const res = mockRes();
      handler(req, res);
      assert.equal((res.body as unknown[]).length, 1);
    });

    it("filters by actor", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq({ actor: "supervisor" });
      const res = mockRes();
      handler(req, res);
      assert.equal((res.body as unknown[]).length, 1);
    });

    it("filters by target", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq({ target: "42" });
      const res = mockRes();
      handler(req, res);
      assert.equal((res.body as unknown[]).length, 1);
    });

    it("supports date range", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq({ from: "2026-03-18T10:01:00.000Z", to: "2026-03-18T10:02:00.000Z" });
      const res = mockRes();
      handler(req, res);
      assert.equal((res.body as unknown[]).length, 2);
    });

    it("supports limit and offset", () => {
      const handler = findHandler("get", "/api/audit");
      const req = mockReq({ limit: "1", offset: "1" });
      const res = mockRes();
      handler(req, res);
      const body = res.body as Array<{ action: string }>;
      assert.equal(body.length, 1);
      assert.equal(body[0].action, "agent.spawned");
    });
  });

  describe("GET /api/audit/export", () => {
    it("returns NDJSON with correct headers", () => {
      const handler = findHandler("get", "/api/audit/export");
      const req = mockReq();
      const res = mockRes();
      handler(req, res);

      assert.equal(res.headers["Content-Type"], "application/x-ndjson");
      assert.ok(res.headers["Content-Disposition"].includes("audit.log"));
      assert.ok(typeof res.body === "string");

      const lines = (res.body as string).trim().split("\n");
      assert.equal(lines.length, 3);
    });
  });
});
