import path from "../runtime/path.js";
import fs from "../runtime/fs.js";
import websql from "websql";
import {resolvePath} from "../utils/index.js";
import EventStore from "./EventStoreImpl.js";
import StreamReader from "../StreamReader.js";
import Subscriber from "../Subscriber.js";

export default async function factory(services) {
  const {logger, getTypeName, config: {websqles: esConfig}, metrics} = services;
  if (!esConfig) throw new Error('missing "websqles" config section');
  if (!esConfig.readBatchSize) throw new Error('missing "readBatchSize" value in "websqles" section config');
  if (!esConfig.dbPath) throw new Error('missing "dbPath" value in "websqles" section config');
  const readBatchSize = esConfig.readBatchSize;
  //const name = 'events';
  //const crypto = (cryptoProvider && await cryptoProvider(name)) || {};
  let dbPath = esConfig.dbPath;
  if (dbPath !== ':memory:') {
    dbPath = resolvePath(esConfig.dbPath);
    const dbDir = path.dirname(dbPath);
    await fs.promises.mkdir(dbDir, { recursive: true });
  }
  function openDatabase(name, ver, arg3, arg4) {
    if (name !== 'events') throw new Error('this openDatabase method should only be used by EventStore');
    return websql(dbPath, ver, arg3, arg4);
  }
  const eventStoreFactory = () => new EventStore(logger, readBatchSize, {openDatabase, getTypeName}); //, ...crypto});
  const eventStore = eventStoreFactory();
  services.eventStoreFactory = eventStoreFactory;
  services.esStreamReaderFactory = (eventStore, streamName, startFrom, batchSize) => new StreamReader(eventStore, streamName, startFrom, null, batchSize);
  services.subscriberFactory = (name, eventStore, updateLastCheckPoint) => new Subscriber(name, eventStore, updateLastCheckPoint, null, metrics, logger);
  services.eventStore = eventStore;
}
