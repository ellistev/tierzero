import { jsonParseWithBigInt, jsonSerializeWithBigInt } from '../utils/serialization.js';
import fs from "./runtime/fs.js";
import {resolvePath} from "./utils/index.js";

export default class FileCheckpointStore {
  constructor(filePath) {
    this._filePath = resolvePath(filePath);
  }
  get() {
    return new Promise((resolve, reject) => {
      fs.readFile(this._filePath, (err, content) => {
        if (err && err.code === 'ENOENT') return resolve(null);
        if (err) return reject(err);
        try {
          const obj = jsonParseWithBigInt(content.toString());
          resolve(obj);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  put(position) {
    return new Promise((resolve, reject) => {
      if (!position) return resolve();
      const json = jsonSerializeWithBigInt(position);
      fs.writeFile(this._filePath, json, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
