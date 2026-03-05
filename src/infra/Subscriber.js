import events from "./runtime/events.js";
import { hrTimeDiff } from './utils/time.js';

const MIN_QUEUE_SIZE = 1000;
const MAX_QUEUE_SIZE = 10000;

export default class Subscriber extends events.EventEmitter {
  constructor(name, eventStore, updateLastCheckPoint, credentials, metrics, logger) {
    super();
    this._name = name;
    this._eventStore = eventStore;
    this._updateLastCheckPoint = updateLastCheckPoint;
    this._credentials = credentials;
    this._metrics = metrics;
    this._logger = logger;
    this._isLive = false;
    this._lastCheckpoint = null;
    this._lastProcessed = null;
    this._promise = Promise.resolve();
    this._queueSize = 0;
    this._pauseRequested = false;
    this._paused = false;
    this._stopNow = false;
    this._queueWatchInterval = null;
    this._subscription = null;
    this._handlers = [];
    this._stats = {
      startTime: 0,
      liveTime: 0,
      nbEvents: 0,
    };
  }

  /**
   * @param {EventStorePosition|null} lastCheckpoint
   * @return Promise
   */
  startFrom(lastCheckpoint) {
    if (this._subscription || this._paused) throw new Error(`Subscriber ${this._name} is already started.`);

    this._subscribe(lastCheckpoint);

    return Promise.resolve();
  }

  isLive() {
    return this._isLive;
  }

  addHandler(handler) {
    if (this._subscription || this._paused) throw new Error(`Subscriber ${this._name} is already started.`);
    this._handlers.push(handler);
  }

  async stop(wait = false) {
    if (!this._paused && !this._subscription) throw new Error(`Subscriber ${this._name} is not started.`);
    this._logger.debug(`Subscriber ${this._name} stopping...`);
    this._paused && clearInterval(this._queueWatchInterval);
    this._subscription && this._subscription.stop();
    if (!wait) this._stopNow = true;
    await this._promise;
    this._subscription = null;
    this._paused = false;
  }

  get lastProcessed() {
    return this._lastProcessed;
  }

  _subscribe(lastCheckpoint) {
    const action = this._paused ? 'restarting' : 'starting';
    this._logger.info(`Subscriber ${this._name} ${action} subscription from`, (lastCheckpoint || "beginning").toString());
    this._stats.startTime = Date.now();
    this._stats.nbEvents = 0;
    this._isLive = false;
    this._lastProcessed = lastCheckpoint;
    this.emit(this._paused ? 'resubscribe' : 'subscribe', { from: lastCheckpoint });

    const liveProcessingStarted = () => {
      this._promise = this._promise.then(() => {
        this._stats.liveTime = Date.now();
        const catchUpEvents = this._stats.nbEvents;
        const elapsedTime = this._stats.liveTime - this._stats.startTime;
        this._logger.info(`Subscriber ${this._name} live processing started. Catching up stats: count(events)=${catchUpEvents}`,
          `duration(ms)=${elapsedTime}`,
          (catchUpEvents > 0 && ` avg(ms/event)=${(elapsedTime/catchUpEvents).toFixed(3)}`) || '');
        this._isLive = true;
        this.emit('catchUpCompleted');
      });
    };
    const subscriptionDropped = (conn, reason, error) => {
      if (reason === 'userInitiated' && this._pauseRequested) {
        this._paused = true;
        this._logger.info(`Subscriber ${this._name} paused.`);
      } else {
        //Persistent subscription automatically reconnect and continue so nothing to do here than logging
        this._logger.info(`Subscriber ${this._name} subscription dropped:`, reason, error);
      }
    };

    this._subscription = this._eventStore.subscribeToAllFrom(
      lastCheckpoint,
      (event) => this._onEventAppeared(event),
      liveProcessingStarted,
      subscriptionDropped,
      this._credentials);
  }

  _pause() {
    if (this._pauseRequested) return;
    this._pauseRequested = true;
    this._logger.debug(`Subscriber ${this._name} pause requested...`);
    this._subscription.stop();
    this._subscription = null;
    this._queueWatchInterval = setInterval(() => this._watchQueue(), 500);
  }

  _watchQueue() {
    if (!this._paused) return;
    if (this._queueSize > MIN_QUEUE_SIZE) return;
    this._subscribe(this._lastCheckpoint);
    this._paused = false;
    this._pauseRequested = false;
    clearInterval(this._queueWatchInterval);
    this._queueWatchInterval = null;
  }

  /**
   * @param {EventStoredData} eventData
   * @private
   */
  _onEventAppeared(eventData) {
    if (this._paused) return;
    if (this._queueSize > MAX_QUEUE_SIZE) this._pause();
    this._lastCheckpoint = eventData.position;
    const time_in = process.hrtime();

    const eventType = eventData.eventType;
    if (eventType[0] === '$') return;
    this._logger.debug(`Subscriber ${this._name} event appeared: ${eventType}`);
    this._promise = this._promise
      .then(() => {
        this._metrics.capture(`subscriber_${this._name}.time_in_queue`, hrTimeDiff(time_in));
        return this._metrics.time(`subscriber_${this._name}.processing_time`, () => this._processEvent(eventData));
      })
      .then(() => this._queueSize--, () => this._queueSize--);
    this._queueSize++;
  }

  async _processEvent(esData) {
    if (this._stopNow) return;
    this._stats.nbEvents++;
    for (const handler of this._handlers) {
      try {
        await handler(esData);
      } catch (err) {
        this._logger.error('Subscriber', this._name,'handler failed:', err);
      }
    }
    this._lastProcessed = esData.position;
    await this._updateLastCheckPoint(esData.position);
  }
}
