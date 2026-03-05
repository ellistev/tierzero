/**
 * Command Handler - loads aggregate from event store, hydrates, executes, saves.
 * Optimistic concurrency with retry.
 */
import type { Aggregate, ClassWithMeta } from "./aggregate";
import type { EventStore } from "./event-store";
import type { EventFactory } from "./interfaces";
import { getTypeName } from "./utils";

export interface CommandHandlerOptions {
  maxRetries?: number;
}

export function createCommandHandler(eventStore: EventStore, eventFactory: EventFactory, options?: CommandHandlerOptions) {
  const maxRetries = options?.maxRetries ?? 3;

  return function commandHandler<TState extends Record<string, unknown>, TCommand>(
    AggregateClass: { new (): Aggregate<TState>; type: string },
    aggregateId: string,
    command: TCommand
  ): void {
    const streamId = `${AggregateClass.type}-${aggregateId}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const storedEvents = eventStore.read(streamId);
      const aggregate = new AggregateClass();

      // Hydrate from stored events
      for (const stored of storedEvents) {
        const domainEvent = eventFactory(stored.type, stored.data);
        aggregate.hydrate(domainEvent);
      }

      // Execute command
      const newEvents = aggregate.execute(command) as unknown[];
      if (!newEvents || newEvents.length === 0) return;

      // Save new events
      const eventsToStore = newEvents.map((e) => ({
        type: getTypeName(e),
        data: e as Record<string, unknown>,
      }));

      const expectedVersion = storedEvents.length > 0
        ? storedEvents[storedEvents.length - 1].version
        : 0;

      try {
        eventStore.appendToStream(streamId, eventsToStore, expectedVersion);
        return; // Success
      } catch (err: unknown) {
        if ((err as Error).name === "ConcurrencyError" && attempt < maxRetries) {
          continue; // Retry
        }
        throw err;
      }
    }
  };
}
