const States = Object.freeze({
  initial: 'initial',
  started: 'started',
  ending: 'ending',
  ended: 'ended',
  disposing: 'disposing',
  disposed: 'disposed',
  done: 'done'
});
const noOp = () => {
  //nothing to do
};
/**
 * @class
 */
export class Batcher {
  constructor(conn) {
    this._promises = [];
    this._connection = conn;
    this._supportsBatch = typeof conn.beginBatch === 'function' && typeof conn.endBatch === 'function';
    this._state = States.initial;
  }
  _expectState(op, ...expectedStates) {
    if (!expectedStates.includes(this._state)) {
      throw new Error(`invalid state ${this._state} for operation ${op}`);
    }
  }
  async begin() {
    this._expectState('add', States.initial);
    this._supportsBatch && await this._connection.beginBatch();
    this._state = States.started;
  }
  add(promise) {
    promise.catch(noOp); // avoid unhandled promise rejection
    this._expectState('add', States.started);
    this._promises.push(promise);
  }
  async end() {
    this._expectState('commit', States.started);
    this._state = States.ending;
    if (this._supportsBatch) {
      await this._connection.endBatch(true);
    }
    this._state = States.ended;
    await Promise.all(this._promises);
    this._state = States.done;
  }
  async dispose() {
    this._expectState('dispose', States.initial, States.started, States.ending, States.ended, States.done);
    const prevState = this._state;
    this._state = States.disposing;
    if (prevState === States.started && this._supportsBatch) {
      await this._connection.endBatch(false);
      //settle the promises
      for (const p of this._promises) {
        try {
          await p;
        } catch (err) {
          //do nothing
        }
      }
    }
    this._state = States.disposed;
  }
  get connection() {
    return this._connection;
  }
  get changes() {
    return this._promises.length;
  }
}

export default Batcher;
