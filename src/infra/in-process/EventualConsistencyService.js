import { defer } from '../utils/index.js';

/**
 * @implements IEventualConsistencyService
 */
export default class EventualConsistencyService {
  constructor({ builder, subscriber, eventStore, logger }) {
    this._builder = builder;
    this._subscriber = subscriber;
    this._eventStore = eventStore;
    this._defaultTimeoutInMillis = 30000; //TODO config
    this._defferedSyncs = new Set();
    this._lastProcessedPosition = null;
    this._lastAppearedPosition = null;
    this._started = false;
    this._starting = false;
    this._onEventProcessed = this._onEventProcessed.bind(this);
    this._onEventAppeared = this._onEventAppeared.bind(this);
    logger.info('Using in-process eventual consistency.');
  }

  async start() {
    if (this._started) throw new Error('service already started');
    if (this._starting) return;
    this._starting = true;

    this._lastAppearedPosition = await this._eventStore.lastPosition();
    this._subscriber.once('subscribe', e => this._lastProcessedPosition = e.from);
    this._builder.on('eventProcessed', this._onEventProcessed);
    this._subscriber.addHandler(this._onEventAppeared);

    this._started = true;
    this._starting = false;
  }

  async stop() {
    if (!this._started) throw new Error('service not started');

    this._builder.off('eventProcessed', this._onEventProcessed);
    this._started = false;
  }

  /**
   * @param {string}          readModelName
   * @param {IPosition|null}  minPosition       wait for RM to be at least at position. if null lastAppearedPosition is used
   * @param {number}          [timeoutInMillis]
   * @return {Promise<void>}
   */
  async waitFor(readModelName, minPosition, timeoutInMillis) {
    if (!this._started) throw new Error('in-process eventual consistency service not started');

    minPosition = minPosition === null ? this._lastAppearedPosition : minPosition;
    timeoutInMillis = timeoutInMillis || this._defaultTimeoutInMillis;
    if (this._lastProcessedPosition?.compareTo(minPosition) >= 0) {
      return;
    }
    const d = defer();
    const item = {
      d,
      position: minPosition
    };
    setTimeout(d.resolve, timeoutInMillis);
    this._defferedSyncs.add(item);
    try {
      await d.promise;
    } finally {
      this._defferedSyncs.delete(item);
    }
  }

  /**
   * This is invoked when an event has been processed by the builder
   * @param {EventStoredData} eventStoredData
   * @private
   */
  _onEventProcessed(eventStoredData) {
    this._lastProcessedPosition = eventStoredData.position;
    for (const item of this._defferedSyncs) {
      if (eventStoredData.position?.compareTo(item.position) >= 0) {
        item.d.resolve();
      }
    }
  }

  /**
   * This is invoked when an event has appeared in the EventStore
   * @param {EventStoredData} eventStoredData
   * @private
   */
  _onEventAppeared(eventStoredData) {
    this._lastAppearedPosition = eventStoredData.position;
  }
}
