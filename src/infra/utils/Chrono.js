export default class Chrono {
  constructor() {
    this._start = 0;
    this._end = 0;
  }
  start() {
    this._start = Date.now();
    this._end = 0;
  }
  stop() {
    this._end = Date.now();
  }
  get elapsedTime() {
    if (this._end === 0) {
      return Date.now() - this._start;
    }
    return this._end - this._start;
  }
}
