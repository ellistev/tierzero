/**
 * @implements IAggregateCache
 */
export default class NullAggregateCache {
  async get(streamId) {
    return null;
  }

  async set(cachedAggregate) {
    //do nothing
  }
}
