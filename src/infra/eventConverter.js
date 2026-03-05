import eventConverters from "../converters/index.js";

export default function factory(/*services*/) {
  const validConverters = eventConverters.filter(isValidConverter);
  const map = validConverters.reduce((a,c) => {a[c.fromEventType]=c;return a;}, {});
  /**
   * @param {EventStoreData} esData
   */
  return function eventConverter(esData) {
    /** @type {EventConverter} */
    const converter = map[esData.eventType];
    if (!converter) return esData;
    const convertedType = converter.toEventType;
    const convertedData = converter.convert(esData.data);
    const converted = {
      ...esData,
      data: convertedData,
      eventType: convertedType
    };
    return eventConverter(converted);
  };
}

function isValidConverter(c) {
  return isNonNullString(c.fromEventType) &&
    isNonNullString(c.toEventType) &&
    typeof c.convert === 'function';
}

function isNonNullString(s) {
  return s !== null && typeof s === 'string';
}

/**
 * @interface EventConverter
 * @property {string}   fromEventType
 * @property {string}   toEventType
 * @property {function} convert
 */
