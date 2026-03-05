import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ReadModelBuilder, ReadRepository } from "./read-model";
import { EventStore } from "./event-store";
import type { ReadModelDefinition, StoredEvent, ReadModelRepo } from "./interfaces";

const testModel: ReadModelDefinition = {
  config: {
    table: "items",
    key: "id",
    schema: { id: "TEXT PRIMARY KEY", name: "TEXT", count: "INTEGER" },
  },
  handler(repo: ReadModelRepo, event: StoredEvent) {
    switch (event.type) {
      case "ItemAdded":
        repo.create({ id: event.data.id, name: event.data.name, count: 1 });
        break;
      case "ItemUpdated":
        repo.updateOne(event.data.id as string, { name: event.data.name });
        break;
      case "ItemIncremented":
        const item = repo.findOne(event.data.id as string);
        if (item) repo.updateOne(event.data.id as string, { count: (item.count as number) + 1 });
        break;
    }
  },
};

describe("ReadModelBuilder", () => {
  let builder: ReadModelBuilder;
  let repo: ReadRepository;

  beforeEach(() => {
    builder = new ReadModelBuilder(":memory:");
    repo = builder.register(testModel);
  });

  it("should project events into read model", () => {
    const store = new EventStore(":memory:");
    builder.subscribeTo(store);
    store.appendToStream("s-1", [{ type: "ItemAdded", data: { id: "i1", name: "Apple" } }], 0);
    const item = repo.findOne("i1");
    assert.ok(item);
    assert.equal(item.name, "Apple");
    assert.equal(item.count, 1);
  });

  it("should handle updates", () => {
    const store = new EventStore(":memory:");
    builder.subscribeTo(store);
    store.appendToStream("s-1", [
      { type: "ItemAdded", data: { id: "i1", name: "Apple" } },
      { type: "ItemUpdated", data: { id: "i1", name: "Banana" } },
    ], 0);
    const item = repo.findOne("i1");
    assert.equal(item!.name, "Banana");
  });

  it("should catch up from event store", () => {
    const store = new EventStore(":memory:");
    store.appendToStream("s-1", [{ type: "ItemAdded", data: { id: "i1", name: "Apple" } }], 0);
    store.appendToStream("s-1", [{ type: "ItemAdded", data: { id: "i2", name: "Banana" } }], 1);
    builder.catchUp(store);
    assert.equal(repo.findAll().length, 2);
  });

  it("should findAll", () => {
    const store = new EventStore(":memory:");
    builder.subscribeTo(store);
    store.appendToStream("s-1", [
      { type: "ItemAdded", data: { id: "i1", name: "A" } },
      { type: "ItemAdded", data: { id: "i2", name: "B" } },
    ], 0);
    const all = repo.findAll();
    assert.equal(all.length, 2);
  });

  it("should return undefined for missing items", () => {
    assert.equal(repo.findOne("nonexistent"), undefined);
  });

  it("should upsert", () => {
    const store = new EventStore(":memory:");
    builder.subscribeTo(store);
    store.appendToStream("s-1", [{ type: "ItemAdded", data: { id: "i1", name: "Apple" } }], 0);
    repo.upsert("i1", { name: "Updated" });
    assert.equal(repo.findOne("i1")!.name, "Updated");
    repo.upsert("i2", { id: "i2", name: "New", count: 0 });
    assert.equal(repo.findOne("i2")!.name, "New");
  });

  it("should handle complex data (JSON serialization)", () => {
    const complexModel: ReadModelDefinition = {
      config: {
        table: "complex",
        key: "id",
        schema: { id: "TEXT PRIMARY KEY", data: "TEXT" },
      },
      handler(repo, event) {
        if (event.type === "Complex") repo.create({ id: event.data.id, data: event.data.payload });
      },
    };
    const cRepo = builder.register(complexModel);
    const store = new EventStore(":memory:");
    builder.subscribeTo(store);
    store.appendToStream("s-1", [{ type: "Complex", data: { id: "c1", payload: { nested: [1, 2] } } }], 0);
    const item = cRepo.findOne("c1");
    assert.deepEqual(item!.data, { nested: [1, 2] });
  });
});
