/**
 * @implements IReadRepository
 */
export default class ConsistentReadRepository {
  constructor({ logger, metrics }, eventualConsistency, inner) {
    this._logger = logger;
    this._metrics = metrics;
    this._eventualConsistency = eventualConsistency;
    this._inner = inner;
  }

  /**
   * Find one entity of a readModel matching where constraints
   * @param {string}  modelName       readModel name
   * @param {Object}  where           find entity matching the where
   * @param {boolean} [noThrowOnNotFound] Set to true if you don't want an error thrown if no result are found
   * @returns {Promise<Object>}
   */
  findOne(modelName, where, noThrowOnNotFound) {
    return this._inner.findOne(modelName, where, noThrowOnNotFound);
  }

  /**
   * Get one entity of a readModel matching where constraints
   * @param {string}    modelName       readModel name
   * @param {Object}    where           find entity matching the where
   * @param {Object}   [options]        optional options
   * @param {string[]} [options.fields] fields to return
   * @returns {Promise<Object>}
   * @throws {Error} if not found
   */
  async getOne(modelName, where, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!where) {
      throw new Error(`where is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.getOne(modelName, where, options);
  }

  /**
   * Find one entity of a readModel matching where constraints
   * @param {string}   modelName        readModel name
   * @param {Object}   where            find entity matching the where
   * @param {Object}   [options]        optional options
   * @param {string[]} [options.fields] fields to return
   * @returns {Promise<Object>}         returns null if not found
   */
  async findOne_v2(modelName, where, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!where) {
      throw new Error(`where is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findOne_v2(modelName, where, options);
  }

  /**
   * Find multiple entities of a readModel
   * @param {string}      modelName       readModel name
   * @param {Object}      where           find entities matching the where constraints
   * @param {Object}     [options]        options
   * @param {string[]}   [options.fields] fields to return
   * @returns {Promise<Object[]>}
   */
  async findWhere(modelName, where, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!where) {
      throw new Error(`where is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findWhere(modelName, where, options);
  }

  /**
   * Find by filter
   * @param {string}    modelName
   * @param {Filter|{}} filter
   * @param {Object}    [options]
   * @returns {Promise<ReadResult|Object[]>}
   */
  async findByFilter(modelName, filter, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!filter) {
      throw new Error(`filter is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findByFilter(modelName, filter, options);
  }

  /**
   * Find by filter cursor
   * @param {string}     modelName
   * @param {Filter|{}}  filter
   * @param {Object}    [options]
   * @returns {Promise<Object[]>}
   */
  async findByFilter_v2(modelName, filter, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!filter) {
      throw new Error(`filter is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findByFilter_v2(modelName, filter, options);
  }

  /**
   * Find by filter paginated
   * @param {string}     modelName
   * @param {Filter|{}}  filter
   * @param {Object}    [options]
   * @returns {Promise<ReadResult>}
   */
  async findPaginated(modelName, filter, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!filter) {
      throw new Error(`filter is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findPaginated(modelName, filter, options);
  }

  /**
   * Find by filter cursor
   * @param {string}           modelName
   * @param {FilterCursor|{}}  filter
   * @param {Object}          [options]
   * @returns {Promise<ReadResultCursor>}
   */
  async findCursor(modelName, filter, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!filter) {
      throw new Error(`filter is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findCursor(modelName, filter, options);
  }

  /**
   * Find all entities of a readModel
   * @param {string}    modelName       readModel name
   * @param {Object}   [options]
   * @param {string[]} [options.fields] fields to return
   * @returns {Promise<Object[]>}
   */
  async findAll(modelName, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.findAll(modelName, options);
  }

  /**
   * Does an entity exists
   * @param {string}  modelName    readModel name
   * @param {Object}  where        entity matching the where constraints
   * @param {Object} [options]
   * @returns {Promise<boolean>}
   */
  async exists(modelName, where, options = {}) {
    if (!modelName) {
      throw new Error(`modelName is required`);
    }
    if (!where) {
      throw new Error(`where is required`);
    }
    const { minPos, consistent, timeout } = options;
    if (minPos || consistent) {
      await this._eventualConsistency.waitFor(modelName, minPos ?? null, timeout);
    }
    return this._inner.exists(modelName, where, options);
  }
}
