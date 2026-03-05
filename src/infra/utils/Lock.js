import {defer} from "./index.js";
import { deprecate } from 'util'

const Lock = deprecate(class Lock {
  constructor() {
    this._locked = false;
    this._q = [];
  }

  async acquire() {
    if (this._locked) {
      const d = defer();
      this._q.push(d);
      await d.promise;
    }
    this._locked = true;
  }

  release() {
    //console.assert(this._locked !== false, 'releasing an already unlocked Lock')
    this._locked = false;
    const d = this._q.shift();
    if (d) setImmediate(d.resolve);
  }
}, "Lock doesn't work as expected, do not use.");

export default Lock;
