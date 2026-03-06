import KurrentDBEventStore from './index.js';
import StreamReader from '../StreamReader.js';
import Subscriber from '../Subscriber.js';

/**
 * Bootstrap factory for KurrentDB event store
 * Drop-in replacement for websqles bootstrap
 */
export default async function factory(services) {
  const { logger, config, metrics } = services;
  
  const esConfig = config.kurrentdb || config.eventStore;
  if (!esConfig) throw new Error('missing kurrentdb/eventStore config section');
  
  const connectionString = esConfig.connectionString || 'kurrentdb://localhost:2113?tls=false';
  const readBatchSize = esConfig.readBatchSize || 512;
  
  logger.info(`📦 Connecting to KurrentDB: ${connectionString}`);
  
  const eventStoreFactory = () => new KurrentDBEventStore(connectionString, logger);
  const eventStore = eventStoreFactory();
  
  // Ensure connection works
  await eventStore.ensureCreated();
  
  services.eventStoreFactory = eventStoreFactory;
  services.esStreamReaderFactory = (eventStore, streamName, startFrom, batchSize) => 
    new StreamReader(eventStore, streamName, startFrom, null, batchSize || readBatchSize);
  services.subscriberFactory = (name, eventStore, updateLastCheckPoint) => 
    new Subscriber(name, eventStore, updateLastCheckPoint, null, metrics, logger);
  services.eventStore = eventStore;
  
  logger.info('✅ KurrentDB event store initialized');
}
