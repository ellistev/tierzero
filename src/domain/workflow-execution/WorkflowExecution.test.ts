import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkflowExecution } from "./WorkflowExecution";
import { StartWorkflowExecution, StartStep, CompleteStep, FailStep, SkipStep, CompleteExecution, FailExecution } from "./commands";
import { WorkflowExecutionStarted, WorkflowStepStarted, WorkflowStepCompleted, WorkflowStepFailed, WorkflowStepSkipped, WorkflowExecutionCompleted, WorkflowExecutionFailed } from "./events";

const now = "2026-01-01T00:00:00.000Z";

describe("WorkflowExecution Aggregate", () => {
  it("should start an execution", () => {
    const agg = new WorkflowExecution();
    const events = agg.execute(new StartWorkflowExecution("ex1", "t1", "wf-reboot", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof WorkflowExecutionStarted);
  });

  it("should start a step", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    const events = agg.execute(new StartStep("ex1", "login", "Logging in", now));
    assert.ok(events![0] instanceof WorkflowStepStarted);
  });

  it("should complete a step", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    agg.hydrate(new WorkflowStepStarted("ex1", "login", "Logging in", now));
    const events = agg.execute(new CompleteStep("ex1", "login", "Logged in successfully", now));
    assert.ok(events![0] instanceof WorkflowStepCompleted);
  });

  it("should fail a step", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    agg.hydrate(new WorkflowStepStarted("ex1", "login", "Logging in", now));
    const events = agg.execute(new FailStep("ex1", "login", "Timeout", now));
    assert.ok(events![0] instanceof WorkflowStepFailed);
  });

  it("should skip a step", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    const events = agg.execute(new SkipStep("ex1", "optional-check", "Not applicable", now));
    assert.ok(events![0] instanceof WorkflowStepSkipped);
  });

  it("should complete execution", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    const events = agg.execute(new CompleteExecution("ex1", "All done", { result: "ok" }, now));
    assert.ok(events![0] instanceof WorkflowExecutionCompleted);
  });

  it("should fail execution", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    const events = agg.execute(new FailExecution("ex1", "Critical error", now));
    assert.ok(events![0] instanceof WorkflowExecutionFailed);
  });

  it("should reject commands on non-existent execution", () => {
    const agg = new WorkflowExecution();
    assert.throws(() => agg.execute(new StartStep("ex1", "s", "d", now)), /does not exist/);
    assert.throws(() => agg.execute(new CompleteExecution("ex1", "s", {}, now)), /does not exist/);
  });

  it("should reject commands on completed execution", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    agg.hydrate(new WorkflowExecutionCompleted("ex1", "Done", {}, now));
    assert.throws(() => agg.execute(new StartStep("ex1", "s", "d", now)), /not running/);
    assert.throws(() => agg.execute(new CompleteExecution("ex1", "s", {}, now)), /not running/);
  });

  it("should reject commands on failed execution", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    agg.hydrate(new WorkflowExecutionFailed("ex1", "err", now));
    assert.throws(() => agg.execute(new StartStep("ex1", "s", "d", now)), /not running/);
  });

  it("should track steps through full lifecycle", () => {
    const agg = new WorkflowExecution();
    agg.hydrate(new WorkflowExecutionStarted("ex1", "t1", "wf-1", now));
    agg.hydrate(new WorkflowStepStarted("ex1", "step1", "Starting", now));
    agg.hydrate(new WorkflowStepCompleted("ex1", "step1", "Done", now));
    agg.hydrate(new WorkflowStepStarted("ex1", "step2", "Starting", now));
    agg.hydrate(new WorkflowStepFailed("ex1", "step2", "Error", now));
    agg.hydrate(new WorkflowStepSkipped("ex1", "step3", "N/A", now));
    agg.hydrate(new WorkflowExecutionCompleted("ex1", "Partial", {}, now));
    const state = agg.createMemento().state;
    assert.equal(state.status, "completed");
    assert.equal((state.steps as unknown[]).length, 3);
  });
});
