import { KurrentDBClient, jsonEvent, FORWARDS, START, ANY, NO_STREAM } from '@kurrent/kurrentdb-client';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import Position from '../websqles/Position.js';
import EventData from '../websqles/EventData.js';

/**
 * KurrentDB Event Store adapter
 * Implements the same interface as the SQLite-based EventStore
 * for seamless switching between storage backends
 */
export default class KurrentDBEventStore extends EventEmitter {
  EXPECT_ANY = -2;
  EXPECT_EMPTY = -1;
  
  constructor(connectionString, logger) {
    super();
    this._logger = logger;
    this._client = KurrentDBClient.connectionString(connectionString);
  }

  async read(streamId, start = 0) {
    try {
      const events = [];
      const stream = this._client.readStream(streamId, {
        fromRevision: BigInt(start),
        direction: FORWARDS,
      });
      
      for await (const resolved of stream) {
        events.push(this._toEventData(resolved, streamId));
      }
      return events;
    } catch (err) {
      if (err.type === 'stream-not-found') return [];
      throw err;
    }
  }

  async readBatch(streamId, start, count) {
    try {
      const events = [];
      const stream = this._client.readStream(streamId, {
        fromRevision: BigInt(start),
        direction: FORWARDS,
        maxCount: BigInt(count),
      });
      
      let lastEventNumber = -1;
      for await (const resolved of stream) {
        events.push(this._toEventData(resolved, streamId));
        lastEventNumber = Number(resolved.event.revision);
      }
      
      return {
        events,
        isEndOfStream: events.length < count,
        nextEventNumber: lastEventNumber + 1,
      };
    } catch (err) {
      if (err.type === 'stream-not-found') {
        return { events: [], isEndOfStream: true, nextEventNumber: 0 };
      }
      throw err;
    }
  }

  async readAllBatch(fromPosition, count) {
    const events = [];
    const options = {
      direction: FORWARDS,
      maxCount: BigInt(count),
    };
    
    if (fromPosition && fromPosition.value > 0) {
      options.fromPosition = {
        commit: BigInt(fromPosition.value),
        prepare: BigInt(fromPosition.value),
      };
    } else {
      options.fromPosition = START;
    }
    
    const stream = this._client.readAll(options);
    
    for await (const resolved of stream) {
      if (!resolved.event) continue;
      events.push(this._toEventData(resolved));
    }
    
    const lastEvent = events[events.length - 1];
    const nextPos = lastEvent 
      ? { value: Number(lastEvent.position?.value || 0) + 1 }
      : fromPosition || { value: 0 };
    
    return {
      events,
      isEndOfStream: events.length < count,
      nextPosition: nextPos,
    };
  }

  async appendToStream(streamId, eventDatas, expectedVersion) {
    const events = eventDatas.map(e => jsonEvent({
      id: e.eventId,
      type: e.eventType,
      data: e.data,
      metadata: e.metadata || {},
    }));
    
    let options = {};
    if (expectedVersion === this.EXPECT_ANY || expectedVersion === -2) {
      options.expectedRevision = ANY;
    } else if (expectedVersion === this.EXPECT_EMPTY || expectedVersion === -1) {
      options.expectedRevision = NO_STREAM;
    } else {
      options.expectedRevision = BigInt(expectedVersion);
    }
    
    const result = await this._client.appendToStream(streamId, events, options);
    
    // Emit events for subscriptions
    const position = new Position(Number(result.position?.commit || 0));
    eventDatas.forEach((e, i) => {
      this.emit('eventAppeared', EventData.fromObject({
        ...e,
        streamId,
        eventNumber: Number(result.nextExpectedRevision) - eventDatas.length + i + 1,
        position,
        createdEpoch: Date.now(),
      }));
    });
    
    return position;
  }

  async save(streamId, events, expectedVersion, metadata = null) {
    const eventDatas = events.map((ev) => ({
      eventId: uuidv4(),
      eventType: ev.constructor?.type || ev.type,
      data: ev,
      metadata,
    }));
    
    await this.appendToStream(streamId, eventDatas, expectedVersion);
    return expectedVersion + events.length;
  }

  async save_v2(streamId, events, expectedVersion, metadata = null) {
    const eventDatas = events.map((ev) => ({
      eventId: uuidv4(),
      eventType: ev.constructor?.type || ev.type,
      data: ev,
      metadata,
    }));
    
    const position = await this.appendToStream(streamId, eventDatas, expectedVersion);
    return [expectedVersion + events.length, position];
  }

  subscribeToAllFrom(lastCheckpoint, eventAppeared, liveProcessingStarted, subscriptionDropped) {
    let options = {};
    
    if (lastCheckpoint && lastCheckpoint.value >= 0) {
      options.fromPosition = {
        commit: BigInt(lastCheckpoint.value),
        prepare: BigInt(lastCheckpoint.value),
      };
    } else {
      options.fromPosition = START;
    }
    
    const subscription = this._client.subscribeToAll(options);
    
    // Mark as live immediately - subscribeToAll is a live subscription
    // The catch-up happens inline, so we fire liveProcessingStarted 
    // after a short delay to allow initial events to process
    let liveProcessingFired = false;
    const fireLiveProcessing = () => {
      if (!liveProcessingFired) {
        liveProcessingFired = true;
        liveProcessingStarted?.();
      }
    };
    
    // Fire live processing after 2s if no events arrive (caught up already)
    const liveTimeout = setTimeout(fireLiveProcessing, 2000);
    
    (async () => {
      try {
        for await (const resolved of subscription) {
          if (!resolved.event) continue;
          
          // Filter out system events (those starting with $)
          if (resolved.event.type.startsWith('$')) continue;
          
          const eventData = this._toEventData(resolved);
          await eventAppeared(eventData);
          
          // Fire live processing after processing catch-up events
          if (!liveProcessingFired) {
            clearTimeout(liveTimeout);
            // Small delay to batch remaining catch-up events
            setTimeout(fireLiveProcessing, 500);
          }
        }
      } catch (err) {
        subscriptionDropped?.(subscription, 'error', err);
      }
    })();
    
    return {
      stop: () => subscription.unsubscribe(),
    };
  }

  subscribeToAll(eventAppeared, subscriptionDropped) {
    return this.subscribeToAllFrom(null, eventAppeared, null, subscriptionDropped);
  }

  createPosition(value) {
    if (typeof value === 'number') return new Position(value);
    if (value && typeof value.value === 'number') return new Position(value.value);
    return new Position(0);
  }

  async lastPosition() {
    try {
      const events = this._client.readAll({
        direction: 'backwards',
        fromPosition: 'end',
        maxCount: 1n,
      });
      
      for await (const resolved of events) {
        if (resolved.event) {
          return new Position(Number(resolved.commitPosition));
        }
      }
      return new Position(0);
    } catch {
      return new Position(0);
    }
  }

  async ensureCreated() {
    // KurrentDB handles this automatically
    return Promise.resolve();
  }

  _toEventData(resolved, streamId = null) {
    const { event } = resolved;
    const position = new Position(Number(resolved.commitPosition || 0));
    return EventData.fromObject({
      eventId: event.id,
      eventType: event.type,
      streamId: streamId || event.streamId,
      eventNumber: Number(event.revision),
      position,
      data: event.data,
      metadata: event.metadata,
      createdEpoch: event.created ? event.created.getTime() : Date.now(),
    });
  }
}
