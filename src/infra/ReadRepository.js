import * as util from 'util';

/**
 * @implements IReadRepository
 */
export class ReadRepository {
  constructor(mapper, dbPool, logger) {
    this._mapper = mapper;
    this._dbPool = dbPool;
    this._logger = logger;
    this.findOne = util.deprecate(this.findOne.bind(this), 'findOne is deprecated use findOne_v2 or getOne');
    this.findByFilter = util.deprecate(this.findByFilter.bind(this), 'findByFilter is deprecated use findByFilter_v2 or findPaginated');
  }

  /**
   * Find one entity of a readModel matching where constraints
   * @param {string}  modelName       readModel name
   * @param {Object}  where           find entity matching the where
   * @param {boolean} [noThrowOnNotFound] Set to true if you don't want an error thrown if no result are found
   * @returns {Promise<Object>}
   */
  async findOne(modelName, where, noThrowOnNotFound) {
    if (!modelName) {
      throw new Error(`modelName can't be null.`);
    }
    if (!where) {
      throw new Error(`where can't be null.`);
    }
    const result = await this._mapper.select(this._dbPool, modelName, {where, limit: 1});
    if ((!result || !result.results || !result.results[0]) && !noThrowOnNotFound) {
      const notFoundError = new Error(`No result found for ${modelName} with criteria ${JSON.stringify(where)}.`);
      notFoundError.code = 'NotFound';
      notFoundError.notFound = true;
      throw notFoundError;
    }
    return (result.results[0] || null);
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
      throw new Error(`modelName can't be null.`);
    }
    if (!where) {
      throw new Error(`where can't be null.`);
    }
    const { fields } = options;
    const result = await this._mapper.select(this._dbPool, modelName, {where, fields, limit: 1});
    if ((!result || !result.results || !result.results[0])) {
      const notFoundError = new Error(`No result found for ${modelName} with criteria ${JSON.stringify(where)}.`);
      notFoundError.code = 'NotFound';
      notFoundError.notFound = true;
      throw notFoundError;
    }
    return (result.results[0] || null);
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
      throw new Error(`modelName can't be null.`);
    }
    if (!where) {
      throw new Error(`where can't be null.`);
    }
    const { fields } = options;
    const result = await this._mapper.select(this._dbPool, modelName, {where, fields, limit: 1});
    return (result.results[0] || null);
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
      throw new Error(`modelName can't be null.`);
    }
    if (!where) {
      throw new Error(`where can't be null.`);
    }
    const { fields } = options;
    const result = await this._mapper.select(this._dbPool, modelName, {fields, where});
    return result.results;
  }

  /**
   * Find by filter
   * @param {string}    modelName
   * @param {Filter|{}} filter
   * @param {Object}    [options]
   * @returns {Promise<ReadResult|Object[]>}
   */
  async findByFilter(modelName, filter, options = {}) {
    const result = await this._mapper.select(this._dbPool, modelName, filter);
    if (filter.paging) {
      return result;
    }
    return result.results;
  }

  /**
   * Find by filter cursor
   * @param {string}     modelName
   * @param {Filter|{}}  filter
   * @param {Object}    [options]
   * @returns {Promise<Object[]>}
   */
  async findByFilter_v2(modelName, filter, options = {}) {
    const { results } = await this._mapper.select(this._dbPool, modelName, {
      ...filter,
      paging: false
    });
    return results;
  }

  /**
   * Find by filter paginated
   * @param {string}     modelName
   * @param {Filter|{}}  filter
   * @param {Object}    [options]
   * @returns {Promise<ReadResult>}
   */
  async findPaginated(modelName, filter, options = {}) {
    const { results, total } = await this._mapper.select(this._dbPool, modelName, {
      ...filter,
      paging: true
    });
    return {
      items: results,
      total,
    };
  }

  /**
   * Find by filter cursor
   * @param {string}           modelName
   * @param {FilterCursor|{}}  filter
   * @param {Object}          [options]
   * @returns {Promise<ReadResultCursor>}
   */
  async findCursor(modelName, filter, options = {}) {
    const { results, total, nextToken } = await this._mapper.select(this._dbPool, modelName, {
      ...filter,
      nextToken: filter.nextToken ?? ''
    });
    return {
      items: results,
      total,
      nextToken,
    };
  }

  /**
   * Find all entities of a readModel
   * @param {string}    modelName       readModel name
   * @param {Object}   [options]
   * @param {string[]} [options.fields] fields to return
   * @returns {Promise<Object[]>}
   */
  async findAll(modelName, options = {}) {
    const { fields } = options;
    const result = await this._mapper.select(this._dbPool, modelName, {fields});
    return result.results;
  }

  /**
   * Does an entity exists
   * @param {string}  modelName    readModel name
   * @param {Object}  where        entity matching the where constraints
   * @param {Object} [options]
   * @returns {Promise<boolean>}
   */
  async exists(modelName, where, options = {}) {
    const result = await this._mapper.select(this._dbPool, modelName, {where, limit: 1});
    return !!(result && result.results && result.results.length > 0);
  }

  /**
   * Expose the (SQL) query method of the underlying driver/client
   * Note: this method is not portable, so only use it where required (i.e. optimization) and when you are sure the project storage choice is locked down
   * @async
   * @param {string} sql
   * @param {any[]} args
   * @returns {*}
   */
  query(sql, args) {
    if (typeof sql !== 'string') throw new TypeError('sql must be a string');
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('query sql can only be SELECT statements');
    }

    return this._dbPool.exec(sql, args);
  }
}
export default ReadRepository;

/**
 * @interface Filter
 * @property {?string[]} fields
 * @property {?Object} where
 * @property {?string|string[]} order
 * @property {?number} skip
 * @property {?number} limit
 */

/**
 * @interface ReadResult
 * @property {Object[]} results
 * @property {number}   total
 */

/**
 * @interface PaginatedReadResult
 * @property {Object[]} results
 * @property {number}   total
 */

/**
 * @interface FilterCursor
 * @property {?Object}   where
 * @property {string[]}  orderBy
 * @property {number}    limit
 * @property {?string[]} fields
 * @property {?string}   nextToken
 */

/**
 * @interface ReadResultCursor
 * @property {Object[]} items
 * @property {number}   total
 * @property {?string}  nextToken
 */
