import { noOp } from "../utils/index.js";
import Position from "./Position.js";

/**
 * @class
 * @implements Subscription
 */
export default class WebSqlEsSubscription {
  /**
   * @param {EventStore} eventStore
   * @param {Logger} logger
   * @param {Position} lastCheckPoint
   * @param {EventStore~onEventAppeared} eventAppeared
   * @param {EventStore~onLiveProcessingStarted} liveProcessingStarted
   * @param {EventStore~onSubscriptionDropped} subscriptionDropped
   */
  constructor(eventStore, logger, lastCheckPoint, eventAppeared, liveProcessingStarted, subscriptionDropped) {
    this._logger = logger;
    this._eventStore = eventStore;
    this._lastCheckPoint = lastCheckPoint;
    this._eventAppeared = eventAppeared;
    this._liveProcessingStarted = liveProcessingStarted || noOp;
    this._subscriptionDropped = subscriptionDropped || noOp;
    this._stopped = false;
    this._orderPromise = Promise.resolve();
  }

  start() {
    if (this._stopped) return; // can't re-use the Subscription
    if (this._started) {
      throw new Error("Subscription already started");
    }
    this._started = true;
    if (this._lastCheckPoint) {
      setTimeout(() => this._catchUp(), 0);
    } else {
      this._handler = ev => {
        this._orderPromise = this._orderPromise.then(() => this._onEventAppeared(ev));
      };
      this._eventStore.on('eventAppeared', this._handler);
    }
  }

  async _catchUp() {
    try {
      let position = new Position(this._lastCheckPoint.value + 1);
      let done = false;
      do {
        const {isEndOfStream, nextPosition, events} = await this._eventStore.readAllBatch(position);
        done = isEndOfStream;
        position = nextPosition;
        for (const eventData of events) {
          await this._onEventAppeared(eventData);
          if (this._stopped) return;
        }
      } while (!done && !this._stopped);
      if (this._stopped) return;
      this._handler = ev => {
        this._orderPromise = this._orderPromise.then(() => this._onEventAppeared(ev));
      };
      this._eventStore.on('eventAppeared', this._handler);
      this._liveProcessingStarted();
    } catch (err) {
      this._logger.warn("catchUp failed", err);
      this._stop('catchup failed', err);
    }
  }

  async _onEventAppeared(eventData) {
    if (this._stopped) return;
    try {
      await this._eventAppeared(eventData);
    } catch (err) {
      this._logger.warn("eventAppeared handler failed", err);
      this._stop('handler failed', err);
    }
  }

  stop() {
    this._stop('user requested', null);
  }

  _stop(reason, err) {
    this._stopped = true;
    if (this._handler) this._eventStore.off('eventAppeared', this._handler);
    this._handler = null;
    this._subscriptionDropped(this._eventStore, reason, err);
  }
}
