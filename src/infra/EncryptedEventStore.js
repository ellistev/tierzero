import EventStore from './EventStore.js';

export default class EncryptedEventStore extends EventStore {
  /**
   * @param {EventStore} inner
   * @param {function} encryptObject
   * @param {function} decryptObject
   * @param {function} generateIv
   */
  constructor(inner, {encryptObject, decryptObject, generateIv}) {
    super();
    this._inner = inner;
    this._encryptObject = encryptObject;
    this._decryptObject = decryptObject;
    this._generateIv = generateIv;
    this.EXPECT_ANY = inner.EXPECT_ANY;
    this.EXPECT_EMPTY = inner.EXPECT_EMPTY;
    this.START_POSITION = inner.START_POSITION;
    this.END_POSITION = inner.END_POSITION;
  }

  /**
   * @param {EventStoredData[]} eventStoredDatas
   * @return {Promise<EventStoredData[]>}
   * @private
   */
  async _decryptEventStoredDatas(eventStoredDatas) {
    const results = [];
    for (const eventStoredData of eventStoredDatas) {
      const { data, eventId, ...ctx } = eventStoredData;
      ctx.iv = Buffer.from(ctx.metadata?.iv ?? '', 'base64');
      results.push({
        ...eventStoredData,
        data: await this._decryptObject(ctx, data),
      });
    }
    return results;
  }

  async _encryptEvents(streamId, events, metadata) {
    const encryptedEvents = [];
    const iv = await this._generateIv();
    for (const event of events) {
      encryptedEvents.push(await this._encryptObject({ streamId, metadata, iv }, event));
    }
    return [encryptedEvents, iv];
  }

  async read(streamName, start, credentials) {
    const result = await this._inner.read(streamName, start, credentials);
    return await this._decryptEventStoredDatas(result);
  }

  async readBatch(streamName, start, count, credentials) {
    const {isEndOfStream, nextEventNumber, events} = await this._inner.readBatch(streamName, start, count, credentials);
    return {
      isEndOfStream,
      nextEventNumber,
      events: await this._decryptEventStoredDatas(events),
    };
  }

  async readAllBatch(position, count, credentials) {
    const {isEndOfStream, nextPosition, events} = await this._inner.readAllBatch(position, count, credentials);
    return {
      isEndOfStream,
      nextPosition,
      events: await this._decryptEventStoredDatas(events),
    };
  }

  async save(streamId, events, expectedVersion, metadata, options) {
    const [encryptedEvents, iv] = await this._encryptEvents(streamId, events, metadata);
    const newMetadata =  { ...(metadata ?? {}), iv: iv.toString('base64') };
    return await this._inner.save(streamId, encryptedEvents, expectedVersion, newMetadata, options);
  }

  async save_v2(streamId, events, expectedVersion, metadata, options) {
    const [encryptedEvents, iv] = await this._encryptEvents(streamId, events, metadata);
    const newMetadata =  { ...(metadata ?? {}), iv: iv.toString('base64') };
    return await this._inner.save_v2(streamId, encryptedEvents, expectedVersion, newMetadata, options);
  }

  async appendToStream(streamId, eventDatas, expectedVersion = this.EXPECT_ANY, options = {}) {
    const encrytedEventDatas = [];
    const iv = await this._generateIv();
    for (const eventData of eventDatas) {
      encrytedEventDatas.push({
        ...eventData,
        metadata: { ...(eventData.metadata ?? {}), iv: iv.toString('base64') },
        data: await this._encryptObject({ streamId, metadata: eventData.metadata, iv }, eventData.data),
      });
    }
    return await this._inner.appendToStream(streamId, encrytedEventDatas, expectedVersion, options);
  }

  createPosition(pos) {
    return this._inner.createPosition(pos);
  }

  subscribeToAllFrom(lastCheckPoint, onEventAppeared, liveProcessingStarted, subscriptionDropped, options) {
    const _onEventAppeared = async(esData) => {
      const { data, eventId, ...ctx } = esData;
      ctx.iv = Buffer.from(ctx.metadata?.iv ?? '', 'base64');
      const unencrypted = ctx.eventType.startsWith('$') ? data : await this._decryptObject(ctx, data);
      onEventAppeared({
        ...esData,
        data: unencrypted
      });
    };
    return this._inner.subscribeToAllFrom(lastCheckPoint, _onEventAppeared, liveProcessingStarted, subscriptionDropped, options);
  }

  lastPosition() {
    return this._inner.lastPosition();
  }
}
