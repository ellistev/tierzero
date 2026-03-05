/**
 * @implements {WebApiResponse}
 */
import PropTypes from "../propTypes.js";

class RestApiResponse {
  /**
   * @param {number} statusCode
   * @param {string|object} data
   */
  constructor(statusCode, data) {
    this.statusCode = statusCode;
    this.data = typeof data === 'string' ? { message: data } : data;
    Object.freeze(this);
  }
}

const FilterPropTypes = {
  where: PropTypes.object.isOptional,
  order: PropTypes.arrayOf(PropTypes.string.isRequired).isOptional,
  skip: PropTypes.number.isOptional,
  limit: PropTypes.number.isOptional,
  paging: PropTypes.boolean.isOptional,
};

/**
 * @implements {WebApi}
 */
export default class RestApi {
  constructor({app, logger, commands, authenticator}, name, version) {
    this._commands = commands;
    this._app = app;
    this._logger = logger;
    this._name = name;
    this._version = version;
    this._authenticator = authenticator;
  }

  // multi signatures:
  //  name, TOutput, handler
  //  name, TOutput, TInput, handler
  command(name, TOutput, TInput, handler) {
    if (handler === undefined) {
      TInput = handler;
      TInput = TOutput;
    }

    if (!name) throw new Error('name is missing');
    if (!TOutput) throw new Error('TOutput is missing');
    if (!TInput) throw new Error('TInput is missing');
    if (!handler) throw new Error('handler is missing');
    if (typeof name !== 'string') throw new TypeError('name must a string');
    if (typeof TOutput !== 'function' || typeof TOutput.propTypes !== 'object') {
      throw new TypeError('TOutput must be a class with propTypes');
    }
    if (typeof TInput !== 'function' || typeof TInput.propTypes !== 'object') {
      throw new TypeError('TInput must be a class with propTypes');
    }
    if (typeof handler !== 'function') throw new TypeError('handler must an function');

    this._app.post(`/api/v${this._version}/${this._name}/${name}`, this._authenticator, async(req, res) => {
      try {
        req.args = TInput.fromObject(req.body);
        const resOrData = await handler(req);
        if (resOrData instanceof RestApiResponse) {
          return res.status(resOrData.statusCode).json(resOrData.data);
        }
        return res.status(201).json(resOrData);
      } catch (err) {
        this._logger.warn("Request failed:", err.stack);
        if (err.name === 'ValidationFailed') {
          return res.status(400).json({message: err.message, validationErrors: err.validationErrors});
        }
        return res.status(500).json({message: err.message});
      }
    });
  }

  // multi signatures:
  //  name, readModel, handler
  //  name, readModel, customTInput, handler
  findOne(name, readModel, customTInput, handler) {
    if (handler === undefined) {
      handler = customTInput;
      customTInput = undefined;
    }
    if (!name) throw new Error('name is missing');
    if (!readModel) throw new Error('readModel is missing');
    if (!handler) throw new Error('handler is missing');
    if (typeof name !== 'string') throw new TypeError('name must a string');
    if (customTInput !== undefined && (typeof customTInput !== 'function' || typeof customTInput.propTypes !== 'object')) {
      throw new TypeError('customTInput must be a class with propTypes');
    }
    if (typeof handler !== 'function') throw new TypeError('handler must an function');

    this._app.get(`/api/v${this._version}/${this._name}/${name}`, this._authenticator, this._wrapReadHandler(handler, customTInput));
  }

  // multi signatures:
  //  name, customTInput, handler
  //  name, handler
  findByFilter(name, readModel, customTInput, handler) {
    if (handler === undefined) {
      handler = customTInput;
      customTInput = undefined;
    }
    if (!name) throw new Error('name is missing');
    if (!handler) throw new Error('handler is missing');
    if (typeof name !== 'string') throw new TypeError('name must a string');
    if (customTInput !== undefined && (typeof customTInput !== 'function' || typeof customTInput.propTypes !== 'object')) {
      throw new TypeError('customTInput must be a class with propTypes');
    }
    if (typeof handler !== 'function') throw new TypeError('handler must an function');

    this._app.get(`/api/v${this._version}/${this._name}/${name}`, this._authenticator, this._wrapReadHandler(handler, customTInput));
  }

  _wrapReadHandler(handler, customTInput) {
    return async(req, res) => {
      try {
        if (customTInput) {
          req.args = customTInput.fromObject(req.query);
        } else {
          let { filter } = req.query;
          if (!filter) {
            filter = {};
          } else if (typeof filter === 'string') {
            filter = JSON.parse(filter);
          }
          PropTypes.validateAll(FilterPropTypes, filter, 'Filter');
          req.args = {filter};
        }

        const resOrData = await handler(req);
        if (resOrData instanceof RestApiResponse) {
          return res.status(resOrData.statusCode).json(resOrData.data);
        }
        return res.json(resOrData);
      } catch (err) {
        this._logger.warn('Request failed:', err.stack);
        if (err.name === 'ValidationFailed') {
          return res.status(400).json({message: err.message, validationErrors: err.validationErrors});
        } else if (err.name === 'NotFound' || err.code === 'NotFound' || err.notFound) {
          return res.status(404).json({message: err.message});
        }
        return res.status(500).json({message: err.message});
      }
    };
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  ok(data = {}) {
    return new RestApiResponse(200, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  created(data = {}) {
    return new RestApiResponse(201, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  badRequest(data = {}) {
    return new RestApiResponse(400, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  unauthorized(data = {}) {
    return new RestApiResponse(401, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  forbidden(data = {}) {
    return new RestApiResponse(403, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  notFound(data = {}) {
    return new RestApiResponse(404, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  conflict(data = {}) {
    return new RestApiResponse(409, data);
  }

  /**
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  error(data = {}) {
    return new RestApiResponse(500, data);
  }

  /**
   * @param {number} statusCode
   * @param {string|object} data
   * @returns {RestApiResponse}
   */
  custom(statusCode, data = {}) {
    return new RestApiResponse(statusCode, data);
  }
}
