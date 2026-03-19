import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KnowledgeAggregate } from "./KnowledgeAggregate";
import { AddKnowledge, RecordKnowledgeUsage, SupersedeKnowledge } from "./commands";
import { KnowledgeAdded, KnowledgeUsed, KnowledgeSuperseded } from "./events";

function makeAggregate() {
  return new KnowledgeAggregate();
}

function addKnowledge(agg: KnowledgeAggregate, id = "k1") {
  const events = agg.execute(new AddKnowledge(
    id, "solution", "How to add a connector",
    "1. Create file\n2. Implement interface",
    { taskId: "task-1", agentName: "claude-code", timestamp: "2026-03-18T10:00:00Z" },
    ["connector"], ["src/connectors/example.ts"], 0.9
  ));
  for (const e of events as unknown[]) agg.hydrate(e);
  return events;
}

describe("KnowledgeAggregate", () => {
  it("should add knowledge", () => {
    const agg = makeAggregate();
    const events = addKnowledge(agg);
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof KnowledgeAdded);
    assert.equal((events[0] as KnowledgeAdded).id, "k1");
    assert.equal((events[0] as KnowledgeAdded).type, "solution");
    assert.equal((events[0] as KnowledgeAdded).title, "How to add a connector");
    assert.equal((events[0] as KnowledgeAdded).confidence, 0.9);
  });

  it("should record usage", () => {
    const agg = makeAggregate();
    addKnowledge(agg);
    const events = agg.execute(new RecordKnowledgeUsage("k1", "task-2", "2026-03-18T11:00:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof KnowledgeUsed);
    assert.equal((events[0] as KnowledgeUsed).taskId, "task-2");
  });

  it("should reject usage on non-existent entry", () => {
    const agg = makeAggregate();
    assert.throws(() => {
      agg.execute(new RecordKnowledgeUsage("k1", "task-2", "2026-03-18T11:00:00Z"));
    }, /does not exist/);
  });

  it("should reject usage on superseded entry", () => {
    const agg = makeAggregate();
    addKnowledge(agg);
    const supersedeEvents = agg.execute(new SupersedeKnowledge("k1", "k2", "newer version")) as unknown[];
    for (const e of supersedeEvents) agg.hydrate(e);

    assert.throws(() => {
      agg.execute(new RecordKnowledgeUsage("k1", "task-2", "2026-03-18T11:00:00Z"));
    }, /superseded/);
  });

  it("should supersede knowledge", () => {
    const agg = makeAggregate();
    addKnowledge(agg);
    const events = agg.execute(new SupersedeKnowledge("k1", "k2", "better approach"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof KnowledgeSuperseded);
    assert.equal((events[0] as KnowledgeSuperseded).oldId, "k1");
    assert.equal((events[0] as KnowledgeSuperseded).newId, "k2");
    assert.equal((events[0] as KnowledgeSuperseded).reason, "better approach");
  });

  it("should reject double supersede", () => {
    const agg = makeAggregate();
    addKnowledge(agg);
    const events = agg.execute(new SupersedeKnowledge("k1", "k2", "reason")) as unknown[];
    for (const e of events) agg.hydrate(e);

    assert.throws(() => {
      agg.execute(new SupersedeKnowledge("k1", "k3", "another reason"));
    }, /already superseded/);
  });

  it("should track usage count via hydrate", () => {
    const agg = makeAggregate();
    addKnowledge(agg);

    const e1 = agg.execute(new RecordKnowledgeUsage("k1", "task-2", "2026-03-18T11:00:00Z")) as unknown[];
    for (const e of e1) agg.hydrate(e);

    const e2 = agg.execute(new RecordKnowledgeUsage("k1", "task-3", "2026-03-18T12:00:00Z")) as unknown[];
    for (const e of e2) agg.hydrate(e);

    // Should not throw - entry still valid after 2 usages
    const e3 = agg.execute(new RecordKnowledgeUsage("k1", "task-4", "2026-03-18T13:00:00Z"));
    assert.equal(e3.length, 1);
  });
});
