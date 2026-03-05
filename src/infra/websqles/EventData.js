import Position from "./Position.js";

/**
 * @class
 * @implements EventStoredData
 */
export default class EventData {
  /**
   * @param {string} eventId
   * @param {string} eventType
   * @param {string} streamId
   * @param {number} eventNumber
   * @param {object} data
   * @param {object} [metadata]
   * @param {number} [createdEpoch]
   * @param {EventStorePosition} [position]
   */
  constructor(eventId, eventType, streamId, eventNumber, data, metadata, createdEpoch, position) {
    if (typeof eventId !== 'string') throw new TypeError("eventId must be a string");
    if (typeof eventType !== 'string') throw new TypeError("eventType must be a string");
    if (typeof streamId !== 'string') throw new TypeError("streamId must be a string");
    if (typeof eventNumber !== 'number') throw new TypeError("eventNumber must be a number");
    if (typeof data !== 'object') throw new TypeError("data must be an object");
    if (metadata && typeof metadata !== 'object') throw new TypeError("metadata must be an object");
    if (position && !(position instanceof Position)) throw new TypeError("position must be a Position");
    if (createdEpoch && typeof createdEpoch !== 'number') throw new TypeError("createdEpoch must be a number");
    if (position) this.position = position;
    this.eventId = eventId;
    this.eventType = eventType;
    this.streamId = streamId;
    this.eventNumber = eventNumber;
    this.data = data;
    this.metadata = metadata;
    this.createdEpoch = createdEpoch;
    Object.freeze(this);
  }

  /**
   * @param {object} obj
   * @returns {EventData}
   */
  static fromObject(obj) {
    const {position, eventId, eventType, streamId, eventNumber, data, metadata, createdEpoch} = obj;
    return new EventData(eventId, eventType, streamId, eventNumber, data, metadata, createdEpoch, position);
  }
}
