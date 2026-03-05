import ModelDefinition from "./ModelDefinition.js";
import {toEventData} from "./builder.js";
import Batcher from "./Batcher.js";

export default async function factory(
  {name, streamName, lookups, handler, version},
  {dbPool, transactionalRepositoryFactory, subscriberFactory, checkPointStoreFactory, mapper, logger, eventStoreWithConversion}
) {
  let startFromPosition = null;
  let started = false;
  let streamExpectedVersion = -1;
  const checkpointStore = checkPointStoreFactory(name);
  const startFromCheckpoint = await readCheckpoint();
  if (startFromCheckpoint.version === version) {
    startFromPosition = startFromCheckpoint.position;
    streamExpectedVersion = startFromCheckpoint.streamExpectedVersion;
  }
  await bootstrapLookups(startFromCheckpoint.version, version);
  const subscriber = bootstrapSubscriber();
  return {start, subscriber};

  function start() {
    if (started) {
      throw new Error(`Translator ${name} already started`);
    }
    started = true;
    return subscriber.startFrom(startFromPosition);
  }

  async function readCheckpoint() {
    const raw = await checkpointStore.get();
    if (!raw || typeof raw.position !== 'object') {
      return {
        position: null,
        version: 0,
        streamExpectedVersion: -1
      };
    }
    return raw;
  }

  function writeCheckpoint(position) {
    return checkpointStore.put({
      position,
      version,
      streamExpectedVersion
    });
  }

  async function bootstrapLookups(oldVersion, newVersion) {
    const rebuild = oldVersion !== newVersion;
    for (const k in lookups) {
      const lookup = {name: `${name}_${k}`, version: newVersion, config: lookups[k]};
      mapper.addModel(ModelDefinition.fromLookup(lookup, true));
      if (rebuild) await mapper.tryDropModel(dbPool, lookup.name, oldVersion);
      await mapper.tryCreateModel(dbPool, lookup.name, lookup.newVersion);
    }
  }

  function bootstrapSubscriber() {
    const subscriber = subscriberFactory('translators', eventStoreWithConversion, writeCheckpoint);
    subscriber.addHandler(eventHandler);
    return subscriber;
  }

  async function eventHandler(esData) {
    let conn, batcher;
    try {
      const eventData = toEventData(esData);
      conn = await dbPool.getConnection();
      batcher = new Batcher(conn);
      const curLookups = {};
      for (const k in lookups) {
        curLookups[k] = transactionalRepositoryFactory(`${name}_${k}`, batcher);
      }
      await batcher.begin();
      const events = await handler(eventData, curLookups);
      if (events.length) {
        const metadata = {
          $causationId: eventData.eventId,
          timestamp: new Date().getTime()
        };
        const eventIdGenerator = eventIdGeneratorFactory(eventData.eventId, streamExpectedVersion + 1);
        try {
          await eventStoreWithConversion.save(streamName, events, streamExpectedVersion, metadata, null, {eventIdGenerator});
        } catch (err) {
          logger.error(`Translator ${name} failed to save events:`, err);
        }
        streamExpectedVersion += events.length;
      }
      await batcher.end();
    } catch (err) {
      logger.error(`Translator ${name} failed:`, err);
    } finally {
      if (batcher) await batcher.dispose();
      if (conn) await dbPool.release(conn);
    }
  }
}

function eventIdGeneratorFactory(eventId, seed) {
  return function(ev, i) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(seed + i, 0);
    return buf.toString('hex') + eventId.substr(8);
  };
}
