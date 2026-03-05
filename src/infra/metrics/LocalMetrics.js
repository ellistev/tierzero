import { time } from '../utils/time.js';

const DEFAULT_MAX_SET_SIZE = 10000;

/**
 * @implements IMetrics
 */
export default class LocalMetrics {
  constructor({ config }) {
    this._maxSetSize = config.localMetrics?.maxSetSize ?? DEFAULT_MAX_SET_SIZE;
    this._data = {};
  }
  capture(key, value) {
    if (!this._data[key]) {
      this._data[key] = [];
    }
    const values = this._data[key];
    values.push(value);
    if (values.length < this._maxSetSize) return;
    this._data[key] = values.slice(values.length - this._maxSetSize);
  }
  compute(key) {
    const metrics = {};
    const keys = key ? [key] : Object.keys(this._data);
    for (const k of keys) {
      const values = this._data[k];
      const sortedValues = values.slice().sort((a, b) => a - b);
      const max = values.reduce((a, c, i) => c > a[0] ? [c, i] : a, [0, 0]);
      const min = values.reduce((a, c, i) => c < a[0] ? [c, i] : a, [Number.POSITIVE_INFINITY, 0]);
      metrics[k] = {
        count: sortedValues.length,
        max: max[0],
        max_index: max[1],
        min: min[0],
        min_index: min[1],
        avg: sortedValues.reduce((a, c) => a + c, 0) / sortedValues.length,
        median: sortedValues[Math.floor(sortedValues.length / 2)],
        '95th': sortedValues[Math.floor(sortedValues.length / 100 * 95)],
        '96th': sortedValues[Math.floor(sortedValues.length / 100 * 96)],
        '97th': sortedValues[Math.floor(sortedValues.length / 100 * 97)],
        '98th': sortedValues[Math.floor(sortedValues.length / 100 * 98)],
        '99th': sortedValues[Math.floor(sortedValues.length / 100 * 99)],
      };
    }
    return metrics;
  }
  async time(key, fn) {
    const [result, et] = await time(fn);
    this.capture(key, et);
    return result;
  }
}
