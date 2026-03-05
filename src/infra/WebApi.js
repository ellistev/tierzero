/**
 * @interface
 */
class WebApiResponse {}

/**
 * @interface
 */
class WebApi {
  /**
   * @param {string} name
   * @param {function} TCommand
   * @param {function} TInput
   * @param {function} [handler]
   */
  command(name, TCommand, TInput, handler) {
    throw new Error("not implemented");
  }

  /**
   * @param {string} queryName
   * @param {ReadModel} readModel
   * @param {function} TInput
   * @param {function} [handler]
   */
  findOne(queryName, readModel, TInput, handler) {
    throw new Error("not implemented");
  }

  /**
   * @param {string} queryName
   * @param {ReadModel} readModel
   * @param {function} TInput
   * @param {function} [handler]
   */
  findByFilter(queryName, readModel, TInput, handler) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  ok(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  created(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  badRequest(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  unauthorized(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  forbidden(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  notFound(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  conflict(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  error(data = {}) {
    throw new Error("not implemented");
  }
  /**
   * @param {number} statusCode
   * @param {string|object} data
   * @returns {WebApiResponse}
   */
  custom(statusCode, data = {}) {
    throw new Error("not implemented");
  }
}

/**
 * @callback webApiFactory
 * @param {string} name
 * @param {number} version
 * @returns {WebApi}
 */
