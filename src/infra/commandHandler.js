import {v4 as uuidV4} from "uuid";
import {Snapshot} from "./snapshot.js";
import {CachedAggregate} from "./aggregateCache.js";
import { delay, merge } from './utils/index.js';
import ProcessingQueue from './ProcessingQueue.js';

class InvalidAggregateIdError extends Error {
  constructor(message = "Invalid aggregateId, must be a non-empty string.") {
    super();
    Error.captureStackTrace(this, InvalidAggregateIdError);
    this.name = InvalidAggregateIdError.name;
    this.message = message;
  }
}

const DEFAULT_SNAPSHOT_THRESHOLD = 1024;
const DEFAULT_BATCH_SIZE = 512;
const DEFAULT_RETRY_ATTEMPTS = 10;
const DEFAULT_BACK_OFF_DELAYS_MS = [0, 0, 10, 10, 20, 20, 30, 30, 50, 50, 75, 75];

/**
 * @param {object} config
 * @param {eventFactory} eventFactory
 * @param {EventStore} eventStore
 * @param {IAggregateCache} aggregateCache
 * @param {ISnapshotStore} snapshotStore
 * @param {ILogger} logger
 * @param {IMetrics} metrics
 * @return {commandHandler}
 */
export default function factory(config, eventFactory, eventStore, aggregateCache, snapshotStore, logger, metrics) {
  const commandHandlerCfg = config.commandHandler || {};
  const snapshotThreshold = commandHandlerCfg.snapshotThreshold || DEFAULT_SNAPSHOT_THRESHOLD;
  const readBatchSize = commandHandlerCfg.readBatchSize || DEFAULT_BATCH_SIZE;
  const queues = new Map();

  const readStreamFrom = async(streamName, start) => {
    let events = [];
    let isEndOfStream = false;
    let next = start;
    while (!isEndOfStream) {
      const readResult = await eventStore.readBatch(streamName, next, readBatchSize);
      next = readResult.nextEventNumber;
      isEndOfStream = readResult.isEndOfStream;
      events = events.concat(readResult.events);
    }
    return {
      events,
      expectedVersion: Math.max(next - 1, -1)
    };
  };

  const loadAggregateAndEvents = async(streamId, TAggregate, expectedVersion) => {
    const cached = await aggregateCache.get(streamId);
    if (cached && cached.streamRevision > expectedVersion) {
      return {
        aggregate: cached.aggregate,
        expectedVersion: cached.streamRevision,
        lastSnapshotVersion: cached.lastSnapshotRevision,
        events: [],
      };
    }

    const snapshot = await snapshotStore.get(streamId);
    let streamRevision, aggregate, lastSnapshotVersion;
    if (snapshot && snapshot.streamRevision > (cached?.streamRevision ?? -1)) {
      //TODO handle versioning of snapshot
      streamRevision = snapshot.streamRevision;
      lastSnapshotVersion = snapshot.streamRevision;
      aggregate = new TAggregate();
      aggregate.restoreFromMemento(snapshot.memento);
    } else if (cached) {
      streamRevision = cached.streamRevision;
      lastSnapshotVersion = cached.lastSnapshotRevision;
      aggregate = cached.aggregate;
    } else {
      streamRevision = -1;
      lastSnapshotVersion = -1;
      aggregate = new TAggregate();
    }
    const readResult = await readStreamFrom(streamId, streamRevision + 1);
    return {
      aggregate,
      expectedVersion: readResult.expectedVersion,
      lastSnapshotVersion,
      events: readResult.events,
    };
  };

  const saveAggregateAndEvents = async(streamId, aggregate, expectedVersion, lastSnapshotVersion, uncommittedEvents, metadata, options) => {
    if (!uncommittedEvents.length) {
      const cached = await aggregateCache.get(streamId);
      if (!cached && expectedVersion >= 0) {
        await aggregateCache.set(new CachedAggregate(streamId, expectedVersion, lastSnapshotVersion, aggregate));
      }
      return [];
    }
    const [nextExpectedVersion, logPosition] = await eventStore.save_v2(streamId, uncommittedEvents, expectedVersion, metadata);
    try {
      for (const event of uncommittedEvents) {
        aggregate.hydrate(event);
      }
      if ((nextExpectedVersion - lastSnapshotVersion) >= snapshotThreshold) {
        await snapshotStore.add(new Snapshot(streamId, nextExpectedVersion, aggregate.createMemento()));
        lastSnapshotVersion = nextExpectedVersion;
      }
      await aggregateCache.set(new CachedAggregate(streamId, nextExpectedVersion, lastSnapshotVersion, aggregate));
    } catch (e) {
      logger.warn(e.stack);
    }
    return [nextExpectedVersion, logPosition];
  };

  const processOneOff = async(TAggregate, aggregateId, command, metadata, options) => {
    const streamId = `${TAggregate.type}-${aggregateId}`;

    const defaultMetadata = {
      timestamp: Date.now(),
      $correlationId: uuidV4()
    };
    const mergedMetadata = metadata ? merge(defaultMetadata, metadata) : defaultMetadata;

    const aggregate = new TAggregate();
    // execute
    const uncommittedEvents = await aggregate.execute(command);
    // save
    const expectedVersion = eventStore.EXPECT_EMPTY;
    const [nextExpectedVersion, logPosition] = await eventStore.save_v2(streamId, uncommittedEvents, expectedVersion, mergedMetadata);

    return {
      command,
      streamId,
      committedEvents: uncommittedEvents,
      metadata: mergedMetadata,
      nextExpectedVersion,
      logPosition,
    };
  };

  const processNextItem = async(TAggregate, aggregateId, command, metadata, options) => {
    const streamId = `${TAggregate.type}-${aggregateId}`;

    const defaultMetadata = {
      timestamp: Date.now(),
      $correlationId: uuidV4()
    };
    const mergedMetadata = metadata ? merge(defaultMetadata, metadata) : defaultMetadata;

    let uncommittedEvents, nextExpectedVersion, logPosition, error, expectedVersion = -1;
    for (let retryAttempt = 0; retryAttempt < DEFAULT_RETRY_ATTEMPTS; retryAttempt++) {
      error = null;
      const backOfMs = DEFAULT_BACK_OFF_DELAYS_MS[retryAttempt] ?? 100;
      if (backOfMs) {
        await delay(backOfMs);
      }
      try {
        // load
        const loadResult = await metrics.time(
          'command_handler.load_aggregate_and_events_time',
          () => loadAggregateAndEvents(streamId, TAggregate, expectedVersion)
        );
        const { aggregate, lastSnapshotVersion, events } = loadResult;
        expectedVersion = loadResult.expectedVersion;
        // hydrate
        for (const esData of events) {
          const ev = eventFactory(esData.eventType, esData.data);
          aggregate.hydrate(ev);
        }
        // execute
        uncommittedEvents = await aggregate.execute(command);
        // save
        [nextExpectedVersion, logPosition] = await metrics.time(
          'command_handler.save_aggregate_and_events_time',
          () => saveAggregateAndEvents(streamId, aggregate, expectedVersion, lastSnapshotVersion, uncommittedEvents, mergedMetadata, options)
        );
        break;
      } catch (err) {
        error = err;
        if (err.name !== 'WrongExpectedVersionError') {
          break;
        }
        //metrics.capture('eventstore_save_collision', 1);
        logger.warn('collision for', streamId);
      }
    }
    if (error) {
      throw error;
    }

    return {
      command,
      streamId,
      committedEvents: uncommittedEvents,
      metadata: mergedMetadata,
      nextExpectedVersion,
      logPosition,
    };
  };

  const commandHandler = async(TAggregate, aggregateId, command, metadata = {}, options = {}) => {
    if (typeof TAggregate !== 'function') throw new TypeError("TAggregate must be a function.");
    if (typeof command !== 'object' || command === null) throw new TypeError("command must be a non-null object.");
    if (typeof aggregateId !== 'string' || aggregateId === "") throw new InvalidAggregateIdError(`${TAggregate.type} aggregateId must be a non-empty string.`);
    if (typeof metadata !== 'object') throw new TypeError("metadata must be an object");
    if (typeof options !== 'object' || options === null) throw new TypeError("options must be an non-null object");

    if (metadata) {
      metadata.timestamp = metadata.timestamp ?? Date.now();
    }

    const streamId = `${TAggregate.type}-${aggregateId}`;
    let result;
    if (options.oneOff) {
      result = await processOneOff(TAggregate, aggregateId, command, metadata, options);
    } else {
      //TODO empty queue should be removed
      let q = queues.get(streamId);
      if (!q) {
        q = new ProcessingQueue(processNextItem);
        queues.set(streamId, q);
      }
      result = await q.append([TAggregate, aggregateId, command, metadata, options]);
    }
    return result;
  };

  const timedCommandHandler = (TAggregate, aggregateId, command, metadata, options) =>
    metrics.time('command_handler', () => commandHandler(TAggregate, aggregateId, command, metadata, options));

  return timedCommandHandler;
}
