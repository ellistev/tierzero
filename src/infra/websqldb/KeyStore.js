import {decodeBase64, encodeBase64} from "../utils/base64.js";

const CREATE_TABLE_SQL = ["CREATE TABLE IF NOT EXISTS '", "' (" +
  "keyTag TEXT PRIMARY KEY, " +
  "key TEXT NOT NULL" +
  ")"];
const GET_SQL = ["SELECT key FROM '", "' WHERE keyTag = :keyTag"];
const PUT_SQL = ["INSERT OR REPLACE INTO '", "' (keyTag, key) VALUES (:keyTag, :key)"];

function sqlWithTableName(sqlParts, tableName) {
  return [sqlParts[0], tableName, sqlParts[1]].join("");
}

/**
 * Note: This is not a secure key store, use SecureKeyStore for secure keys
 */
export default class KeyStore {
  /**
   * @param {DBConnection} db
   */
  constructor(db, tableName = "$keys") {
    this._db = db;
    this._tableName = tableName;
    const sql = sqlWithTableName(CREATE_TABLE_SQL, tableName);
    db.exec(sql);
  }

  /**
   * @param {string} keyTag
   * @return {Promise<Uint8Array|null>}
   */
  async get(keyTag) {
    const sql = sqlWithTableName(GET_SQL, this._tableName);
    const {rows} = await this._db.exec(sql, [keyTag]);
    if (rows.length === 0) return null;
    const {key} = rows.item(0);
    if (!key) return null;
    return decodeBase64(key);
  }

  /**
   * @param {string} keyTag
   * @param {Uint8Array} key
   * @return {Promise<void>}
   */
  async set(keyTag, key) {
    if (!(key instanceof Uint8Array)) throw new TypeError("key must be an Uint8Array");
    const sql = sqlWithTableName(PUT_SQL, this._tableName);
    await this._db.exec(sql, [keyTag, encodeBase64(key)]);
  }
}
