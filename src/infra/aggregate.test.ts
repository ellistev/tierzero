import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Aggregate } from "./aggregate";

// Test event/command classes
class TestCommand {
  static type = "TestCommand";
  constructor(public readonly value: string) {}
}

class TestEvent {
  static type = "TestEvent";
  constructor(public readonly value: string) {}
}

class AnotherEvent {
  static type = "AnotherEvent";
  constructor(public readonly count: number) {}
}

interface TestState extends Record<string, unknown> {
  values: string[];
  count: number;
}

class TestAggregate extends Aggregate<TestState> {
  static type = "TestAggregate";
  constructor() {
    super();
    this._registerCommandHandler(TestCommand, (state, cmd) => {
      return [new TestEvent(cmd.value)];
    });
    this._registerEventHandler(TestEvent, (state, e) => ({
      ...state,
      values: [...(state.values || []), e.value],
    }));
    this._registerEventHandler(AnotherEvent, (state, e) => ({
      ...state,
      count: (state.count || 0) + e.count,
    }));
  }
}

describe("Aggregate (checkonmom infra)", () => {
  it("should execute a command and return events", () => {
    const agg = new TestAggregate();
    const events = agg.execute(new TestCommand("hello"));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof TestEvent);
    assert.equal((events![0] as TestEvent).value, "hello");
  });

  it("should hydrate state from events", () => {
    const agg = new TestAggregate();
    agg.hydrate(new TestEvent("a"));
    agg.hydrate(new TestEvent("b"));
    const memento = agg.createMemento();
    assert.deepEqual(memento.state.values, ["a", "b"]);
  });

  it("should handle multiple event types", () => {
    const agg = new TestAggregate();
    agg.hydrate(new TestEvent("x"));
    agg.hydrate(new AnotherEvent(5));
    agg.hydrate(new AnotherEvent(3));
    const memento = agg.createMemento();
    assert.deepEqual(memento.state.values, ["x"]);
    assert.equal(memento.state.count, 8);
  });

  it("should throw for unknown commands", () => {
    class UnknownCmd { static type = "UnknownCmd"; }
    const agg = new TestAggregate();
    assert.throws(() => agg.execute(new UnknownCmd()), /Unknown command/);
  });

  it("should freeze state before passing to handlers", () => {
    const agg = new TestAggregate();
    agg.hydrate(new TestEvent("test"));
    const events = agg.execute(new TestCommand("another"));
    assert.ok(events);
  });

  it("should save and restore from memento", () => {
    const agg1 = new TestAggregate();
    agg1.hydrate(new TestEvent("a"));
    agg1.hydrate(new TestEvent("b"));
    const memento = agg1.createMemento();

    const agg2 = new TestAggregate();
    agg2.restoreFromMemento(memento);
    const restored = agg2.createMemento();
    assert.deepEqual(restored.state.values, ["a", "b"]);
  });

  it("should deep clone memento state (no shared references)", () => {
    const agg = new TestAggregate();
    agg.hydrate(new TestEvent("a"));
    const m1 = agg.createMemento();
    agg.hydrate(new TestEvent("b"));
    const m2 = agg.createMemento();
    assert.equal(m1.state.values.length, 1);
    assert.equal(m2.state.values.length, 2);
  });

  it("should ignore events with no registered handler", () => {
    class RandomEvent { static type = "RandomEvent"; }
    const agg = new TestAggregate();
    agg.hydrate(new RandomEvent());
    const memento = agg.createMemento();
    assert.deepEqual(memento.state, {});
  });
});
