import * as util from "util";

/**
 * @implements ITransactionalRepository
 */
export class TransactionalRepository {
  constructor(mapper, modelName, readRepository, batcher, logger) {
    this._mapper = mapper;
    this._modelName = modelName;
    this._logger = logger;
    this._batcher = batcher;
    this._readRepository = readRepository;
    this.create = util.deprecate(this.create.bind(this), 'create is deprecated use create_v2 or upsert');
    this.findOne = util.deprecate(this.findOne.bind(this), 'findOne is deprecated use findOne_v2 or getOne');
    this.findByFilter = util.deprecate(this.findByFilter.bind(this), 'findByFilter is deprecated use findByFilter_v2 or findPaginated');
  }

  /**
   * Create an entity using payload
   * @param {object} payload
   * Note: this actually does an upsert, so save would be a better name
   */
  create(payload) {
    this._batcher.add(this._mapper.upsert(this._batcher.connection, this._modelName, payload));
  }

  /**
   * Create an entity using payload
   * @param {object} payload
   */
  create_v2(payload) {
    this._batcher.add(this._mapper.insert(this._batcher.connection, this._modelName, payload));
  }

  /**
   * Upsert an entity using payload
   * @param {object} payload
   */
  upsert(payload) {
    this._batcher.add(this._mapper.upsert(this._batcher.connection, this._modelName, payload));
  }

  /**
   * Update one entity matching constraints with changes
   * @param {object} where
   * @param {object} changes
   */
  updateOne(where, changes) {
    if (typeof changes !== 'object') {
      throw new TypeError('changes must be an object');
    }
    return this._updateStatic(where, changes);
  }

  /**
   * Update multiple entities matching constraints with the same changes
   * @param {object} where
   * @param {object} changes
   */
  updateWhere(where, changes) {
    return this._updateStatic(where, changes);
  }

  /**
   * @param {object} where
   */
  remove(where) {
    this._batcher.add(this._mapper.remove(this._batcher.connection, this._modelName, where));
  }

  /**
   * @param {object} where
   * @param {boolean} [noThrowOnNotFound]
   */
  findOne(where, noThrowOnNotFound) {
    return this._readRepository.findOne(this._modelName, where, noThrowOnNotFound);
  }

  /**
   * @param {object} where
   */
  findOne_v2(where) {
    return this._readRepository.findOne_v2(this._modelName, where);
  }

  /**
   * @param {object} where
   */
  getOne(where) {
    return this._readRepository.getOne(this._modelName, where);
  }

  /**
   * @param {object} where
   */
  findWhere(where) {
    return this._readRepository.findWhere(this._modelName, where);
  }

  /**
   * @param {Filter} filter
   * @returns {Promise<ReadResult|Object[]>}
   */
  findByFilter(filter) {
    return this._readRepository.findByFilter(this._modelName, filter);
  }

  /**
   * @param {Filter} filter
   * @returns {Promise<Object[]>}
   */
  findByFilter_v2(filter) {
    return this._readRepository.findByFilter_v2(this._modelName, filter);
  }

  /**
   * @param {Filter} filter
   * @returns {Promise<ReadResult>}
   */
  findPaginated(filter) {
    return this._readRepository.findPaginated(this._modelName, filter);
  }

  /**
   * Find all entities
   * @returns {Promise<Object[]>}
   */
  findAll() {
    return this._readRepository.findAll(this._modelName);
  }

  /**
   * @param {object} where
   * @return {Promise<boolean>}
   */
  exists(where) {
    return this._readRepository.exists(this._modelName, where);
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
    return this._readRepository.exec(sql, args);
  }

  /**
   * Expose the (SQL) exec method of the underlying driver/client
   * Note: this method is not portable, so only use it where required (i.e. optimization) and when you are sure the project storage choice is locked down
   * @param sql
   * @param args
   */
  exec(sql, args) {
    if (typeof sql !== 'string') throw new TypeError('sql must be a string');
    const statement = sql.trim().toUpperCase().split(' ')[0];
    if (['INSERT', 'UPDATE', 'DELETE'].includes(statement)) {
      throw new Error('exec sql can only be INSERT, UPDATE or DELETE statements');
    }

    this._batcher.add(this._batcher.connection.exec(sql, args));
  }

  _updateStatic(where, data) {
    this._batcher.add(this._mapper.update(this._batcher.connection, this._modelName, data, where));
  }
}
export default TransactionalRepository;

/**
 * @callback updateOneCallback
 * @param {object} data
 * @returns {object} modified data
 */
