import { jsonParseWithBigInt, jsonSerializeWithBigInt } from '../utils/serialization.js';

const CREATE_STORE_SQL = 'CREATE TABLE IF NOT EXISTS \'$checkpoints\' (' +
  'name TEXT PRIMARY KEY, ' +
  'value TEXT NOT NULL' +
  ')';
const GET_SQL = 'SELECT value FROM \'$checkpoints\' WHERE name = :name';
const PUT_SQL = 'INSERT OR REPLACE INTO \'$checkpoints\' (name, value) VALUES (:name, :value)';

export default class CheckPointStore {
  constructor(db, key) {
    this._db = db;
    this._key = key;
    this._installed = false;
  }

  async get() {
    await this._ensureInstalled();
    const {rows} = await this._db.exec(GET_SQL, [this._key]);
    const value = rows.length
      ? rows.item(0).value
      : null;
    return value && jsonParseWithBigInt(value);
  }

  async put(value) {
    await this._ensureInstalled();
    await this._db.exec(PUT_SQL, [this._key, jsonSerializeWithBigInt(value)]);
  }

  async _ensureInstalled() {
    if (this._installed) return;
    await this._db.exec(CREATE_STORE_SQL, []);
    this._installed = true;
  }
}
