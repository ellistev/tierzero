import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore - JS module
import websql from "websql";
// @ts-ignore - JS module
import WebSqlEventStore from "./websqles/EventStoreImpl.js";
// @ts-ignore - JS module
import commandHandlerFactory from "./commandHandler.js";
// @ts-ignore - JS module
import defaultEventFactory from "./defaultEventFactory.js";
// @ts-ignore - JS module
import NullAggregateCache from "./in-process/NullAggregateCache.js";
// @ts-ignore - JS module
import NullSnapshotStore from "./in-process/NullSnapshotStore.js";
// @ts-ignore - JS module
import NullMetrics from "./metrics/NullMetrics.js";
import { Aggregate } from "./aggregate";

// Test domain
class AddItem {
  static type = "AddItem";
  constructor(public readonly name: string) {}
}

class ItemAdded {
  static type = "ItemAdded";
  constructor(public readonly name: string) {}
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

function createInfra() {
  function openDatabase(name: string, ver: string, arg3: string, arg4: number) {
    return websql(":memory:", ver, arg3, arg4);
  }
  const logger = { debug: () => {}, info: () => {}, warn: (...a: any[]) => {}, error: () => {} };
  const eventStore = new WebSqlEventStore(logger, 100, { openDatabase });
  const eventFactory = defaultEventFactory({ ItemAdded });
  const config = {};
  const commandHandler = commandHandlerFactory(config, eventFactory, eventStore, new NullAggregateCache(), new NullSnapshotStore(), logger, new NullMetrics());
  return { eventStore, commandHandler };
}

describe("CommandHandler (checkonmom infra)", () => {
  let eventStore: any;
  let commandHandler: any;

  beforeEach(() => {
    const infra = createInfra();
    eventStore = infra.eventStore;
    commandHandler = infra.commandHandler;
  });

  it("should execute command and persist events", async () => {
    await commandHandler(ItemList, "list-1", new AddItem("apple"));
    const events = await eventStore.read("ItemList-list-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].data.name, "apple");
  });

  it("should hydrate aggregate from stored events", async () => {
    await commandHandler(ItemList, "list-1", new AddItem("apple"));
    await commandHandler(ItemList, "list-1", new AddItem("banana"));
    const events = await eventStore.read("ItemList-list-1");
    assert.equal(events.length, 2);
  });

  it("should enforce business rules after hydration", async () => {
    await commandHandler(ItemList, "list-1", new AddItem("apple"));
    await assert.rejects(
      () => commandHandler(ItemList, "list-1", new AddItem("apple")),
      /Duplicate item/
    );
  });

  it("should isolate different aggregate instances", async () => {
    await commandHandler(ItemList, "list-1", new AddItem("apple"));
    await commandHandler(ItemList, "list-2", new AddItem("apple"));
    const e1 = await eventStore.read("ItemList-list-1");
    const e2 = await eventStore.read("ItemList-list-2");
    assert.equal(e1.length, 1);
    assert.equal(e2.length, 1);
  });

  it("should use correct stream naming", async () => {
    await commandHandler(ItemList, "abc-123", new AddItem("x"));
    const events = await eventStore.read("ItemList-abc-123");
    assert.equal(events.length, 1);
  });

  it("should return committed events in result", async () => {
    const result = await commandHandler(ItemList, "list-1", new AddItem("apple"));
    assert.equal(result.committedEvents.length, 1);
    assert.equal(result.streamId, "ItemList-list-1");
  });
});
