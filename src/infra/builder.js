/* global BigInt */
import {EventEmitter} from './runtime/events.js';
import Long from "long";
import Batcher from "./Batcher.js";
import { hrTimeDiff } from './utils/time.js';

/**
 * @class BuilderEventData
 * @property {string} streamId
 * @property {string} eventId
 * @property {string} typeId
 * @property {number} eventNumber
 * @property {object} event
 * @property {object} metadata
 * @property {number} creationTime
 * @property {EventStorePosition} position
 */
class BuilderEventData {
  /**
   * @param {string} streamId
   * @param {string} eventId
   * @param {number} eventNumber
   * @param {string} typeId
   * @param {object} event
   * @param {object} metadata
   * @param {number} creationTime
   * @param {EventStorePosition} position
   */
  constructor(streamId, eventId, eventNumber, typeId, event, metadata, creationTime, position) {
    this.streamId = streamId;
    this.eventId = eventId;
    this.eventNumber = eventNumber;
    this.typeId = typeId;
    this.event = event;
    this.metadata = metadata;
    this.creationTime = creationTime;
    this.position = position;
  }
}

/**
 * @callback TransactionalRepositoryFactory
 * @param {string} modelName
 * @param {Batcher} batcher
 * @return {TransactionalRepository}
 */

/**
 * @class
 */
class Builder extends EventEmitter {
  constructor(dbPool, eventStore, readRepository, transactionalRepositoryFactory, prefix, logger, config, metrics) {
    super();
    this._metrics = metrics;
    this._dbPool = dbPool;
    this._eventStore = eventStore;
    this._readRepository = readRepository;
    this._transactionalRepositoryFactory = transactionalRepositoryFactory;
    this._prefix = prefix;
    this._logger = logger;
    this._config = config;
    this._verboseLogging = (process.env.VERBOSE ?? '').split(' ').includes('builder');
    const eventDesc = esData => `${esData.eventType}:${esData.eventNumber}@${esData.streamId}`;
    const trace = this._verboseLogging ?
      (fn, log) => async(...args) => {
        const start = Date.now();
        const res = await fn(...args);
        const et = Date.now() - start;
        et && logger.debug(log(et, args));
        return res;
      } : fn => fn;
    if (this._config.builder && this._config.builder.runInParallel) {
      this.processEvent = trace(this._processEventParallel.bind(this), (et, args) => `builder processEvent mode=parallel ev=${eventDesc(args[1])} et=${et}.`);
      this._transactionalRepositoryFactory = (m, b) => transactionalRepositoryFactory(m, b, readRepository);
    } else {
      this.processEvent = trace(this._processEventSerial.bind(this), (et, args) => `builder processEvent mode=serial ev=${eventDesc(args[1])} et=${et}.`);
    }
    this._processEventForReadModel = trace(this._processEventForReadModel.bind(this), (et, args) => `builder processEventForReadModel rm=${args[1].name} ev=${eventDesc(args[2])} et=${et}.`);
  }

  async _processEventForReadModel(batcher, readModel, esData) {
    const start = Date.now();
    const before = batcher.changes;
    let phase = 'setup';
    try {
      const eventData = this.toEventData(esData);
      eventData.typeId = this.getLocalEventType(eventData.typeId);
      const repository = this._transactionalRepositoryFactory(readModel.name, batcher);
      const lookups = {};
      for (const k in readModel.lookups) {
        lookups[k] = this._transactionalRepositoryFactory(`${readModel.name}_${k}_lookup`, batcher);
      }
      phase = 'handler';
      await readModel.handler(repository, eventData, lookups, this._config);
      phase = 'commit';
    } catch (err) {
      //this will only catch read errors as writes are batched and written later
      this._logger.error(`readModel handler failed in ${phase} (readModel=${readModel.name}`,
        `eventType=${esData.eventType}`,
        `logPos=${esData.eventNumber}@${esData.streamId}\n`,
        err.stack);
      this.emit('handlerError', {
        readModel: readModel.name,
        eventData: esData,
        error: err
      });
    }
    const et = Date.now() - start;
    const changes = batcher.changes - before;
    if (changes) {
      this._metrics.capture(`builder.process_event_${readModel.name}`, et);
    }
  }

  async _processEventParallel(readModels, esData) {
    if (esData.streamId[0] === '$') {
      return;
    }
    this._logger.debug(`Processing event ${esData.eventType} ${esData.eventNumber}@${esData.streamId}...`);
    let batcher, conn;
    try {
      conn = await this._dbPool.getConnection();
      batcher = new Batcher(conn);
      await batcher.begin();
      const promises = [];
      for (const readModel of readModels) {
        //promises.push(processEventForReadModel(builder, esData, prefix, batcher, transactionalRepositoryFactory, logger, readModel, config));
        //const conn = await this._dbPool.getConnection();
        //const readRepository = new ReadRepository();
        //const transactionalRepositoryFactory = (modelName, batcher) => this._transactionalRepositoryFactory(modelName, batcher, readRepository);
        promises.push(this._processEventForReadModel(batcher, readModel, esData));
      }
      await Promise.allSettled(promises);
      await batcher.end();
    } catch (error) {
      this._logger.error('Builder.processEvent failed:', error.stack);
      //builder.emit('handlerError');
    } finally {
      batcher && await batcher.dispose();
      conn && await this._dbPool.release(conn);
    }
    this.emit('eventProcessed', esData);
  }

  /**
   * Process an event for a set of readModels
   * @param {ReadModel[]} readModels
   * @param {EventStoredData} esData
   * @return {Promise<void>}
   */
  async _processEventSerial(readModels, esData) {
    if (esData.streamId[0] === '$') {
      return;
    }
    const { createdEpoch, metadata } = esData;
    const { timestamp = createdEpoch } = metadata ?? {};
    const start = process.hrtime();
    this._metrics.capture('events_latency.controller_to_process_time', Date.now() - timestamp);
    this._metrics.capture('events_latency.saved_to_process_time', Date.now() - createdEpoch);
    this._logger.debug(`Processing event ${esData.eventType} ${esData.eventNumber}@${esData.streamId}...`);
    let batcher, conn;
    try {
      conn = await this._dbPool.getConnection();
      batcher = new Batcher(conn);
      await batcher.begin();
      //const promises = [];
      for (const readModel of readModels) {
        //promises.push(processEventForReadModel(builder, esData, prefix, batcher, transactionalRepositoryFactory, logger, readModel, config));
        await this._processEventForReadModel(batcher, readModel, esData);
      }
      //await Promise.all(promises);
      await batcher.end();
    } catch (error) {
      this._logger.error('Builder.processEvent failed for', `${esData.eventNumber}@${esData.streamId}`, ':', error.stack, error.sql);
      //builder.emit('handlerError');
    } finally {
      batcher && await batcher.dispose();
      conn && await this._dbPool.release(conn);
    }
    this.emit('eventProcessed', esData);
    if (batcher?.changes) {
      this._metrics.capture('events_latency.controller_to_commit_time', Date.now() - timestamp);
      this._metrics.capture('events_latency.saved_to_commit_time', Date.now() - createdEpoch);
    }
    const et = hrTimeDiff(start);
    this._metrics.capture('builder.process_and_commit_time', et);
  }

  /**
   * Rebuild a set of readModels from a stream
   * @param {string} streamName
   * @param {ReadModel[]} readModels
   * @param {number} fromEventNumber
   * @return {Promise<Long>} nextEventNumber
   */
  async rebuildFromStream(streamName, readModels, fromEventNumber) {
    const batchSize = 50;
    let eventNumber = Long.fromValue(fromEventNumber || 0), readResult;
    do {
      readResult = await this._eventStore.readBatch(streamName, eventNumber, batchSize);
      eventNumber = readResult.nextEventNumber;
      for (const esData of readResult.events) {
        await this.processEvent(readModels, esData);
      }
    } while (!readResult.isEndOfStream);
    return eventNumber;
  }

  /**
   * Rebuild a set of readModels from $all
   * @param {ReadModel[]} readModels
   * @param {EventStorePosition} fromPosition
   * @return {Promise<EventStorePosition>} nextPosition
   */
  async rebuildFromAllStream(readModels, fromPosition) {
    const batchSize = 50;
    let position = fromPosition || null, readResult;
    do {
      readResult = await this._eventStore.readAllBatch(position, batchSize);
      position = readResult.nextPosition;
      for (const esData of readResult.events) {
        await this.processEvent(readModels, esData);
      }
    } while (!readResult.isEndOfStream);
    return position;
  }

  /**
   * Convert stored eventData to builder eventData
   * @param {EventStoredData} esData
   * @return {BuilderEventData}
   */
  toEventData(esData) {
    const {
      position,
      eventId,
      createdEpoch,
      eventType,
      data,
      metadata,
      streamId,
      eventNumber,
    } = esData;
    return new BuilderEventData(
      streamId,
      eventId,
      eventNumber,
      eventType,
      data,
      metadata,
      createdEpoch,
      position
    );
  }

  /**
   * Convert stored eventType to local eventType (removing prefix) if needed
   * @param {string} esEventType
   * @return {string}
   */
  getLocalEventType(esEventType) {
    if (!this._prefix) {
      return esEventType;
    }
    if (esEventType.indexOf(this._prefix) === 0) {
      return esEventType.substr(this._prefix.length);
    }
    return esEventType;
  }

  observe(readModelName, callback) {
    // in process observer of read model builder triggers once event is process locally
    this.on('eventProcessed', function(esData) {
      const revision = BigInt(esData.position.toString());
      callback({ revision, event: esData, changes: [] });
    });
  }
}

/**
 * Builder Factory
 * @param {object} services
 * @param {EventStore} eventStore
 * @returns {Builder}
 */
export function factory(services, eventStore) {
  const {dbPool, readRepository, transactionalRepositoryFactory, logger, config, metrics} = services;
  const prefix = '';
  return new Builder(dbPool, eventStore, readRepository, transactionalRepositoryFactory, prefix, logger, config, metrics);
}

export default factory;
