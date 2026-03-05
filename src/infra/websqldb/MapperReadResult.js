/**
 * @class
 * @property {Object[]} results
 * @property {?number} total
 */
export default class MapperReadResult {
  /**
   * @param {Object[]} results
   * @param {number} [total]
   */
  constructor(results, total) {
    this.results = results;
    this.total = total;
  }
}
