import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schedulerRouter } from "./scheduler-router";
import { ScheduledJobStore } from "../../read-models/scheduled-jobs";
import { Scheduler } from "../../scheduler/scheduler";
import { JobRegistered, JobTriggered, JobRunCompleted } from "../../domain/scheduled-job/events";

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const resp = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const contentType = resp.headers.get("content-type") ?? "";
    const respBody = contentType.includes("json") ? await resp.json() : null;
    return { status: resp.status, body: respBody };
  } finally {
    server.close();
  }
}

function setup() {
  const store = new ScheduledJobStore();
  const scheduler = new Scheduler();

  // Pre-register a job
  scheduler.addJob({
    id: "test-job",
    name: "Test Job",
    description: "A test job",
    schedule: "*/5 * * * *",
    taskTemplate: {
      title: "Test",
      description: "Test task",
      category: "monitoring",
      priority: "normal",
    },
    enabled: true,
    maxConcurrent: 1,
    catchUp: false,
    maxConsecutiveFailures: 5,
  });

  // Also add to read model
  store.apply(new JobRegistered(
    "test-job", "Test Job", "*/5 * * * *",
    { title: "Test", description: "Test task", category: "monitoring", priority: "normal" },
    "A test job", "UTC", true, 1, false, 5, new Date().toISOString()
  ));

  const app = express();
  app.use(express.json());
  app.use(schedulerRouter({ store, scheduler }));
  return { app, store, scheduler };
}

describe("Scheduler REST API", () => {
  it("GET /api/scheduler/jobs should return all jobs", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/scheduler/jobs");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].jobId, "test-job");
  });

  it("GET /api/scheduler/jobs/:jobId should return job details", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/scheduler/jobs/test-job");
    assert.equal(status, 200);
    assert.equal(body.jobId, "test-job");
    assert.equal(body.name, "Test Job");
  });

  it("GET /api/scheduler/jobs/:jobId should return 404 for missing job", async () => {
    const { app } = setup();
    const { status } = await request(app, "GET", "/api/scheduler/jobs/nonexistent");
    assert.equal(status, 404);
  });

  it("POST /api/scheduler/jobs should create a new job", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/scheduler/jobs", {
      id: "new-job",
      name: "New Job",
      schedule: "0 9 * * *",
      taskTemplate: { title: "New", description: "New task", category: "code", priority: "high" },
    });
    assert.equal(status, 201);
    assert.equal(body.id, "new-job");
    assert.equal(body.name, "New Job");
  });

  it("POST /api/scheduler/jobs should reject invalid body", async () => {
    const { app } = setup();
    const { status } = await request(app, "POST", "/api/scheduler/jobs", { name: "No ID" });
    assert.equal(status, 400);
  });

  it("PUT /api/scheduler/jobs/:jobId should update job", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "PUT", "/api/scheduler/jobs/test-job", { enabled: false });
    assert.equal(status, 200);
    assert.equal(body.enabled, false);
  });

  it("PUT /api/scheduler/jobs/:jobId should return 404 for missing job", async () => {
    const { app } = setup();
    const { status } = await request(app, "PUT", "/api/scheduler/jobs/nonexistent", { enabled: false });
    assert.equal(status, 404);
  });

  it("DELETE /api/scheduler/jobs/:jobId should remove job", async () => {
    const { app } = setup();
    const { status } = await request(app, "DELETE", "/api/scheduler/jobs/test-job");
    assert.equal(status, 204);
  });

  it("DELETE /api/scheduler/jobs/:jobId should return 404 for missing job", async () => {
    const { app } = setup();
    const { status } = await request(app, "DELETE", "/api/scheduler/jobs/nonexistent");
    assert.equal(status, 404);
  });

  it("POST /api/scheduler/jobs/:jobId/run should force-run a job", async () => {
    const { app, scheduler } = setup();
    let triggered = false;
    scheduler.onTrigger = async () => { triggered = true; };
    const { status, body } = await request(app, "POST", "/api/scheduler/jobs/test-job/run");
    assert.equal(status, 200);
    assert.equal(body.message, "Job triggered");
    assert.ok(triggered);
  });

  it("POST /api/scheduler/jobs/:jobId/run should return 404 for missing job", async () => {
    const { app } = setup();
    const { status } = await request(app, "POST", "/api/scheduler/jobs/nonexistent/run");
    assert.equal(status, 404);
  });

  it("GET /api/scheduler/upcoming should return upcoming triggers", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/scheduler/upcoming");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    assert.ok(body[0].jobId);
    assert.ok(body[0].nextRunAt);
  });

  it("GET /api/scheduler/jobs should filter by enabled", async () => {
    const { app, store } = setup();
    store.apply(new JobRegistered(
      "disabled-job", "Disabled", "* * * * *",
      { title: "T", description: "", category: "code", priority: "low" },
      "", "UTC", false, 1, false, 5, new Date().toISOString()
    ));
    const { status, body } = await request(app, "GET", "/api/scheduler/jobs?enabled=true");
    assert.equal(status, 200);
    assert.ok(body.every((j: { enabled: boolean }) => j.enabled === true));
  });
});
