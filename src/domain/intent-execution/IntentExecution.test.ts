import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IntentExecution } from "./IntentExecution";
import { AttemptIntent, ResolveSelector, SucceedIntent, FailIntent, AttemptRecovery, SucceedRecovery, FailRecovery, EscalateIntent } from "./commands";
import { IntentAttempted, SelectorResolved, IntentSucceeded, IntentFailed, RecoveryAttempted, RecoverySucceeded, RecoveryFailed, IntentEscalated } from "./events";

const now = "2026-01-01T00:00:00.000Z";

describe("IntentExecution Aggregate", () => {
  it("should attempt an intent", () => {
    const agg = new IntentExecution();
    const events = agg.execute(new AttemptIntent("i1", "click-search", "Click Search button", "/admin", null, {}, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof IntentAttempted);
    const e = events![0] as IntentAttempted;
    assert.equal(e.intentId, "i1");
    assert.equal(e.intentName, "click-search");
    assert.equal(e.goal, "Click Search button");
    assert.equal(e.page, "/admin");
  });

  it("should resolve a selector after attempting", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    const events = agg.execute(new ResolveSelector("i1", "button[name='Search']", "aria", 50, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof SelectorResolved);
    const e = events![0] as SelectorResolved;
    assert.equal(e.selector, "button[name='Search']");
    assert.equal(e.method, "aria");
  });

  it("should succeed an intent", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new SelectorResolved("i1", "button#search", "cached", 10, now));
    const events = agg.execute(new SucceedIntent("i1", "button#search", "cached", 100, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof IntentSucceeded);
  });

  it("should fail an intent", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    const events = agg.execute(new FailIntent("i1", "Element not found", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof IntentFailed);
  });

  it("should attempt recovery after failure", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentFailed("i1", "Element not found", now));
    const events = agg.execute(new AttemptRecovery("i1", "Element not found", "dismiss-dialog", 1, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof RecoveryAttempted);
  });

  it("should succeed recovery", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentFailed("i1", "Element not found", now));
    agg.hydrate(new RecoveryAttempted("i1", "Element not found", "dismiss-dialog", 1, now));
    const events = agg.execute(new SucceedRecovery("i1", "dismiss-dialog", "Dismissed modal", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof RecoverySucceeded);
  });

  it("should fail recovery", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentFailed("i1", "Element not found", now));
    agg.hydrate(new RecoveryAttempted("i1", "Element not found", "dismiss-dialog", 1, now));
    const events = agg.execute(new FailRecovery("i1", "dismiss-dialog", "No dialog found", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof RecoveryFailed);
  });

  it("should escalate an intent", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    const events = agg.execute(new EscalateIntent("i1", "All strategies exhausted", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof IntentEscalated);
  });

  it("should reject commands on non-existent intent", () => {
    const agg = new IntentExecution();
    assert.throws(() => agg.execute(new ResolveSelector("i1", "sel", "cached", 10, now)), /does not exist/);
    assert.throws(() => agg.execute(new SucceedIntent("i1", "sel", "cached", 100, now)), /does not exist/);
    assert.throws(() => agg.execute(new FailIntent("i1", "err", now)), /does not exist/);
    assert.throws(() => agg.execute(new AttemptRecovery("i1", "err", "strat", 1, now)), /does not exist/);
    assert.throws(() => agg.execute(new EscalateIntent("i1", "reason", now)), /does not exist/);
  });

  it("should reject commands on already-succeeded intent", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentSucceeded("i1", "button#search", "cached", 100, now));
    assert.throws(() => agg.execute(new ResolveSelector("i1", "sel", "cached", 10, now)), /finalized/);
    assert.throws(() => agg.execute(new SucceedIntent("i1", "sel", "cached", 100, now)), /already succeeded/);
    assert.throws(() => agg.execute(new FailIntent("i1", "err", now)), /already succeeded/);
    assert.throws(() => agg.execute(new EscalateIntent("i1", "reason", now)), /already succeeded/);
  });

  it("should reject commands on already-escalated intent", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentEscalated("i1", "reason", now));
    assert.throws(() => agg.execute(new ResolveSelector("i1", "sel", "cached", 10, now)), /finalized/);
    assert.throws(() => agg.execute(new SucceedIntent("i1", "sel", "cached", 100, now)), /already escalated/);
    assert.throws(() => agg.execute(new EscalateIntent("i1", "again", now)), /already escalated/);
  });

  it("should reject SucceedRecovery when not in recovery state", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    assert.throws(() => agg.execute(new SucceedRecovery("i1", "strat", "detail", now)), /Not in recovery/);
  });

  it("should reject FailRecovery when not in recovery state", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    assert.throws(() => agg.execute(new FailRecovery("i1", "strat", "error", now)), /Not in recovery/);
  });

  it("should build correct state through full lifecycle", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentFailed("i1", "Not found", now));
    agg.hydrate(new RecoveryAttempted("i1", "Not found", "dismiss-dialog", 1, now));
    agg.hydrate(new RecoverySucceeded("i1", "dismiss-dialog", "Dismissed", now));
    agg.hydrate(new SelectorResolved("i1", "button#search", "aria", 30, now));
    agg.hydrate(new IntentSucceeded("i1", "button#search", "aria", 200, now));
    const state = agg.createMemento().state;
    assert.equal(state.status, "succeeded");
    assert.equal(state.intentName, "click-search");
    assert.equal(state.resolvedSelector, "button#search");
    assert.equal(state.method, "aria");
    assert.equal(state.recoveryAttempts, 1);
    assert.equal(state.attempts, 2); // initial + 1 failure
  });

  it("should track multiple recovery attempts", () => {
    const agg = new IntentExecution();
    agg.hydrate(new IntentAttempted("i1", "click-search", "Click Search", "/admin", null, {}, now));
    agg.hydrate(new IntentFailed("i1", "Not found", now));
    agg.hydrate(new RecoveryAttempted("i1", "Not found", "dismiss-dialog", 1, now));
    agg.hydrate(new RecoveryFailed("i1", "dismiss-dialog", "No dialog", now));
    // After recovery fails, status goes to "failed", so we can attempt recovery again
    agg.hydrate(new RecoveryAttempted("i1", "Still not found", "llm-recovery", 2, now));
    agg.hydrate(new RecoverySucceeded("i1", "llm-recovery", "Navigated", now));
    const state = agg.createMemento().state;
    assert.equal(state.recoveryAttempts, 2);
    assert.equal(state.status, "attempting");
  });

  it("should save and restore from memento", () => {
    const agg1 = new IntentExecution();
    agg1.hydrate(new IntentAttempted("i1", "fill-field", "Fill the name field", "/form", "John", {}, now));
    agg1.hydrate(new SelectorResolved("i1", "input#name", "cached", 5, now));
    const memento = agg1.createMemento();

    const agg2 = new IntentExecution();
    agg2.restoreFromMemento(memento);
    const state = agg2.createMemento().state;
    assert.equal(state.intentId, "i1");
    assert.equal(state.resolvedSelector, "input#name");
    assert.equal(state.status, "resolved");
  });
});
