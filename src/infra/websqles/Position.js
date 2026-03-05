/**
 * @class
 * @implements EventStorePosition
 */
export default class WebSqlEsPosition {
  constructor(position) {
    if (typeof position !== 'number') throw new TypeError("position must be a number " + typeof position);
    this.value = position;
    Object.freeze(this);
  }

  compareTo(other) {
    if (!(other instanceof WebSqlEsPosition)) throw new TypeError("other must be a Position");
    return this.value - other.value;
  }

  toString() {
    return "" + this.value;
  }

  distance(other) {
    return Math.abs(this.value - other.value);
  }
}
