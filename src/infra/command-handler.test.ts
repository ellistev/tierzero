import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Aggregate } from "./aggregate";
import { EventStore } from "./event-store";
import { createCommandHandler } from "./command-handler";

class AddItem {
  static type = "AddItem";
  constructor(public readonly name: string) {}
}

class ItemAdded {
  static type = "ItemAdded";
  constructor(public readonly name: string) {}
  static fromObject(d: Record<string, unknown>) { return new ItemAdded(d.name as string); }
}

interface ListState extends Record<string, unknown> {
  items: string[];
}

class ItemList extends Aggregate<ListState> {
  static type = "ItemList";
  constructor() {
    super();
    this._registerCommandHandler(AddItem, (state, cmd) => {
      if ((state.items || []).includes(cmd.name)) throw new Error("Duplicate item");
      return [new ItemAdded(cmd.name)];
    });
    this._registerEventHandler(ItemAdded, (state, e) => ({
      ...state,
      items: [...(state.items || []), e.name],
    }));
  }
}

const eventFactory = (type: string, data: Record<string, unknown>) => {
  if (type === "ItemAdded") return ItemAdded.fromObject(data);
  throw new Error(`Unknown event type: ${type}`);
};

describe("CommandHandler", () => {
  let store: EventStore;
  let handler: ReturnType<typeof createCommandHandler>;

  beforeEach(() => {
    store = new EventStore(":memory:");
    handler = createCommandHandler(store, eventFactory);
  });

  it("should execute command and persist events", () => {
    handler(ItemList, "list-1", new AddItem("apple"));
    const events = store.read("ItemList-list-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "ItemAdded");
    assert.equal(events[0].data.name, "apple");
  });

  it("should hydrate aggregate from stored events", () => {
    handler(ItemList, "list-1", new AddItem("apple"));
    handler(ItemList, "list-1", new AddItem("banana"));
    const events = store.read("ItemList-list-1");
    assert.equal(events.length, 2);
  });

  it("should enforce business rules after hydration", () => {
    handler(ItemList, "list-1", new AddItem("apple"));
    assert.throws(
      () => handler(ItemList, "list-1", new AddItem("apple")),
      /Duplicate item/
    );
  });

  it("should isolate different aggregate instances", () => {
    handler(ItemList, "list-1", new AddItem("apple"));
    handler(ItemList, "list-2", new AddItem("apple")); // Same item, different aggregate - OK
    assert.equal(store.read("ItemList-list-1").length, 1);
    assert.equal(store.read("ItemList-list-2").length, 1);
  });

  it("should use correct stream naming", () => {
    handler(ItemList, "abc-123", new AddItem("x"));
    const events = store.read("ItemList-abc-123");
    assert.equal(events.length, 1);
  });
});
