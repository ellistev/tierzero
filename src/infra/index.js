import fs from "./runtime/fs.js";
import serviceRegistryFactory from "./serviceRegistry.js";
import initRead from './initRead.js';
import initWrite from "./initWrite.js";
import {noOp} from './utils/index.js';
import EncryptedEventStore from './EncryptedEventStore.js';
import NullMetrics from "./metrics/NullMetrics.js";

/**
 * @param {object} options
 * @param {object} options.config
 * @param {Logger} options.logger
 * @param {function} options.esBootstrap
 * @param {function} options.storageBootstrap
 * @param {object} options.readModels
 * @param {eventFactory} options.eventFactory
 * @param {function[]} options.controllersFactories
 * @param {function} [options.servicesBootstrap]
 * @param {object} [options.services]
 * @param {string[]} [options.args]
 * @param {function(services:object,bootstrapFrom:string):Promise<void>} [options.bootstrapEvents]
 * @param {function(services:object,eventStore:EventStore):Promise<void>} [options.updateReadModels]
 * @return {Promise<void>}
 */
export default async function wireUp(options) {
  const {
    config, logger, esBootstrap, storageBootstrap, readModels, eventFactory, controllersFactories, servicesBootstrap,
    bootstrapEvents = noOp, updateReadModels = noOp, initWeb, services, args = [], version
  } = options;

  const _services = serviceRegistryFactory({forceNew: true});
  if (services) {
    for (const k in services) {
      _services[k] = services[k];
    }
  }
  if (!('atexit' in services)) _services.atexit = noOp;
  if (!('terminate' in services)) _services.terminate = (withError) => process.exit(withError ? -1 : 0);
  _services.config = config;
  _services.logger = logger;
  _services.version = version;
  _services.args = args;
  _services.updateReadModels = updateReadModels;
  if ('metricsFactory' in services) {
    _services.metrics = services.metricsFactory(_services);
  } else {
    _services.metrics = new NullMetrics();
  }

  if ("encryptObject" in services) {
    const localServices = {..._services};
    await esBootstrap(localServices);
    _services.subscriberFactory = localServices.subscriberFactory;
    _services.esStreamReaderFactory = localServices.esStreamReaderFactory;
    _services.eventStoreFactory = () => new EncryptedEventStore(localServices.eventStoreFactory(), _services);
    _services.eventStore = new EncryptedEventStore(localServices.eventStore, _services);
  } else {
    await esBootstrap(_services);
  }

  await bootstrapEvents(_services);
  await initRead(_services, storageBootstrap, fromMap(readModels));
  await initWrite(_services, eventFactory);
  if (servicesBootstrap) {
    await servicesBootstrap(_services);
  }
  if (initWeb) {
    await initWeb(_services, controllersFactories);
  }
}

export function bootstrapEvents(services, bootstrapEventsFrom) {
  const {eventStore, logger} = services;
  //const bootstrapEventsFrom = Object.assign({events: null}, config.bootstrap).events;
  if (!bootstrapEventsFrom) return;

  logger.info("Bootstrapping events from:", bootstrapEventsFrom);

  return new Promise((resolve, reject) => {
    fs.readFile(bootstrapEventsFrom, (err, buf) => {
      if (err) return reject(err);
      resolve(buf.toString());
    });
  }).then(async(content) => {
    if (content[0] === '[') {
      const data = JSON.parse(content);
      for (const { stream, events: eventDatas, expectedVersion = -1 } of data) {
        try {
          await eventStore.appendToStream(stream, eventDatas, expectedVersion);
        } catch (err) {
          if (err.name === 'WrongExpectedVersionError') {
            throw new Error(`wrong expected version for ${stream} with expected version ${expectedVersion}: ${err.message}.`);
          }
          throw err;
        }
      }
    } else {
      const lines = content.split('\n').map(x => x.trim());
      for (const line of lines) {
        if (!line) continue;
        const {eventStreamId, eventNumber, eventId, eventType, data, metadata} = JSON.parse(line);
        const eventData = {eventId, eventType, data, metadata};
        try {
          await eventStore.appendToStream(eventStreamId, eventData, eventNumber - 1);
        } catch (err) {
          if (err.name === 'WrongExpectedVersionError') {
            throw new Error(`wrong expected version for ${eventStreamId} with expected version ${(eventNumber-1)}: ${err.message}.`);
          }
          throw err;
        }
      }
    }
  });
}

function fromMap(m) {
  return Object.keys(m).map(k => ({
    name: k,
    ...m[k]
  }));
}
