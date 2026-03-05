import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventStore, ConcurrencyError } from "./event-store";

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(":memory:");
  });

  it("should append and read events", () => {
    store.appendToStream("stream-1", [
      { type: "TestEvent", data: { value: "hello" } },
    ], 0);
    const events = store.read("stream-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "TestEvent");
    assert.equal(events[0].data.value, "hello");
    assert.equal(events[0].version, 1);
    assert.equal(events[0].streamId, "stream-1");
  });

  it("should append multiple events in one call", () => {
    store.appendToStream("stream-1", [
      { type: "A", data: { n: 1 } },
      { type: "B", data: { n: 2 } },
      { type: "C", data: { n: 3 } },
    ], 0);
    const events = store.read("stream-1");
    assert.equal(events.length, 3);
    assert.equal(events[0].version, 1);
    assert.equal(events[1].version, 2);
    assert.equal(events[2].version, 3);
  });

  it("should append to existing stream", () => {
    store.appendToStream("s-1", [{ type: "A", data: {} }], 0);
    store.appendToStream("s-1", [{ type: "B", data: {} }], 1);
    const events = store.read("s-1");
    assert.equal(events.length, 2);
    assert.equal(events[1].version, 2);
  });

  it("should throw ConcurrencyError on version mismatch", () => {
    store.appendToStream("s-1", [{ type: "A", data: {} }], 0);
    assert.throws(
      () => store.appendToStream("s-1", [{ type: "B", data: {} }], 0),
      (err: unknown) => (err as Error).name === "ConcurrencyError"
    );
  });

  it("should return empty array for unknown stream", () => {
    const events = store.read("nonexistent");
    assert.equal(events.length, 0);
  });

  it("should isolate streams", () => {
    store.appendToStream("s-1", [{ type: "A", data: { from: 1 } }], 0);
    store.appendToStream("s-2", [{ type: "B", data: { from: 2 } }], 0);
    assert.equal(store.read("s-1").length, 1);
    assert.equal(store.read("s-2").length, 1);
    assert.equal(store.read("s-1")[0].data.from, 1);
  });

  it("should assign global positions", () => {
    store.appendToStream("s-1", [{ type: "A", data: {} }], 0);
    store.appendToStream("s-2", [{ type: "B", data: {} }], 0);
    const e1 = store.read("s-1")[0];
    const e2 = store.read("s-2")[0];
    assert.ok(e2.globalPosition > e1.globalPosition);
  });

  it("should readAllBatch across streams", () => {
    store.appendToStream("s-1", [{ type: "A", data: {} }], 0);
    store.appendToStream("s-2", [{ type: "B", data: {} }], 0);
    store.appendToStream("s-1", [{ type: "C", data: {} }], 1);
    const all = store.readAllBatch(0, 100);
    assert.equal(all.length, 3);
    assert.equal(all[0].type, "A");
    assert.equal(all[1].type, "B");
    assert.equal(all[2].type, "C");
  });

  it("should readAllBatch with offset", () => {
    store.appendToStream("s-1", [{ type: "A", data: {} }, { type: "B", data: {} }], 0);
    const first = store.readAllBatch(0, 1);
    assert.equal(first.length, 1);
    const second = store.readAllBatch(first[0].globalPosition, 1);
    assert.equal(second.length, 1);
    assert.equal(second[0].type, "B");
  });

  it("should notify subscribers", () => {
    const received: string[] = [];
    store.subscribeToAll((e) => received.push(e.type));
    store.appendToStream("s-1", [{ type: "X", data: {} }, { type: "Y", data: {} }], 0);
    assert.deepEqual(received, ["X", "Y"]);
  });

  it("should unsubscribe", () => {
    const received: string[] = [];
    const unsub = store.subscribeToAll((e) => received.push(e.type));
    store.appendToStream("s-1", [{ type: "A", data: {} }], 0);
    unsub();
    store.appendToStream("s-1", [{ type: "B", data: {} }], 1);
    assert.deepEqual(received, ["A"]);
  });

  it("should preserve complex data", () => {
    const data = { nested: { arr: [1, 2, 3], bool: true }, str: "test" };
    store.appendToStream("s-1", [{ type: "T", data }], 0);
    const events = store.read("s-1");
    assert.deepEqual(events[0].data, data);
  });
});
