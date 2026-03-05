/**
 * @implements IAggregateCache
 */
export default class InMemoryAggregateCache {
  _cache = new Map();

  async get(streamId) {
    return this._cache.get(streamId) ?? null;
  }

  async set(cachedAggregate) {
    this._cache.set(cachedAggregate.streamId, cachedAggregate);
  }
}
