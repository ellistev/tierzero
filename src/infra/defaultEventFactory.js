/**
 * @param {Object} eventsMap
 * @return {eventFactory}
 */
export default function create(eventsMap) {
  return function eventFactory(eventType, json) {
    const eventCls = eventsMap[eventType];
    if (!eventCls) {
      throw new Error(`No event class registered for eventType "${eventType}".`);
    }
    if (Buffer.isBuffer(json)) {
      json = json.toString();
    }
    let eventObject;
    if (typeof json === 'string') {
      eventObject = JSON.parse(json);
    } else if (typeof json === 'object') {
      eventObject = json;
    } else {
      throw new Error(`json must be a string or an object or a Buffer`);
    }
    // This is a total hack that assumes that the anonymous json object matches the target prototype
    eventObject.__proto__ = eventCls.prototype;
    return eventObject;
  };
}

/**
 * @callback eventFactory
 * @param {string} eventType
 * @param {string|object|Buffer} json
 * @returns {object} event
 * @throws {Error} Throws if an event can't be created from the data provided
 */
