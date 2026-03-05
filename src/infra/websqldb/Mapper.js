import {Mapper} from '../Mapper.js';
import {mapToDb, mapRowFromDb} from './DBTypes.js';
import SqlBuilder from './SqlBuilder.js';
import MapperReadResult from './MapperReadResult.js';
import {Order, Where} from './queries.js';
import SqlError from './SqlError.js';

const CREATE_VERSION_SQL = `CREATE TABLE IF NOT EXISTS "$versions" (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`;
const CREATE_HASHES_SQL = `CREATE TABLE IF NOT EXISTS "$hashes" (name TEXT PRIMARY KEY, hash TEXT NOT NULL)`;
const GET_VERSION_SQL = `SELECT version FROM "$versions" WHERE name = :name`;
const SET_VERSION_SQL = `INSERT OR REPLACE INTO "$versions" (name, version) VALUES (:name, :version)`;
const GET_HASH_SQL = `SELECT hash FROM "$hashes" WHERE name = :name`;
const SET_HASH_SQL = `INSERT OR REPLACE INTO "$hashes" (name, hash) VALUES (:name, :hash)`;
const DEFAULT_LIMIT = 100;

const getPrimaryKeyValue = (primaryKey, record) => {
  if (!record) return record;
  return primaryKey.map(k => record[k]).join(':');
};

/**
 * @class
 */
export class WebSQLMapper extends Mapper {
  /**
   * @param {ModelDefinition[]} modelsDefs
   * @param {Logger} logger
   */
  constructor(modelsDefs, logger) {
    super(modelsDefs);
    this._logger = logger;
    this._verboseLogging = (process.env.VERBOSE ?? '').split(' ').includes('websqldb');
  }

  /**
   * Insert payload into read model
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} payload
   * @returns {Promise<void>}
   */
  async insert(conn, modelName, payload) {
    const modelDef = this._getModelDefByName(modelName);
    modelDef.validatePayload(payload, true);

    const columns = Object.keys(payload);
    const sql = SqlBuilder.insert(columns, modelDef);
    const insertValues = columns.map(x => mapToDb(payload[x], modelDef.columnDefs[x]));
    await this._runSql(conn, sql, [...insertValues]);
  }

  /**
   * Upsert payload into read model
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} payload
   * @returns {Promise<void>}
   */
  async upsert(conn, modelName, payload) {
    const modelDef = this._getModelDefByName(modelName);
    modelDef.validatePayload(payload, true);

    const columns = Object.keys(payload);
    const sql = SqlBuilder.upsert(columns, modelDef);
    const insertValues = columns.map(x => mapToDb(payload[x], modelDef.columnDefs[x]));
    await this._runSql(conn, sql, [...insertValues]);
  }

  /**
   * Update read model with changes when where condition is met
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} changes
   * @param {object} where
   * @returns {Promise<number>}
   */
  async update(conn, modelName, changes, where) {
    const modelDef = this._getModelDefByName(modelName);
    modelDef.validatePayload(changes);

    const _where = new Where(where);
    const fieldsToUpdate = Object.keys(changes); //.filter(k => !modelDef.primaryKey.includes(k));
    const setValues = fieldsToUpdate.map(x => mapToDb(changes[x], modelDef.columnDefs[x]));
    const {sql: whereSql, values} = SqlBuilder.toWhereSql(_where, setValues);
    const sql = SqlBuilder.update(fieldsToUpdate, whereSql, modelDef);
    const result = await this._runSql(conn, sql, values);
    return result.rowsAffected;
  }

  /**
   * Select from read model
   * @param {IDBPool|IDBConnection} db
   * @param {string} modelName
   * @param {Filter|FilterCursor} filter
   * @returns {Promise<MapperReadResult>}
   */
  async select(db, modelName, filter) {
    const modelDef = this._getModelDefByName(modelName);
    const where = Where.fromFilter(filter);
    modelDef.validateFields(filter.fields);
    if (filter.fields) throw new Error('filter.fields is not implemented');
    if (filter.addColumns) throw new Error('filter.addColumns is not implemented');
    if (typeof filter.nextToken === 'string') {
      if (!modelDef.schema[filter.orderBy?.[0]]) throw new Error('cursor query order field is not in schema');
      if (modelDef.primaryKey.length > 1) throw new Error('cursor query does not support composite primary key');
      return this._findCursor(db, modelDef, filter, where);
    }
    const orderBy = Order.fromFilter(filter);
    if (filter.paging === true) {
      return this._findPaging(db, modelDef, filter, where, orderBy);
    }
    return this._find(db, modelDef, filter, where, orderBy);
  }

  /**
   * Remove a record
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {object} where
   * @returns {Promise<number>}
   */
  async remove(conn, modelName, where) {
    const modelDef = this._getModelDefByName(modelName);
    const _where = new Where(where);
    const {sql: whereSql, values} = SqlBuilder.toWhereSql(_where, []);
    const sql = SqlBuilder.delete(whereSql, modelDef);
    const result = await this._runSql(conn, sql, values);
    return result.rowsAffected;
  }

  /**
   * Drop read model if it exists
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} [version]
   * @returns {Promise<void>}
   */
  async tryDropModel(conn, modelName, version) {
    const modelDef = this._getModelDefByName(modelName);
    const useVersion = version || modelDef.version;
    const sql = `DROP TABLE IF EXISTS ${modelDef.name}_v${useVersion};`;
    await this._runSql(conn, sql);
  }

  /**
   * Create read model if it doesn't exists
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} [version]
   * @returns {Promise<void>}
   */
  async tryCreateModel(conn, modelName, version) {
    const modelDef = this._getModelDefByName(modelName);
    const useVersion = version || modelDef.version;
    this._logger.info(`Try creating model ${modelDef.name} table for version ${useVersion}...`);
    const createSql = SqlBuilder.createTable(modelDef);
    const indexesSqls = SqlBuilder.createIndexes(modelDef);
    await conn.exec([createSql, ...indexesSqls]);
  }

  /**
   * Get read model version
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @returns {Promise<number>}
   */
  async getModelVersion(conn, modelName) {
    await this._ensureInstalled(conn);
    const modelDef = this._getModelDefByName(modelName);
    const results = await this._runSql(conn, GET_VERSION_SQL, [modelDef.name]);
    if (!results || !results.length) return 0;
    return results[0].version;
  }

  /**
   * Set read model version
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {number} version
   * @returns {Promise<void>}
   */
  async setModelVersion(conn, modelName, version) {
    await this._ensureInstalled(conn);
    const modelDef = this._getModelDefByName(modelName);
    await this._runSql(conn, SET_VERSION_SQL, [modelDef.name, version || modelDef.version]);
  }

  /**
   * Get read model hash
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @returns {Promise<string>}
   */
  async getModelHash(conn, modelName) {
    await this._ensureInstalled(conn);
    const modelDef = this._getModelDefByName(modelName);
    const results = await this._runSql(conn, GET_HASH_SQL, [modelDef.name]);
    if (!results || !results.length) return '';
    return results[0].hash;
  }

  /**
   * Set read model hash
   * @param {IDBPool|IDBConnection} conn
   * @param {string} modelName
   * @param {string} hash
   * @returns {Promise<void>}
   */
  async setModelHash(conn, modelName, hash) {
    await this._ensureInstalled(conn);
    const modelDef = this._getModelDefByName(modelName);
    await this._runSql(conn, SET_HASH_SQL, [modelDef.name, hash]);
  }

  async _find2(conn, model, where, orderBy, skip, limit) {
    const {sql: whereSql, values} = SqlBuilder.toWhereSql(where, []);
    const sql = SqlBuilder.select(whereSql, orderBy, model);
    const sqlLimit = ` LIMIT ${limit || DEFAULT_LIMIT}${skip ? ` OFFSET ${skip}` : ''}`;
    const results = (await this._runSql(conn, sql + sqlLimit, values)) || [];
    const mappedResults = results.map(x => mapRowFromDb(x, model));
    const fromSql = sql.split('FROM')[1];
    const total = (skip || limit)
      ? await this._getCount(conn, fromSql, values)
      : results.length;
    return new MapperReadResult(mappedResults, total);
  }

  /**
   * @param {IDBPool|IDBConnection} db
   * @param {ModelDefinition} model
   * @param {Filter} filter
   * @param {Where} where
   * @param {Order} orderBy
   * @return {Promise<MapperReadResult>}
   * @private
   */
  async _find(db, model, filter, where, orderBy) {
    const { limit, skip } = filter;
    const { sql: whereSql, values } = SqlBuilder.toWhereSql(where);
    //const fields = filter.fields || model.columns;
    //const addColumns = filter.addColumns || {};
    const sql = SqlBuilder.select(whereSql, orderBy, model);
    const sqlLimit = ` LIMIT ${limit || DEFAULT_LIMIT}${skip ? ` OFFSET ${skip}` : ''}`;
    const results = (await this._runSql(db, sql + sqlLimit, values)) || [];
    const mappedResults = results.map(x => mapRowFromDb(x, model));
    return {
      results: mappedResults
    };
  }

  /**
   * @param {IDBPool|IDBConnection} db
   * @param {ModelDefinition} model
   * @param {Filter} filter
   * @param {Where} where
   * @param {Order} orderBy
   * @return {Promise<MapperReadResult>}
   * @private
   */
  async _findPaging(db, model, filter, where, orderBy) {
    const { limit, skip } = filter;
    const { sql: whereSql, values } = SqlBuilder.toWhereSql(where);
    //const fields = filter.fields || model.columns;
    //const addColumns = filter.addColumns || {};
    const sql = SqlBuilder.select(whereSql, orderBy, model);
    const sqlLimit = ` LIMIT ${limit || DEFAULT_LIMIT}${skip ? ` OFFSET ${skip}` : ''}`;
    const results = (await this._runSql(db, sql + sqlLimit, values)) || [];
    const mappedResults = results.map(x => mapRowFromDb(x, model));
    const fromSql = sql.split('FROM')[1];
    const total = await this._getCount(db, fromSql, values);
    return {
      results: mappedResults,
      total,
    };
  }

  /**
   * @param {IDBPool|IDBConnection} db
   * @param {ModelDefinition} model
   * @param {FilterCursor} filter
   * @param {Where} where
   * @return {Promise<MapperReadResult>}
   * @private
   */
  async _findCursor(db, model, filter, where) {
    const { sql: cursorWhereSql, values: cursorValues } = SqlBuilder.toWhereCursorSql(where, filter.orderBy, filter.nextToken, model);
    const { sql: whereSql, values: whereValues } = SqlBuilder.toWhereSql(where);
    // const fields = filter.fields
    //   ? [...new Set([...model.primaryKey, ...filter.fields])]
    //   : model.columns;
    const orderBy = Order.fromFilter({
      ...filter,
      order: [`${filter.orderBy[0]} ${filter.orderBy[1]}`, `${model.primaryKey[0]} ASC`]
    });
    const sql = SqlBuilder.select(cursorWhereSql, orderBy, model);
    const sqlLimit = ` LIMIT ${(filter.limit || DEFAULT_LIMIT) + 1}`;
    const results = (await this._runSql(db, sql + sqlLimit, cursorValues)) || [];
    const mappedResults = results.map(x => mapRowFromDb(x, model));
    const fromSql = ` ${SqlBuilder._quote(model.tableName)} ${whereSql}`;
    const total = await this._getCount(db, fromSql, whereValues);
    const hasMore = mappedResults.length > (filter.limit || DEFAULT_LIMIT);
    const nextToken = hasMore ? getPrimaryKeyValue(model.primaryKey, mappedResults[mappedResults.length - 2]) : null;
    return {
      results: mappedResults.slice(0, (filter.limit || DEFAULT_LIMIT)),
      total,
      nextToken,
    };
  }

  async _getCount(conn, fromSql, values) {
    const results = await this._runSql(conn, `SELECT COUNT(*) AS count FROM` + fromSql, values);
    return results[0].count;
  }

  /**
   * @param {IDBPool|IDBConnection} conn
   * @param {string} sql
   * @param {*[]} args
   * @returns {Promise<[]>}
   * @private
   */
  async _runSql(conn, sql, args = []) {
    try {
      if (this._verboseLogging) this._logger.debug('websqldb SQL', sql, args);
      const {rows, rowsAffected} = await conn.exec(sql, args);
      const results = [];
      for (let i = 0; i < rows.length; i++) {
        results.push(rows.item(i));
      }
      results.rowsAffected = rowsAffected;
      return results;
    } catch (err) {
      throw new SqlError(err, "runSQL failed", sql, args);
    }
  }

  async _ensureInstalled(conn) {
    if (this._installed) return;
    this._installed = true;
    await this._runSql(conn, CREATE_VERSION_SQL, []);
    await this._runSql(conn, CREATE_HASHES_SQL, []);
  }
}

export default WebSQLMapper;
