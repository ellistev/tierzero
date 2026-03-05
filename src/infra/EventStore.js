/**
 * @interface
 */
export class EventStore {
  /**
   * @param {string} streamId
   * @param {number} [start]
   * @param {object} [options]
   * @returns {Promise<EventStoredData[]>}
   */
  read(streamId, start, options) {
    throw new Error("Not implemented");
  }

  /**
   * @param {string} streamId
   * @param {number} start
   * @param {number} [count]
   * @param {object} [options]
   * @return {Promise<{isEndOfStream:boolean,nextEventNumber:number,events:EventStoredData[]}>}
   */
  readBatch(streamId, start, count, options) {
    throw new Error("Not Implemented");
  }

  /**
   * @param {EventStorePosition} fromPosition
   * @param {number} [count]
   * @param {object} [options]
   * @return {Promise<{isEndOfStream:boolean,nextPosition:EventStorePosition,events:EventStoredData[]}>}
   */
  readAllBatch(fromPosition, count, options) {
    throw new Error("Not implemented");
  }

  /**
   * @param {string} streamId
   * @param {EventData|EventData[]} eventDatas
   * @param {number} [expectedVersion]
   * @param {object} [options]
   * @return {Promise<EventStorePosition>}
   */
  appendToStream(streamId, eventDatas, expectedVersion, options) {
    throw new Error("Not implemented");
  }

  /**
   * Save events to a stream at expectedVersion
   * Meant to be used by the commandHandler to save new events produced by an Aggregate, otherwise use appendToStream
   * @param {string} streamId
   * @param {object[]} events
   * @param {number} expectedVersion
   * @param {object} [metadata]
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  save(streamId, events, expectedVersion, metadata, options) {
    throw new Error("Not implemented");
  }

  /**
   * Save events to a stream at expectedVersion
   * Meant to be used by the commandHandler to save new events produced by an Aggregate, otherwise use appendToStream
   * @param {string} streamId
   * @param {object[]} events
   * @param {number} expectedVersion
   * @param {object} [metadata]
   * @param {object} [options]
   * @returns {Promise<[number, EventStorePosition]>}
   */
  save_v2(streamId, events, expectedVersion, metadata, options) {
    throw new Error("Not implemented");
  }

  /**
   * Create a position
   * Returns start position if no arguments
   * @param {Long|number|Position|object} [pos]
   * @returns {EventStorePosition}
   */
  createPosition(pos) {
    throw new Error("Not implemented");
  }

  /**
   * @param {EventStorePosition|null} lastCheckPoint
   * @param {EventStore~onEventAppeared} onEventAppeared
   * @param {EventStore~onLiveProcessingStarted} [liveProcessingStarted]
   * @param {EventStore~onSubscriptionDropped} [subscriptionDropped]
   * @param {object} [options]
   * @return {Subscription}
   */
  subscribeToAllFrom(lastCheckPoint, onEventAppeared, liveProcessingStarted, subscriptionDropped, options) {
    throw new Error("Not implemented");
  }

  /**
   * Get last position in the EventStore
   * @returns {Promise<EventStorePosition>}
   */
  lastPosition() {
    throw new Error("Not implemented");
  }

  /**
   * @type {number}
   */
  EXPECT_EMPTY;
  /**
   * @type {number}
   */
  EXPECT_ANY;
  /**
   * @type {EventStorePosition}
   */
  START_POSITION;
  /**
   * @type {EventStorePosition}
   */
  END_POSITION;
}

/**
 * @callback EventStore~onEventAppeared
 * @param {EventStoredData} event
 * @returns {Promise<void>|void}
 */

/**
 * @callback EventStore~onSubscriptionDropped
 * @param {EventStore} eventStore
 * @param {string} reason
 * @param {Error} error
 * @returns void
 */

/**
 * @callback EventStore~onLiveProcessingStarted
 * @returns void
 */

/**
 * @interface
 */
export class EventStorePosition {
  /**
   * @param {EventStorePosition} other
   * @returns {number}
   */
  compareTo(other) {
    throw new Error("Not implemented");
  }

  /**
   * @returns string
   */
  toString() {
    throw new Error("Not implemented");
  }

  /**
   * @returns number
   */
  distance(other) {
    throw new Error("Not implemented");
  }
}

/**
 * @interface
 * @property {!string} eventId
 * @property {!string} eventType
 * @property {!object} data
 * @property {object} metadata
 */
class EventData {}

/**
 * @interface
 * @property {EventStorePosition} position
 * @property {string} eventId
 * @property {string} streamId
 * @property {number} eventNumber
 * @property {string} eventType
 * @property {object} data
 * @property {object} metadata
 * @property {number} createdEpoch
 */
class EventStoredData {}

/**
 * @interface
 */
export class Subscription {
  stop() {
    throw new Error("Not implemented");
  }
}

export default EventStore;
