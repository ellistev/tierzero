import path from "../runtime/path.js";
import fs from "../runtime/fs.js";
import websql from "websql";
import {resolvePath} from "../utils/index.js";
import Mapper from './Mapper.js';
import CheckPointStore from './CheckPointStore.js';
//import KeyStore from "./KeyStore.js";
import DBPool from "./DBPool.js";

/**
 * @param {object} services
 * @param {Logger} services.logger
 * @param {ModelDefinition[]} services.modelDefs
 * @param {function(string,string,string,number): Database} services.openDatabase
 */
export default async function factory(services) {
  const {logger = console, modelDefs = [], config: {websqldb: dbConfig}} = services;
  if (!dbConfig) throw new Error('missing "websqldb" config section');
  if (!dbConfig.dbPath) throw new Error('missing "dbPath" in "websqldb" config section');
  let dbPath = dbConfig.dbPath;
  if (dbPath !== ':memory:') {
    dbPath = resolvePath(dbConfig.dbPath);
    const dbDir = path.dirname(dbPath);
    await fs.promises.mkdir(dbDir, { recursive: true });
  }
  const db = websql(dbPath, '1.0', '', 0);
  const dbPool = new DBPool(db, dbConfig.poolSize || 1);
  const mapper = new Mapper(modelDefs, logger);
  const checkPointStoreFactory = (key) => new CheckPointStore(dbPool, key);
  //const keyStore = new KeyStore(dbPool);
  const storageDriverInfo = {
    name: 'websqldb',
    allowMultipleConnections: false,
  };

  Object.assign(services, {mapper, dbPool, checkPointStoreFactory, storageDriverInfo});
}
