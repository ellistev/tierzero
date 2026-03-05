import crypto from "./runtime/crypto.js";
import Chrono from "./utils/Chrono.js";
import builderFactory from "./builder.js";
import ReadRepository from "./ReadRepository.js";
import TransactionalRepository from "./TransactionalRepository.js";
import EventStoreWithConversionWrapper from "./EventStoreWithConversionWrapper.js";
import {buildModelDefs, getModelsFor} from "./readModels.js";
import eventConverterFactory from "./eventConverter.js";

function addHashes(list) {
  return list.map(item => ({
    ...item,
    hash: calculateReadModelHash(item)
  }));
}

/**
 * Initialize CQRS read side
 * @param {Object} services Services registry
 * @param {Function} storageBootstrap
 * @param {Array} readModels
 * @returns {Promise}
 */
export default async function initRead(services, storageBootstrap, readModels) {
  const { logger, eventStore, config } = services;
  services.readModels = addHashes(readModels);
  services.modelDefs = buildModelDefs(readModels);
  await storageBootstrap(services);
  const { mapper, dbPool } = services;
  const eventConverter = eventConverterFactory(services);
  const eventStoreWithConversion = new EventStoreWithConversionWrapper(eventStore, eventConverter);
  const lastCheckPointStore = services.checkPointStoreFactory('lastCheckPoint');
  Object.assign(services, { eventStoreWithConversion, lastCheckPointStore });
  await addBuilder(services, storageBootstrap);
  const updateLastCheckPoint = lastCheckPoint => lastCheckPointStore.put(lastCheckPoint);
  const subscriber = services.subscriberFactory('readModels', eventStore, updateLastCheckPoint);
  services.subscriber = subscriber;
  const innerReadRepository = new ReadRepository(mapper, dbPool, logger);
  const readRepository = "readRepositoryFactory" in services
    ? services.readRepositoryFactory(services, innerReadRepository)
    : innerReadRepository;
  Object.assign(services, { readRepository });
  if (config.apiOnly) {
    return;
  }
  await initBuilder(services);
}

async function addBuilder(services, storageBootstrap) {
  const { mapper, dbPool, logger, eventStoreWithConversion, modelDefs, config, storageDriverInfo, metrics, atexit } = services;

  const transactionalRepositoryFactory = (modelName, trx, readRepository) =>
    new TransactionalRepository(mapper, modelName, readRepository || new ReadRepository(mapper, trx.connection, logger), trx, logger);
  services.transactionalRepositoryFactory = transactionalRepositoryFactory;

  if (storageDriverInfo.allowMultipleConnections) {
    const builderServices = { logger, modelDefs, config, transactionalRepositoryFactory, metrics, atexit };
    await storageBootstrap(builderServices, {poolName: 'builder'});
    builderServices.readRepository = new ReadRepository(mapper, builderServices.dbPool, logger);
    services.builder = builderFactory(builderServices, eventStoreWithConversion);
  } else {
    const readRepository = new ReadRepository(mapper, dbPool, logger);
    services.builder = builderFactory({...services, readRepository}, eventStoreWithConversion);
  }
}

async function initBuilder(services) {
  const { logger, eventStoreWithConversion, updateReadModels, subscriber, builder, readModels, terminate } = services;

  subscriber.addHandler(esData => builder.processEvent(readModels, esData));

  setTimeout(async function() {
    try {
      await updateReadModels(services, eventStoreWithConversion);
      if ("eventualConsistency" in services) {
        await services.eventualConsistency.start();
      }
      await subscribeFromLastCheckpoint(services, eventStoreWithConversion);
    } catch (err) {
      logger.error(err);
      terminate(true);
    }
  }, 0);
}

// This functions handles 3 scenarios:
// - Creating the read models "tables" at first run
// - Updating the read models "tables" if version changed
// - Continue updating read models "tables" if it did not finish (crash)
export async function updateReadModels(services, eventStore) {
  try {
    const { builder, checkPointStoreFactory, dbPool, esStreamReaderFactory, lastCheckPointStore, logger, mapper, readModels } = services;

    const readModelsToUpdate = await getReadModelsToUpdate(dbPool, readModels, mapper);
    if (!readModelsToUpdate.length) return;
    logger.info(`Rebuilding ReadModels: ${readModelsToUpdate.map(x => x.name).join(', ')}...`);

    const rawLastCheckpoint = await lastCheckPointStore.get();
    const lastCheckPoint = rawLastCheckpoint && eventStore.createPosition(rawLastCheckpoint);
    const checkPointStore = checkPointStoreFactory('readModelUpdater');
    const startFrom = eventStore.createPosition(await checkPointStore.get());
    const START = eventStore.createPosition();
    const createTable = startFrom.compareTo(START) === 0;
    const timer = new Chrono();

    //TODO fix me - if the process is restarted with new tables to update and update is not completed, they are not correctly updated
    if (createTable) {
      logger.info(`Creating tables...`);
      timer.start();
      let count = 0;
      for (const readModelToUpdate of readModelsToUpdate) {
        const models = getModelsFor(readModelToUpdate);
        for (const model of models) {
          await mapper.tryDropModel(dbPool, model);
          await mapper.tryCreateModel(dbPool, model);
          count++;
        }
      }
      logger.info(`${count} tables schemas updated in ${timer.elapsedTime}ms.`);
    }

    if (lastCheckPoint !== null) {
      logger.info(`Processing events up to ${lastCheckPoint}...`);
      const allStreamReader = esStreamReaderFactory(eventStore, "$all", startFrom);
      timer.start();
      let count = 0;
      let ev;
      while ((ev = await allStreamReader.readNext())) {
        if (ev.position.compareTo(lastCheckPoint) > 0) break;
        await builder.processEvent(readModelsToUpdate, ev);
        await checkPointStore.put(ev.position);
        count++;
      }
      timer.stop();
      logger.info(`${count} events processed in ${timer.elapsedTime}ms`,
        (count > 0 && `(avg ${(timer.elapsedTime/count).toFixed(3)} of ms/event).`) || '');
    }

    logger.info(`Updating read models versions...`);
    await checkPointStore.put(START);
    for (const readModelToUpdate of readModelsToUpdate) {
      const models = getModelsFor(readModelToUpdate);
      for (const model of models) {
        await mapper.setModelHash(dbPool, model, readModelToUpdate.hash);
      }
    }

    logger.info(`Done rebuilding read models.`);
  } catch (e) {
    console.log(e.stack);
    const error = new Error(`Failed to update read models: ${e.message}`);
    error.inner = e;
    throw error;
  }
}

async function getReadModelsToUpdate(conn, readModels, mapper) {
  const readModelsToUpdate = [];
  for (const k in readModels) {
    const readModel = readModels[k];
    const currentHash = readModel.hash;
    const hash = await mapper.getModelHash(conn, readModel.name);
    if (currentHash !== hash || process.env.LES_FORCE_RM_REBUILD) {
      readModelsToUpdate.push(readModel);
    }
  }
  return readModelsToUpdate;
}

async function subscribeFromLastCheckpoint(services, eventStore) {
  const { subscriber, lastCheckPointStore } = services;
  const rawLastCheckpoint = await lastCheckPointStore.get();
  const lastCheckPoint = rawLastCheckpoint && eventStore.createPosition(rawLastCheckpoint);
  await subscriber.startFrom(lastCheckPoint);
}

function calculateReadModelHash(rm) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(rm));
  h.update(rm.handler.toString().replace(/\s/g,''));
  return h.digest('base64');
}
