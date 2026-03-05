/* eslint-disable no-unused-vars */

/**
 * @abstract
 */
export class Mapper {
  /**
   * @param {ModelDefinition[]} modelsDefs
   */
  constructor(modelsDefs) {
    this._modelsDefs = new Map();
    for (const modelDef of modelsDefs) {
      this._modelsDefs.set(modelDef.name, modelDef);
    }
  }

  /**
   * @param {string} modelName
   * @returns {ModelDefinition}
   */
  _getModelDefByName(modelName) {
    const modelDef = this._modelsDefs.get(modelName);
    if (!modelDef) throw new Error(`Read model "${modelName}" is not registered.`);
    return modelDef;
  }

  /**
   * @public
   * @param {ModelDefinition} modelDef
   */
  addModel(modelDef) {
    this._modelsDefs.set(modelDef.name, modelDef);
  }

  /**
   * Upsert payload into readModel's identified by modelName
   * If an object with the same key exists it is updated
   * In short: it's an upsert not an insert
   * @async
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} payload
   * @returns {Promise<void>}
   */
  upsert(conn, modelName, payload) {
    throw new Error("Not implemented!");
  }

  /**
   * @async
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} payload
   * @returns {Promise<void>}
   */
  insert(conn, modelName, payload) {
    throw new Error("Not implemented!");
  }

  /**
   * Update readModel's entry/ies identified by modelName and filtered by constraints
   * @async
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {Object} changes
   * @param {Object} where
   * @returns {Promise<number>} number of entry/ies updated
   */
  update(conn, modelName, changes, where) {
    throw new Error("Not implemented");
  }

  /**
   * Fetch readModel(s) identified by modelName and filtered by constraints
   * @async
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {Filter|{}} filter
   * @returns {Promise<MapperReadResult>}
   */
  select(conn, modelName, filter) {
    throw new Error("Not implemented");
  }

  /**
   * Remove readModel's entry/ies that matches the where constraints
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {Object} where
   * @returns {Promise<number>} number of entries removed
   */
  remove(conn, modelName, where) {
    throw new Error("Not implemented");
  }

  /**
   * Drop read model if it exists
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} [version]
   * @returns {Promise}
   */
  tryDropModel(conn, modelName, version) {
    throw new Error("Not implemented");
  }

  /**
   * Create read model if it doesn't exists
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} [version]
   * @returns {Promise<void>}
   */
  tryCreateModel(conn, modelName, version) {
    throw new Error("Not implemented");
  }

  /**
   * Get read model version
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @returns {Promise<number>}
   */
  getModelVersion(conn, modelName) {
    throw new Error("Not implemented");
  }

  /**
   * Set read model version
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} version
   * @returns {Promise<void>}
   */
  setModelVersion(conn, modelName, version) {
    throw new Error("Not implemented");
  }

  /**
   * Get read model hash
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @returns {Promise<string>}
   */
  getModelHash(conn, modelName) {
    throw new Error("Not implemented");
  }

  /**
   * Set read model hash
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {string} hash
   * @returns {Promise<void>}
   */
  setModelHash(conn, modelName, hash) {
    throw new Error("Not implemented");
  }
}
export default Mapper;

/**
 * @interface MapperReadResult
 * @property {Object[]} results
 * @property {?number} total
 * @property {string | null} nextToken
 */

/**
 * @interface IDBConnection
 * @property {function(sql: string, args: *[]):Promise<*>} exec
 * @property {function():Promise<void>} beginBatch
 * @property {function(commit:boolean):Promise<void>} endBatch
 * @property {function():Promise<void>} release
 */

/**
 * @interface IDBPool
 * @property {function():Promise<IDBConnection>} getConnection
 * @property {function(conn: IDBConnection):Promise<void>} release
 * @property {function(sql: string, args: *[]):Promise<*>} exec
 * @property {function():Promise<void>} end
 */
