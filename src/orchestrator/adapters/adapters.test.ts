import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitHubAdapter } from "./github-adapter";
import { WebhookAdapter } from "./webhook-adapter";
import { ScheduleAdapter, parseCronToMs } from "./schedule-adapter";
import type { TaskSource } from "../agent-registry";

describe("GitHubAdapter", () => {
  it("should initialize with name 'github'", () => {
    const adapter = new GitHubAdapter({ owner: "test", repo: "repo", token: "tok" });
    assert.equal(adapter.name, "github");
  });

  it("should start and stop without error", async () => {
    const adapter = new GitHubAdapter({ owner: "test", repo: "repo", token: "tok", interval: 999999 });
    // Override poll to avoid real HTTP calls
    (adapter as any).poll = async () => {};
    await adapter.start();
    await adapter.stop();
  });

  it("should set onTask callback", () => {
    const adapter = new GitHubAdapter({ owner: "test", repo: "repo", token: "tok" });
    const sources: TaskSource[] = [];
    adapter.onTask = (s) => sources.push(s);
    assert.equal(typeof adapter.onTask, "function");
  });
});

describe("WebhookAdapter", () => {
  it("should initialize with name 'webhook'", () => {
    const adapter = new WebhookAdapter({ port: 0 });
    assert.equal(adapter.name, "webhook");
  });

  it("should start and stop server", async () => {
    const adapter = new WebhookAdapter({ port: 0 });
    await adapter.start();
    await adapter.stop();
  });

  it("should accept POST /api/tasks and emit source", async () => {
    const adapter = new WebhookAdapter({ port: 0 });
    const sources: TaskSource[] = [];
    adapter.onTask = (s) => sources.push(s);

    await adapter.start();

    // Get the actual port
    const server = (adapter as any).server;
    const address = server.address();
    const port = typeof address === "object" ? address.port : 0;

    const resp = await fetch(`http://localhost:${port}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", description: "Desc", category: "code" }),
    });

    assert.equal(resp.status, 202);
    const body = await resp.json();
    assert.equal(body.accepted, true);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].type, "webhook");

    await adapter.stop();
  });
});

describe("ScheduleAdapter", () => {
  it("should initialize with name 'schedule'", () => {
    const adapter = new ScheduleAdapter([]);
    assert.equal(adapter.name, "schedule");
  });

  it("should start and stop without error", async () => {
    const adapter = new ScheduleAdapter([
      { id: "test", cron: "*/5 * * * *", taskTemplate: { title: "Test" }, enabled: true },
    ]);
    await adapter.start();
    await adapter.stop();
  });

  it("should not start disabled schedules", async () => {
    const adapter = new ScheduleAdapter([
      { id: "test", cron: "*/5 * * * *", taskTemplate: { title: "Test" }, enabled: false },
    ]);
    await adapter.start();
    assert.equal((adapter as any).timers.length, 0);
    await adapter.stop();
  });

  it("should set onTask callback", () => {
    const adapter = new ScheduleAdapter([]);
    const sources: TaskSource[] = [];
    adapter.onTask = (s) => sources.push(s);
    assert.equal(typeof adapter.onTask, "function");
  });
});

describe("parseCronToMs", () => {
  it("should parse */5 * * * * as 5 minutes", () => {
    assert.equal(parseCronToMs("*/5 * * * *"), 5 * 60_000);
  });

  it("should parse */30 * * * * as 30 minutes", () => {
    assert.equal(parseCronToMs("*/30 * * * *"), 30 * 60_000);
  });

  it("should parse */1 * * * * as 1 minute", () => {
    assert.equal(parseCronToMs("*/1 * * * *"), 60_000);
  });

  it("should parse fixed minute (e.g. 15 * * * *) as every hour", () => {
    assert.equal(parseCronToMs("15 * * * *"), 60 * 60_000);
  });

  it("should default to 1 minute for complex expressions", () => {
    assert.equal(parseCronToMs("0 0 * * *"), 60_000);
  });

  it("should default to 1 minute for short expressions", () => {
    assert.equal(parseCronToMs("* *"), 60_000);
  });
});
