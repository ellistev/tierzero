import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { taskRouterApi } from "./task-router-api";
import { TaskQueueStore } from "../../read-models/task-queue";
import { TaskRouter } from "../../orchestrator/task-router";
import { AgentRegistry } from "../../orchestrator/agent-registry";
import { TaskSubmitted, TaskAssigned, TaskStarted, TaskCompleted } from "../../domain/task/events";

const silentLogger = { log: () => {}, error: () => {} };

function setup() {
  const registry = new AgentRegistry();
  registry.register({
    name: "test-agent",
    type: "test",
    capabilities: ["code", "operations"],
    maxConcurrent: 5,
    available: true,
    execute: async () => ({ success: true, output: "ok", durationMs: 10 }),
  });

  const router = new TaskRouter({ registry, logger: silentLogger });
  const store = new TaskQueueStore();
  router.on("event", (e) => store.apply(e));

  const app = express();
  app.use(express.json());
  app.use(taskRouterApi({ store, router, registry }));

  return { app, registry, router, store };
}

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`http://localhost:${port}${path}`, opts);
    const json = await resp.json();
    return { status: resp.status, body: json };
  } finally {
    server.close();
  }
}

describe("Task Router REST API", () => {
  it("GET /api/tasks should return empty list initially", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/tasks");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it("POST /api/tasks should create a task", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/tasks", {
      title: "New task",
      description: "A description",
      category: "code",
      priority: "high",
    });
    assert.equal(status, 201);
    assert.equal(body.title, "New task");
    assert.equal(body.category, "code");
    assert.equal(body.priority, "high");
    assert.ok(body.taskId);
  });

  it("POST /api/tasks should require title", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/tasks", {
      description: "no title",
    });
    assert.equal(status, 400);
    assert.ok(body.message);
  });

  it("GET /api/tasks/:taskId should return a task", async () => {
    const { app, router } = setup();
    const task = router.submit(
      { type: "manual", id: "m1", payload: {}, receivedAt: new Date().toISOString(), priority: "normal" },
      "Test", "Desc", "code"
    );
    await new Promise(r => setTimeout(r, 50));

    const { status, body } = await request(app, "GET", `/api/tasks/${task.taskId}`);
    assert.equal(status, 200);
    assert.equal(body.taskId, task.taskId);
    assert.equal(body.title, "Test");
  });

  it("GET /api/tasks/:taskId should 404 for unknown task", async () => {
    const { app } = setup();
    const { status } = await request(app, "GET", "/api/tasks/nonexistent");
    assert.equal(status, 404);
  });

  it("GET /api/tasks should support status filtering", async () => {
    const { app, store } = setup();
    store.apply(new TaskSubmitted("t1", "webhook", "s1", {}, "2026-03-18T10:00:00Z", "normal", undefined, "A", "desc", "code", "2026-03-18T10:00:00Z"));
    store.apply(new TaskSubmitted("t2", "webhook", "s2", {}, "2026-03-18T10:00:00Z", "normal", undefined, "B", "desc", "code", "2026-03-18T10:00:00Z"));
    store.apply(new TaskAssigned("t2", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t2", "2026-03-18T10:02:00Z"));
    store.apply(new TaskCompleted("t2", null, "2026-03-18T10:05:00Z"));

    const { body: all } = await request(app, "GET", "/api/tasks");
    assert.equal(all.length, 2);

    const { body: queued } = await request(app, "GET", "/api/tasks?status=queued");
    assert.equal(queued.length, 1);

    const { body: completed } = await request(app, "GET", "/api/tasks?status=completed");
    assert.equal(completed.length, 1);
  });

  it("GET /api/agents should return registered agents", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/agents");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].name, "test-agent");
  });

  it("POST /api/tasks/:taskId/retry should 404 for nonexistent task", async () => {
    const { app } = setup();
    const { status } = await request(app, "POST", "/api/tasks/nonexistent/retry");
    assert.equal(status, 404);
  });
});
