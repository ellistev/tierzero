import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "../infra/event-store";
import { ReadModelBuilder, ReadRepository } from "../infra/read-model";
import { workflowExecutionsReadModel } from "./workflow-executions";

describe("WorkflowExecutions Read Model", () => {
  let store: EventStore;
  let builder: ReadModelBuilder;
  let repo: ReadRepository;

  beforeEach(() => {
    store = new EventStore(":memory:");
    builder = new ReadModelBuilder(":memory:");
    repo = builder.register(workflowExecutionsReadModel);
    builder.subscribeTo(store);
  });

  it("should create execution on WorkflowExecutionStarted", () => {
    store.appendToStream("WE-ex1", [{ type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } }], 0);
    const exec = repo.findOne("ex1");
    assert.ok(exec);
    assert.equal(exec.status, "running");
    assert.equal(exec.ticketId, "t1");
  });

  it("should track steps", () => {
    store.appendToStream("WE-ex1", [
      { type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } },
      { type: "WorkflowStepStarted", data: { executionId: "ex1", stepName: "login", detail: "Logging in", startedAt: "2026-01-01" } },
      { type: "WorkflowStepCompleted", data: { executionId: "ex1", stepName: "login", detail: "OK", completedAt: "2026-01-01" } },
    ], 0);
    const exec = repo.findOne("ex1")!;
    const steps = exec.steps as Array<Record<string, unknown>>;
    assert.equal(steps.length, 1);
    assert.equal(steps[0].status, "completed");
  });

  it("should track failed steps", () => {
    store.appendToStream("WE-ex1", [
      { type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } },
      { type: "WorkflowStepStarted", data: { executionId: "ex1", stepName: "reboot", detail: "Rebooting", startedAt: "2026-01-01" } },
      { type: "WorkflowStepFailed", data: { executionId: "ex1", stepName: "reboot", error: "Timeout", failedAt: "2026-01-01" } },
    ], 0);
    const steps = (repo.findOne("ex1")!.steps as Array<Record<string, unknown>>);
    assert.equal(steps[0].status, "failed");
  });

  it("should track skipped steps", () => {
    store.appendToStream("WE-ex1", [
      { type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } },
      { type: "WorkflowStepSkipped", data: { executionId: "ex1", stepName: "optional", reason: "N/A", skippedAt: "2026-01-01" } },
    ], 0);
    const steps = (repo.findOne("ex1")!.steps as Array<Record<string, unknown>>);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].status, "skipped");
  });

  it("should mark completed", () => {
    store.appendToStream("WE-ex1", [
      { type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } },
      { type: "WorkflowExecutionCompleted", data: { executionId: "ex1", summary: "All good", data: {}, completedAt: "2026-01-02" } },
    ], 0);
    assert.equal(repo.findOne("ex1")!.status, "completed");
    assert.equal(repo.findOne("ex1")!.summary, "All good");
  });

  it("should mark failed", () => {
    store.appendToStream("WE-ex1", [
      { type: "WorkflowExecutionStarted", data: { executionId: "ex1", ticketId: "t1", workflowId: "wf-1", startedAt: "2026-01-01" } },
      { type: "WorkflowExecutionFailed", data: { executionId: "ex1", error: "Fatal", failedAt: "2026-01-02" } },
    ], 0);
    assert.equal(repo.findOne("ex1")!.status, "failed");
    assert.equal(repo.findOne("ex1")!.error, "Fatal");
  });
});
