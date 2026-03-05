import EventStore from "./EventStore.js";

class EventStoreWithConversionWrapper extends EventStore {
  /**
   * @param {EventStore} inner
   * @param {function} converter
   */
  constructor(inner, converter) {
    super();
    this._inner = inner;
    this._converter = converter;
    this.EXPECT_ANY = inner.EXPECT_ANY;
    this.EXPECT_EMPTY = inner.EXPECT_EMPTY;
    this.START_POSITION = inner.START_POSITION;
    this.END_POSITION = inner.END_POSITION;
  }

  async read(streamName, start, credentials) {
    const result = await this._inner.read(streamName, start, credentials);
    return result.map(this._converter);
  }

  async readBatch(streamName, start, count, credentials) {
    const {isEndOfStream, nextEventNumber, events} = await this._inner.readBatch(streamName, start, count, credentials);
    return {
      isEndOfStream,
      nextEventNumber,
      events: events.map(this._converter)
    };
  }

  async readAllBatch(position, count, credentials) {
    const {isEndOfStream, nextPosition, events} = await this._inner.readAllBatch(position, count, credentials);
    return {
      isEndOfStream,
      nextPosition,
      events: events.map(this._converter)
    };
  }

  save(streamId, events, expectedVersion, metadata, options) {
    return this._inner.save(streamId, events, expectedVersion, metadata, options);
  }

  save_v2(streamId, events, expectedVersion, metadata, options) {
    return this._inner.save_v2(streamId, events, expectedVersion, metadata, options);
  }

  createPosition(pos) {
    return this._inner.createPosition(pos);
  }

  subscribeToAllFrom(lastCheckPoint, onEventAppeared, liveProcessingStarted, subscriptionDropped, options) {
    const _onEventAppeared = esData => onEventAppeared(this._converter(esData));
    return this._inner.subscribeToAllFrom(lastCheckPoint, _onEventAppeared, liveProcessingStarted, subscriptionDropped, options);
  }

  lastPosition() {
    return this._inner.lastPosition();
  }
}

export default EventStoreWithConversionWrapper;
