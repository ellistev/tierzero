import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore - JS module
import websql from "websql";
// @ts-ignore - JS module
import WebSqlEventStore from "./websqles/EventStoreImpl.js";

function createStore() {
  function openDatabase(name: string, ver: string, arg3: string, arg4: number) {
    return websql(":memory:", ver, arg3, arg4);
  }
  return new WebSqlEventStore(
    { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    100,
    { openDatabase }
  );
}

describe("WebSqlEventStore", () => {
  let store: any;

  beforeEach(() => {
    store = createStore();
  });

  it("should save and read events", async () => {
    const events = [{ type: "TestEvent", value: "hello" }];
    await store.save("stream-1", events, -1);
    const read = await store.read("stream-1");
    assert.equal(read.length, 1);
    assert.equal(read[0].data.type, "TestEvent");
    assert.equal(read[0].data.value, "hello");
  });

  it("should save multiple events", async () => {
    const events = [
      { type: "A", n: 1 },
      { type: "B", n: 2 },
      { type: "C", n: 3 },
    ];
    await store.save("stream-1", events, -1);
    const read = await store.read("stream-1");
    assert.equal(read.length, 3);
  });

  it("should append to existing stream", async () => {
    await store.save("s-1", [{ type: "A" }], -1);
    await store.save("s-1", [{ type: "B" }], 0);
    const read = await store.read("s-1");
    assert.equal(read.length, 2);
  });

  it("should throw on wrong expected version", async () => {
    await store.save("s-1", [{ type: "A" }], -1);
    await assert.rejects(
      () => store.save("s-1", [{ type: "B" }], -1),
      (err: any) => err.name === "WrongExpectedVersionError"
    );
  });

  it("should return empty array for unknown stream", async () => {
    const read = await store.read("nonexistent");
    assert.equal(read.length, 0);
  });

  it("should isolate streams", async () => {
    await store.save("s-1", [{ from: 1 }], -1);
    await store.save("s-2", [{ from: 2 }], -1);
    const r1 = await store.read("s-1");
    const r2 = await store.read("s-2");
    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.equal(r1[0].data.from, 1);
    assert.equal(r2[0].data.from, 2);
  });

  it("should subscribe to events", async () => {
    const received: any[] = [];
    store.on("eventAppeared", (e: any) => received.push(e));
    await store.save("s-1", [{ type: "X" }, { type: "Y" }], -1);
    assert.equal(received.length, 2);
    assert.equal(received[0].streamId, "s-1");
    assert.equal(received[0].data.type, "X");
    assert.equal(received[1].data.type, "Y");
  });

  it("should preserve complex data", async () => {
    const data = { nested: { arr: [1, 2, 3], bool: true }, str: "test" };
    await store.save("s-1", [data], -1);
    const read = await store.read("s-1");
    assert.deepEqual(read[0].data.nested, data.nested);
  });

  it("should readAllBatch", async () => {
    await store.save("s-1", [{ type: "A" }], -1);
    await store.save("s-2", [{ type: "B" }], -1);
    const result = await store.readAllBatch(store.START_POSITION, 100);
    assert.equal(result.events.length, 2);
    assert.equal(result.isEndOfStream, true);
  });
});
