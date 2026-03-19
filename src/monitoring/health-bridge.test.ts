import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComponentCheckers } from "./health-bridge";
import { AgentProcessStore } from "../read-models/agent-processes";
import { AgentSpawned, AgentHung } from "../domain/agent-process/events";
import type { TicketConnector } from "../connectors/connector";
import type { NotificationManager } from "../comms/notification-manager";
import type { CommChannel } from "../comms/channel";
import type { Scheduler } from "../scheduler/scheduler";
import type { TaskRouter } from "../orchestrator/task-router";

function fakeRouter(): TaskRouter {
  return {} as TaskRouter;
}

function fakeConnector(name: string, ok: boolean): TicketConnector {
  return {
    name,
    healthCheck: async () => ({ ok, connector: name, latencyMs: ok ? 50 : 0, error: ok ? undefined : "down" }),
    listTickets: async () => ({ tickets: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
    getTicket: async () => { throw new Error("not implemented"); },
    getComments: async () => [],
    addComment: async () => { throw new Error("not implemented"); },
    listAttachments: async () => [],
    downloadAttachment: async () => Buffer.from(""),
    uploadAttachment: async () => { throw new Error("not implemented"); },
    updateTicket: async () => { throw new Error("not implemented"); },
  };
}

function fakeChannel(name: string, ok: boolean): CommChannel {
  return {
    name,
    type: "webhook",
    send: async () => ({ success: true, sentAt: new Date().toISOString() }),
    healthCheck: async () => ({ ok }),
  };
}

function fakeNotifier(channels: CommChannel[]): NotificationManager {
  return {
    getChannels: () => channels,
  } as unknown as NotificationManager;
}

function fakeScheduler(jobs: Array<{ enabled: boolean }>): Scheduler {
  return {
    listJobs: () => jobs,
  } as unknown as Scheduler;
}

describe("buildComponentCheckers", () => {
  it("should return empty array with no inputs", () => {
    const checkers = buildComponentCheckers({});
    assert.equal(checkers.length, 0);
  });

  it("should create task-router checker that is always healthy", async () => {
    const checkers = buildComponentCheckers({ router: fakeRouter() });
    assert.equal(checkers.length, 1);
    assert.equal(checkers[0].name, "task-router");

    const health = await checkers[0].check();
    assert.equal(health.status, "healthy");
    assert.equal(health.name, "task-router");
  });

  it("should create supervisor checker - healthy when no hung agents", async () => {
    const agentStore = new AgentProcessStore();
    agentStore.apply(new AgentSpawned("p1", "coder", "t1", "2026-03-18T08:00:00Z"));

    const checkers = buildComponentCheckers({ agentStore });
    const checker = checkers.find(c => c.name === "supervisor");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "healthy");
    assert.ok(health.details!.includes("running="));
  });

  it("should create supervisor checker - degraded when hung agents", async () => {
    const agentStore = new AgentProcessStore();
    agentStore.apply(new AgentSpawned("p1", "coder", "t1", "2026-03-18T08:00:00Z"));
    agentStore.apply(new AgentHung("p1", "t1", "2026-03-18T08:00:00Z", "2026-03-18T08:10:00Z"));

    const checkers = buildComponentCheckers({ agentStore });
    const checker = checkers.find(c => c.name === "supervisor");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "degraded");
    assert.ok(health.details!.includes("hung=1"));
  });

  it("should create connectors checker - healthy when all ok", async () => {
    const connectors = [fakeConnector("GitHub", true), fakeConnector("Jira", true)];
    const checkers = buildComponentCheckers({ connectors });
    const checker = checkers.find(c => c.name === "connectors");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "healthy");
    assert.ok(health.details!.includes("2 connector(s) healthy"));
  });

  it("should create connectors checker - down when any fails", async () => {
    const connectors = [fakeConnector("GitHub", true), fakeConnector("Jira", false)];
    const checkers = buildComponentCheckers({ connectors });
    const checker = checkers.find(c => c.name === "connectors");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "down");
    assert.ok(health.details!.includes("Jira"));
  });

  it("should create notifications checker - healthy when channels ok", async () => {
    const notifier = fakeNotifier([fakeChannel("slack", true)]);
    const checkers = buildComponentCheckers({ notifier });
    const checker = checkers.find(c => c.name === "notifications");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "healthy");
  });

  it("should create notifications checker - degraded when channel fails", async () => {
    const notifier = fakeNotifier([fakeChannel("slack", false)]);
    const checkers = buildComponentCheckers({ notifier });
    const checker = checkers.find(c => c.name === "notifications");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "degraded");
    assert.ok(health.details!.includes("slack"));
  });

  it("should create notifications checker - healthy with no channels", async () => {
    const notifier = fakeNotifier([]);
    const checkers = buildComponentCheckers({ notifier });
    const checker = checkers.find(c => c.name === "notifications");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "healthy");
    assert.ok(health.details!.includes("No channels"));
  });

  it("should create scheduler checker showing job counts", async () => {
    const scheduler = fakeScheduler([{ enabled: true }, { enabled: true }, { enabled: false }]);
    const checkers = buildComponentCheckers({ scheduler });
    const checker = checkers.find(c => c.name === "scheduler");
    assert.ok(checker);

    const health = await checker!.check();
    assert.equal(health.status, "healthy");
    assert.ok(health.details!.includes("2/3 jobs enabled"));
  });

  it("should create all checkers when everything is provided", () => {
    const checkers = buildComponentCheckers({
      router: fakeRouter(),
      agentStore: new AgentProcessStore(),
      connectors: [fakeConnector("GitHub", true)],
      notifier: fakeNotifier([fakeChannel("slack", true)]),
      scheduler: fakeScheduler([{ enabled: true }]),
    });
    assert.equal(checkers.length, 5);
    const names = checkers.map(c => c.name);
    assert.ok(names.includes("task-router"));
    assert.ok(names.includes("supervisor"));
    assert.ok(names.includes("connectors"));
    assert.ok(names.includes("notifications"));
    assert.ok(names.includes("scheduler"));
  });
});
