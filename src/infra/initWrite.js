import defaultCommandHandlerFactory from "./commandHandler.js";
import NullAggregateCache from "./in-process/NullAggregateCache.js";
import NullSnapshotStore from "./in-process/NullSnapshotStore.js";

/**
 * Initialize CQRS write side
 * @param {Object} services Services registry
 * @param {eventFactory} eventFactory
 * @returns {Promise}
 */
export default async function initWrite(services, eventFactory) {
  const {config, eventStoreWithConversion, logger, metrics} = services;

  const aggregateCache = "aggregateCacheFactory" in services ? services.aggregateCacheFactory() : new NullAggregateCache();
  const snapshotStore = "snapshotStoreFactory" in services ? services.snapshotStoreFactory() : new NullSnapshotStore();
  const hasCommandHandlerFactory = ("commandHandlerFactory" in services);
  const commandHandlerFactory = hasCommandHandlerFactory ? services.commandHandlerFactory : defaultCommandHandlerFactory;
  if (!hasCommandHandlerFactory) services.commandHandlerFactory = commandHandlerFactory;

  const commandHandler = commandHandlerFactory(config, eventFactory, eventStoreWithConversion, aggregateCache, snapshotStore, logger, metrics);
  Object.assign(services, {eventFactory, commandHandler});
}
