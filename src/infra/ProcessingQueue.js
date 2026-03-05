export default class ProcessingQueue {
  constructor(processFn) {
    if (processFn && typeof processFn !== 'function') {
      throw new TypeError('processFn must be a function');
    }
    this._processFn = processFn;
    this._length = 0;
    this._promiseChain = Promise.resolve();
  }
  get length() {
    return this._length;
  }
  append(args, processFn) {
    const fn = processFn ?? this._processFn;
    if (!fn) {
      throw new Error('processFn is required if none specified at the service level');
    }
    // promise chaining is faster than processing a queue with microtask
    const p = this._promiseChain
      .then(() => fn(...args));
    this._promiseChain = p.then(() => this._length--, () => this._length--);
    this._length++;
    return p;
  }
}
