import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeploymentAggregate } from "./DeploymentAggregate";
import { InitiateDeploy, RecordDeploySuccess, RecordDeployFailure, InitiateRollback, RecordRollbackComplete } from "./commands";
import { DeployInitiated, DeploySucceeded, DeployFailed, RollbackInitiated, RollbackCompleted } from "./events";

describe("DeploymentAggregate", () => {
  it("initiates a deploy", () => {
    const aggregate = new DeploymentAggregate();
    const events = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof DeployInitiated);
    const e = events[0] as DeployInitiated;
    assert.equal(e.deployId, "d1");
    assert.equal(e.environment, "staging");
    assert.equal(e.version, "abc123");
  });

  it("records deploy success", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const events = aggregate.execute(
      new RecordDeploySuccess("d1", true, "2024-01-01T00:01:00Z")
    );
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof DeploySucceeded);
  });

  it("records deploy failure", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const events = aggregate.execute(
      new RecordDeployFailure("d1", "Health check failed", "2024-01-01T00:01:00Z")
    );
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof DeployFailed);
  });

  it("rejects success on non-initiated deploy", () => {
    const aggregate = new DeploymentAggregate();
    assert.throws(
      () => aggregate.execute(new RecordDeploySuccess("d1", true, "2024-01-01T00:01:00Z")),
      { message: "Deploy does not exist" }
    );
  });

  it("rejects failure on already succeeded deploy", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const successEvents = aggregate.execute(
      new RecordDeploySuccess("d1", true, "2024-01-01T00:01:00Z")
    );
    for (const e of successEvents) aggregate.hydrate(e);

    assert.throws(
      () => aggregate.execute(new RecordDeployFailure("d1", "error", "2024-01-01T00:02:00Z")),
      { message: "Deploy not in initiated state" }
    );
  });

  it("initiates rollback on failed deploy", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const failEvents = aggregate.execute(
      new RecordDeployFailure("d1", "crash", "2024-01-01T00:01:00Z")
    );
    for (const e of failEvents) aggregate.hydrate(e);

    const events = aggregate.execute(
      new InitiateRollback("d1", "Health check failed", "2024-01-01T00:01:01Z")
    );
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof RollbackInitiated);
  });

  it("completes rollback", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const failEvents = aggregate.execute(
      new RecordDeployFailure("d1", "crash", "2024-01-01T00:01:00Z")
    );
    for (const e of failEvents) aggregate.hydrate(e);

    const rollbackEvents = aggregate.execute(
      new InitiateRollback("d1", "crash", "2024-01-01T00:01:01Z")
    );
    for (const e of rollbackEvents) aggregate.hydrate(e);

    const events = aggregate.execute(
      new RecordRollbackComplete("d1", "prev-version", "2024-01-01T00:02:00Z")
    );
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof RollbackCompleted);
  });

  it("rejects rollback on initiated deploy", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    assert.throws(
      () => aggregate.execute(new InitiateRollback("d1", "reason", "2024-01-01T00:01:00Z")),
      { message: "Deploy not in a rollback-eligible state" }
    );
  });

  it("rejects rollback complete when not rolling back", () => {
    const aggregate = new DeploymentAggregate();
    const initEvents = aggregate.execute(
      new InitiateDeploy("d1", "staging", "abc123", "direct", "2024-01-01T00:00:00Z")
    );
    for (const e of initEvents) aggregate.hydrate(e);

    const failEvents = aggregate.execute(
      new RecordDeployFailure("d1", "crash", "2024-01-01T00:01:00Z")
    );
    for (const e of failEvents) aggregate.hydrate(e);

    assert.throws(
      () => aggregate.execute(new RecordRollbackComplete("d1", "prev", "2024-01-01T00:02:00Z")),
      { message: "Deploy not in rolling_back state" }
    );
  });
});
