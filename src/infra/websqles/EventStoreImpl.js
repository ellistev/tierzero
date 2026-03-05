import {v4 as uuid} from 'uuid';
import { noOp } from '../utils/index.js';
import EventData from './EventData.js';
import Subscription from './SubscriptionImpl.js';
import Position from './Position.js';
import {parse} from "uuid-parse";
import { EventEmitter } from "../runtime/events.js";
import WrongExpectedVersionError from "./WrongExpectedVersionError.js";

const EVENTSTORE_EMPTY = -1;

export const CREATE_SQLS = [
  'CREATE TABLE IF NOT EXISTS events (' +
  'position INTEGER PRIMARY KEY AUTOINCREMENT, ' +
  'eventId TEXT NOT NULL, ' +
  'eventType TEXT NOT NULL, ' +
  'streamId TEXT NOT NULL, ' +
  'eventNumber INTEGER NOT NULL, ' +
  'data TEXT NOT NULL, ' +
  'metadata TEXT NULL, ' +
  'createdEpoch INTEGER NOT NULL, ' +
  'UNIQUE(streamId, eventId), ' +
  'UNIQUE(streamId, eventNumber)' +
  ')',
  'CREATE INDEX IF NOT EXISTS events_streamId ON events (streamId)'
];
const DELETE_EVENT_SQL = 'DELETE FROM events WHERE streamId = :streamId AND eventId = :eventId';
const GET_STREAM_LAST_VERSION_SQL = 'SELECT MAX(eventNumber) AS lastVersion FROM events WHERE streamId = :streamId';
export const INSERT_EVENT_SQL = 'INSERT INTO events (eventId, eventType, streamId, eventNumber, data, metadata, createdEpoch) ' +
  'VALUES (:eventId, :eventType, :streamId, :eventNumber, :data, :metadata, :createdEpoch)';
const READ_ALL_SQL = 'SELECT * FROM events WHERE position >= :start LIMIT :limit';
const READ_STREAM_SQL = 'SELECT * FROM events WHERE streamId = :streamId AND eventNumber >= :start';
const GET_LAST_POSITION_SQL = 'SELECT MAX(position) AS lastPosition FROM events';

export function toInsertArgs(toSave) {
  const {eventId, eventType, streamId, eventNumber, data, metadata, createdEpoch} = toSave;
  return [eventId, eventType, streamId, eventNumber, data, metadata || null, createdEpoch];
}

function nonce(ev) {
  const n = new Uint8Array(24);
  parse(ev.eventId, n);
  return n;
}

function toJSON(data) {
  return data && JSON.stringify(data);
}

function fromJSON(json) {
  return json && JSON.parse(json);
}

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
  return uuidV4Regex.test(id);
}

/**
 * @class
 * @implements EventStore
 */
export default class WebSqlEventStore extends EventEmitter {
  EXPECT_ANY = -2;
  EXPECT_EMPTY = -1;
  START_POSITION = new Position(0);
  END_POSITION = new Position(-1);

  /**
   * @param {Logger} logger
   * @param {number} readBatchSize
   * @param {function(name:string,version:string,displayName:string,estimatedSize:number):Database} openDatabase
   * @param {function(message:string,nonce:string):string} [encrypt]
   * @param {function(box:string,nonce:string):string} [decrypt]
   * @param {function(cls:function):string} [getTypeName]
   */
  constructor(logger, readBatchSize, {openDatabase, encrypt, decrypt, getTypeName}) {
    super();
    this._logger = logger;
    this._db = openDatabase('events', '1.0', '', 0);
    this._created = false;
    this._encrypt = encrypt || ((msg, nonce) => msg);
    this._decrypt = decrypt || ((box, nonce) => box);
    this._getTypeName = getTypeName || (cls => cls.constructor.name);
    this._readBatchSize = readBatchSize;
  }

  /**
   * Save events in a stream
   * @returns {Promise<{position:Position,version:number,eventsToPublish:object[]}>}
   * @async
   */
  async _save(streamId, events, expectedVersion, metadata = null, options = null) {
    if (typeof streamId !== 'string') throw new TypeError('streamId must be a string');
    if (typeof expectedVersion !== 'number') throw new TypeError('expectedVersion must be a number');
    if (!Array.isArray(events)) throw new TypeError('events must be an array');
    if (metadata && typeof metadata !== 'object') throw new TypeError('metadata must be an object');
    if (events.length < 1) throw new Error('events must contain at least one event');
    if (expectedVersion < this.EXPECT_EMPTY) throw new Error('invalid value for expectedVersion');

    await this.ensureCreated();

    const eventsDatas = events.map(ev => ({eventId: uuid(), eventType: this._getTypeName(ev), data: ev, metadata}));
    const result = await this._appendToStream(streamId, eventsDatas, expectedVersion);
    if (result.eventsToPublish) {
      result.eventsToPublish.forEach(eventToPublish => this.emit('eventAppeared', eventToPublish));
    }
    return result;
  }

  /**
   * Save events in a stream
   * @returns {Promise<number>}
   * @async
   */
  async save(streamId, events, expectedVersion, metadata = null, options = null) {
    const res = await this._save(streamId, events, expectedVersion, metadata, options);
    return res.version;
  }

  /**
   * Save events in a stream
   * @returns {Promise<[number,Position]>}
   * @async
   */
  async save_v2(streamId, events, expectedVersion, metadata = null, options = null) {
    const res = await this._save(streamId, events, expectedVersion, metadata, options);
    return [res.version, res.position];
  }

  /**
   * Append an event to a stream
   * @async
   */
  async appendToStream(streamId, eventDatas, expectedVersion = this.EXPECT_ANY, options = {}) {
    if (typeof streamId !== 'string') throw new TypeError('streamId must be a string');
    eventDatas = Array.isArray(eventDatas) ? eventDatas : [eventDatas];
    if (!eventDatas.every(isValidEventData)) throw new TypeError("eventDatas must be an array of EventData");
    if (typeof expectedVersion !== 'number') throw new TypeError('expectedVersion must be a number');
    if (expectedVersion < this.EXPECT_ANY) throw new Error('invalid value for expectedVersion');

    await this.ensureCreated();
    const toSave = eventDatas.map(({eventType, eventId, data, metadata = null}) => {
      if (!isValidUuid(eventId)) throw new TypeError('eventId must be a uuid');
      return {eventType, eventId, data, metadata};
    });
    const result = await this._appendToStream(streamId, toSave, expectedVersion);
    if (result.eventsToPublish) {
      result.eventsToPublish.forEach(eventToPublish => this.emit('eventAppeared', eventToPublish));
    }
    return result.position;
  }

  /**
   * @param {EventStorePosition} fromPosition
   * @param {number} [count]
   * @param {object} [options]
   * @return {Promise<{isEndOfStream:boolean,nextPosition:EventStorePosition,events:EventStoredData[]}>}
   */
  async readAllBatch(fromPosition, count = this._readBatchSize, options = null) {
    if (!(fromPosition instanceof Position)) throw new TypeError('fromPosition must be a Position');
    if (typeof count !== 'number') throw new TypeError('count must be a number');

    await this.ensureCreated();

    const results = await this._doReadAll(fromPosition, count);
    const events = results
      .map(({position, data, metadata, ...rest}, i) => {
        const d = fromJSON(this._decrypt(data, nonce(rest)));
        const m = fromJSON(this._decrypt(metadata, nonce(rest)));
        return EventData.fromObject({
          ...rest,
          position: new Position(position),
          data: d,
          metadata: m
        });
      });
    return {
      isEndOfStream: events.length < count,
      nextPosition: events.length ? new Position(events[events.length - 1].position.value + 1) : fromPosition,
      events
    };
  }

  /**
   * Read a stream
   * @async
   */
  async read(streamId, start = 0, options = null) {
    if (typeof streamId !== 'string') throw new TypeError('streamId must be a string');
    if (typeof start !== 'number') throw new TypeError('start must be a number');

    await this.ensureCreated();

    const results = await this._doReadStream(streamId, start);
    return results.events
      .map(({position, data, metadata, ...rest}) => {
        const d = fromJSON(this._decrypt(data, nonce(rest)));
        const m = fromJSON(this._decrypt(metadata, nonce(rest)));
        return EventData.fromObject({
          ...rest,
          position: new Position(position),
          data: d,
          metadata: m
        });
      });
  }

  /**
   * @param {string} streamId
   * @param {number} start
   * @param {number} [count]
   * @param {object} [options]
   * @return {Promise<{isEndOfStream:boolean,nextEventNumber:number,events:EventStoredData[]}>}
   * @async
   */
  async readBatch(streamId, start, count = this._readBatchSize, options = null) {
    if (typeof streamId !== 'string') throw new TypeError('streamId must be a string');
    if (typeof start !== 'number') throw new TypeError('start must be a number');
    if (typeof count !== 'number') throw new TypeError('count must be a number');

    await this.ensureCreated();

    const result = await this._doReadStream(streamId, start, count);
    result.events = result.events
      .map(({position, data, metadata, ...rest}) => {
        const d = fromJSON(this._decrypt(data, nonce(rest)));
        const m = fromJSON(this._decrypt(metadata, nonce(rest)));
        return EventData.fromObject({
          ...rest,
          position: new Position(position),
          data: d,
          metadata: m
        });
      });
    return result;
  }

  /**
   * Subscribe to all from
   */
  subscribeToAllFrom(lastCheckPoint, eventAppeared, liveProcessingStarted, subscriptionDropped, options) {
    liveProcessingStarted = liveProcessingStarted || noOp;
    subscriptionDropped = subscriptionDropped || noOp;
    options = options || {};
    const position = (lastCheckPoint && this.createPosition(lastCheckPoint)) || this.createPosition(-1);
    const subscription = new Subscription(this, this._logger, position, eventAppeared, liveProcessingStarted, subscriptionDropped);
    subscription.start();
    return subscription;
  }

  /**
   * Subscribe to all from
   */
  subscribeToAll(eventAppeared, subscriptionDropped, options) {
    subscriptionDropped = subscriptionDropped || noOp;
    options = options || {};
    const subscription = new Subscription(this, this._logger, null, eventAppeared, null, subscriptionDropped);
    subscription.start();
    return subscription;
  }

  /**
   * Create a position from
   */
  createPosition(any) {
    if (typeof any === 'undefined' || any === null) {
      return this.START_POSITION;
    }
    if ((any instanceof Position) || (typeof any === 'object' && typeof any.value === 'number')) {
      return new Position(any.value);
    }
    if (typeof any === 'number') {
      return new Position(any);
    }
    throw new TypeError('invalid value for any');
  }

  async lastPosition() {
    await this.ensureCreated();
    return new Promise((resolve, reject) => {
      let lastPosition;
      this._db.readTransaction(trx => {
        trx.executeSql(GET_LAST_POSITION_SQL, [],
          (_, rs) => {
            const value = rs.rows.item(0).lastPosition;
            lastPosition = value === null ? new Position(0) : new Position(value);
          });
      }, reject, () => resolve(lastPosition));
    });
  }

  /**
   * @returns {Promise<void>}
   */
  ensureCreated() {
    return new Promise((resolve, reject) => {
      if (this._created) return resolve();
      this._db.transaction(trx => {
        for (const sql of CREATE_SQLS)
          trx.executeSql(sql);
      },
      reject,
      () => {
        this._created = true;
        resolve();
      });
    });
  }

  /**
   * @param {string} streamId
   * @param {object[]} eventDatas
   * @param {number} expectedVersion
   * @return {Promise<{position:Position,version:number,eventsToPublish:object[]}>}
   * @private
   */
  _appendToStream(streamId, eventDatas, expectedVersion) {
    return new Promise((resolve, reject) => {
      let expectDuplicate = false, allowDuplicate = false;
      const result = {
        position: new Position(-1),
        version: -1,
        eventsToPublish: [],
      };

      this._db.transaction((trx) => {
        trx.executeSql(GET_STREAM_LAST_VERSION_SQL, [streamId], (_, rs) => {
          const { lastVersion } = rs.rows.item(0);
          const currentVersion = lastVersion === null ? EVENTSTORE_EMPTY : lastVersion;
          let startFrom = expectedVersion;
          if (expectedVersion > currentVersion) {
            reject(new WrongExpectedVersionError(expectedVersion, currentVersion));
            return;
          } else if (expectedVersion === this.EXPECT_ANY) {
            allowDuplicate = true;
            startFrom = currentVersion;
          } else if (expectedVersion < currentVersion) {
            expectDuplicate = true;
            startFrom = currentVersion;
          }

          for (let i = 0; i < eventDatas.length; i++) {
            const eventData = eventDatas[i];
            const toSave = {
              ...eventData,
              streamId,
              eventNumber: startFrom + i + 1,
              data: this._encrypt(toJSON(eventData.data), nonce(eventData)),
              metadata: this._encrypt(toJSON(eventData.metadata), nonce(eventData)),
              createdEpoch: Date.now()
            };
            const insertArgs = toInsertArgs(toSave);
            trx.executeSql(INSERT_EVENT_SQL, insertArgs, (_, rs) => {
              if (expectDuplicate) {
                //the websql module doesn't respect the w3 standard so we can't throw here to cancel the transaction
                //throw new WrongExpectedVersionError(expectedVersion, currentVersion);
                trx.executeSql(DELETE_EVENT_SQL, [streamId, toSave.eventId]);
                return reject(new WrongExpectedVersionError(expectedVersion, currentVersion));
              }
              const position = new Position(rs.insertId);
              result.position = position;
              result.version = toSave.eventNumber;
              result.eventsToPublish.push(EventData.fromObject({
                ...eventData,
                streamId,
                eventNumber: toSave.eventNumber,
                position,
                createdEpoch: toSave.createdEpoch
              }));
            }, (_, err) => {
              expectDuplicate = true;
              return !((allowDuplicate || expectDuplicate) && isIdempotencyError(err));
            });
          }
        });
      }, reject, () => resolve(result));
    });
  }

  _doReadStream(streamId, start, count) {
    return new Promise((resolve, reject) => {
      const result = {
        isEndOfStream: true,
        nextEventNumber: -1,
        events: [],
      };
      this._db.readTransaction(trx => {
        const sql = READ_STREAM_SQL + (count ? ' LIMIT :count' : '');
        const args = [streamId, start];
        if (count) args.push(count);
        trx.executeSql(sql, args, (_, resultSet) => {
          if (resultSet.rows.length === 0) return;
          let lastEventNumber;
          for (let i = 0; i < resultSet.rows.length; i++) {
            const item = resultSet.rows.item(i);
            result.events.push({...item});
            result.nextEventNumber = item.eventNumber + 1;
            lastEventNumber = item.eventNumber;
          }
          trx.executeSql(GET_STREAM_LAST_VERSION_SQL, [streamId], (_, rs1) => {
            if (rs1.rows.length === 0) return;
            result.isEndOfStream = lastEventNumber === rs1.rows.item(0).lastVersion;
          });
        });
      },
      reject,
      () => resolve(result));
    });
  }

  _doReadAll(fromPosition, count) {
    return new Promise((resolve, reject) => {
      const results = [];
      this._db.readTransaction(trx => {
        trx.executeSql(READ_ALL_SQL, [fromPosition.value, count], (_, resultSet) => {
          for (let i = 0; i < resultSet.rows.length; i++) {
            const item = resultSet.rows.item(i);
            results.push({...item});
          }
        });
      },
      reject,
      () => resolve(results));
    });
  }
}

//Note: these are for the react-native-sqlite-2 implementation not the WebSQL implementation
function isIdempotencyError(error) {
  const errorMsg = typeof error === 'string' ? error : error.message;
  //if (!errorMsg.startsWith("UNIQUE")) return false;
  return errorMsg.includes("UNIQUE constraint failed: events.streamId, events.eventId");
}

function isValidEventData(eventData) {
  const {eventType, eventId, data, metadata = null} = eventData;
  return (typeof eventType === 'string' &&
    typeof eventId === 'string' &&
    typeof data === 'object' && data !== null &&
    typeof metadata === 'object');
}
