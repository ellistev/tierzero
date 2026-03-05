/**
 * This represent a virtual connection since SQLite only support one connection
 * @class
 * @implements IDBConnection
 */
class DBConnection {
  /**
   * @param {Database} db
   */
  constructor(db) {
    this._db = db;
    this._batch = null;
  }

  beginBatch() {
    if (this._released) throw new Error('connection is released');
    if (this._batch) throw new Error('batch already started');
    this._batch = [];
    return Promise.resolve();
  }

  exec(sql, args) {
    if (this._released) throw new Error('connection is released');
    if (Array.isArray(sql)) {
      // execute a batch of statements
      return new Promise((resolve, reject) => {
        this._db.transaction(trx => {
          for (const statement of sql) {
            trx.executeSql(statement);
          }
        }, reject, resolve);
      });
    }
    // don't batch SELECT statement
    const isSelect = sql.startsWith('SELECT');
    if (this._batch && !isSelect) {
      return new Promise((resolve, reject) => {
        this._batch.push({sql, args, resolve, reject});
      });
    }
    // execute a single statement
    return new Promise((resolve, reject) => {
      function successCallback(_, rs) {
        resolve(rs);
      }

      function errorCallback(_, err) {
        reject(err);
        return false;
      }

      if (isSelect)
        this._db.readTransaction(trx =>
          trx.executeSql(sql, args, successCallback, errorCallback));
      else
        this._db.transaction(trx =>
          trx.executeSql(sql, args, successCallback, errorCallback));
    });
  }

  async endBatch(commit = false) {
    if (this._released) throw new Error('connection is released');
    if (!this._batch) throw new Error('batch not started');
    if (this._batch.length === 0) {
      this._batch = null;
      return;
    }

    if (!commit) {
      for (const {resolve} of this._batch) {
        resolve({ rows: [], rowsAffected: 0, insertId: 0 });
      }
      this._batch = null;
      return;
    }

    return new Promise((resolve) => {
      const done = () => {
        for (const {resolve} of this._batch) {
          resolve({ rows: [], rowsAffected: 0, insertId: 0 });
        }
        this._batch = null;
        resolve();
      };

      this._db.transaction(trx => {
        for (const {sql, args, resolve, reject} of this._batch) {
          const successCallback = (_, rs) => resolve(rs);
          const errorCallback = (_, err) => {
            reject(err);
            return true;
          };
          trx.executeSql(sql, args, successCallback, errorCallback);
        }
      },
      done, done);
    });
  }

  async release() {
    this._batch = null;
    this._released = true;
  }
}

/**
 * @class
 * @implements IDBPool
 */
export default class DBPool {
  /**
   * @param {Database} db
   */
  constructor(db) {
    this._db = db;
    this._defaultConn = null;
    this._ended = false;
  }

  async getConnection() {
    if (this._ended) throw new Error('pool is closed');
    return new DBConnection(this._db);
  }

  async release(connection) {
    if (this._ended) throw new Error('pool is closed');
    await connection.release();
  }

  async exec(sql, args) {
    if (this._ended) throw new Error('pool is closed');
    if (!this._defaultConn) {
      this._defaultConn = await this.getConnection();
    }
    return await this._defaultConn.exec(sql, args);
  }

  async end() {
    this._ended = true;
    this._defaultConn = null;
    this._db = null;
  }

  async beginBatch() {
    throw new Error("invalid operation: dbPool does not support batching");
  }

  async endBatch() {
    throw new Error("invalid operation: dbPool does not support batching");
  }
}
