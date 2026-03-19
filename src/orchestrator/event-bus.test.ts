/**
 * Unit tests for EventBus - publish/subscribe and multi-source connectivity.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { EventBus } from "../infra/event-bus";

// Minimal mock that satisfies the TaskRouter interface for event forwarding
class MockRouter extends EventEmitter {}

// Minimal mock that satisfies the AgentSupervisor interface for event forwarding
class MockSupervisor extends EventEmitter {}

// Minimal mock that satisfies the Scheduler interface for event forwarding
class MockScheduler extends EventEmitter {}

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("publish / subscribe", () => {
    it("should deliver events to matching subscribers", () => {
      const received: unknown[] = [];
      bus.subscribe("TaskCompleted", (data) => received.push(data));

      const event = { constructor: { type: "TaskCompleted" }, taskId: "t1" };
      bus.publish("TaskCompleted", event);

      assert.equal(received.length, 1);
      assert.deepStrictEqual(received[0], event);
    });

    it("should not deliver events to non-matching subscribers", () => {
      const received: unknown[] = [];
      bus.subscribe("TaskFailed", (data) => received.push(data));

      const event = { constructor: { type: "TaskCompleted" }, taskId: "t1" };
      bus.publish("TaskCompleted", event);

      assert.equal(received.length, 0);
    });

    it("should support multiple subscribers for the same event type", () => {
      let count = 0;
      bus.subscribe("AgentHung", () => count++);
      bus.subscribe("AgentHung", () => count++);

      bus.publish("AgentHung", { constructor: { type: "AgentHung" } });

      assert.equal(count, 2);
    });

    it("should support fallback to event.type when constructor.type is missing", () => {
      const received: unknown[] = [];
      bus.subscribe("custom-event", (data) => received.push(data));

      const event = { type: "custom-event", payload: "hello" };
      bus.publish("custom-event", event);

      assert.equal(received.length, 1);
    });
  });

  describe("connectRouter", () => {
    it("should forward router events to the bus", () => {
      const mockRouter = new MockRouter();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectRouter(mockRouter as any);

      const event = { constructor: { type: "TaskCompleted" }, taskId: "t1" };
      mockRouter.emit("event", event);

      assert.equal(received.length, 1);
      assert.deepStrictEqual(received[0], event);
    });

    it("should emit router-namespaced events", () => {
      const mockRouter = new MockRouter();
      const received: unknown[] = [];

      bus.on("router:event", (event) => received.push(event));
      bus.connectRouter(mockRouter as any);

      const event = { constructor: { type: "TaskCompleted" } };
      mockRouter.emit("event", event);

      assert.equal(received.length, 1);
    });

    it("should stop forwarding after disconnectRouter", () => {
      const mockRouter = new MockRouter();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectRouter(mockRouter as any);
      bus.disconnectRouter();

      mockRouter.emit("event", { constructor: { type: "TaskCompleted" } });

      assert.equal(received.length, 0);
    });
  });

  describe("connectSupervisor", () => {
    it("should forward supervisor events to the bus", () => {
      const mockSupervisor = new MockSupervisor();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectSupervisor(mockSupervisor as any);

      const event = { constructor: { type: "AgentHung" }, processId: "p1" };
      mockSupervisor.emit("event", event);

      assert.equal(received.length, 1);
      assert.deepStrictEqual(received[0], event);
    });

    it("should emit supervisor-namespaced events", () => {
      const mockSupervisor = new MockSupervisor();
      const received: unknown[] = [];

      bus.on("supervisor:event", (event) => received.push(event));
      bus.connectSupervisor(mockSupervisor as any);

      mockSupervisor.emit("event", { constructor: { type: "AgentHung" } });

      assert.equal(received.length, 1);
    });

    it("should stop forwarding after disconnectSupervisor", () => {
      const mockSupervisor = new MockSupervisor();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectSupervisor(mockSupervisor as any);
      bus.disconnectSupervisor();

      mockSupervisor.emit("event", { constructor: { type: "AgentHung" } });

      assert.equal(received.length, 0);
    });
  });

  describe("connectScheduler", () => {
    it("should forward scheduler events to the bus", () => {
      const mockScheduler = new MockScheduler();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectScheduler(mockScheduler as any);

      const event = { constructor: { type: "JobTriggered" }, jobId: "j1" };
      mockScheduler.emit("event", event);

      assert.equal(received.length, 1);
    });

    it("should emit scheduler-namespaced events", () => {
      const mockScheduler = new MockScheduler();
      const received: unknown[] = [];

      bus.on("scheduler:event", (event) => received.push(event));
      bus.connectScheduler(mockScheduler as any);

      mockScheduler.emit("event", { constructor: { type: "JobTriggered" } });

      assert.equal(received.length, 1);
    });
  });

  describe("multi-source connectivity", () => {
    it("should forward events from all connected sources", () => {
      const mockRouter = new MockRouter();
      const mockSupervisor = new MockSupervisor();
      const mockScheduler = new MockScheduler();
      const received: unknown[] = [];

      bus.on("event", (event) => received.push(event));
      bus.connectRouter(mockRouter as any);
      bus.connectSupervisor(mockSupervisor as any);
      bus.connectScheduler(mockScheduler as any);

      mockRouter.emit("event", { constructor: { type: "TaskCompleted" } });
      mockSupervisor.emit("event", { constructor: { type: "AgentHung" } });
      mockScheduler.emit("event", { constructor: { type: "JobTriggered" } });

      assert.equal(received.length, 3);
    });

    it("should deliver events from all sources to matching subscribers", () => {
      const mockRouter = new MockRouter();
      const mockSupervisor = new MockSupervisor();
      const taskEvents: unknown[] = [];
      const agentEvents: unknown[] = [];

      bus.subscribe("TaskCompleted", (data) => taskEvents.push(data));
      bus.subscribe("AgentHung", (data) => agentEvents.push(data));

      bus.connectRouter(mockRouter as any);
      bus.connectSupervisor(mockSupervisor as any);

      mockRouter.emit("event", { constructor: { type: "TaskCompleted" }, taskId: "t1" });
      mockSupervisor.emit("event", { constructor: { type: "AgentHung" }, processId: "p1" });

      assert.equal(taskEvents.length, 1);
      assert.equal(agentEvents.length, 1);
    });
  });
});
