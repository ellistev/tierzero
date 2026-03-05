/* eslint-disable @typescript-eslint/no-var-requires */
import fs from "./runtime/fs.js";
import path from "./runtime/path.js";
import { deepFreeze } from "./utils/index.js";
import _schema from "../../config/schema.json";

/**
 * @param {string} configFilePath
 * @param {string[]} [args=null]
 * @param {?string} [envPrefix=null]
 * @param {Object} [schema]
 * @returns {Object}
 */
export function loadConfig(configFilePath, args = null, envPrefix = null, schema = _schema) {
  const config = require(path.resolve(configFilePath));
  if (args) loadFromArgs(config, args, schema);
  if (envPrefix) loadFromEnv(config, schema, [envPrefix]);
  return deepFreeze(config);
}

/**
 * @deprecated use loadConfig
 * @param {string} configFilePath
 * @param {string} envPrefix
 * @returns {Object}
 */
export function loadConfigWithEnv(configFilePath, envPrefix) {
  const config = require(path.resolve(configFilePath));
  loadFromEnv(config, _schema, [envPrefix]);
  return deepFreeze(config);
}

const isUpperCase = (str, index) => str.charCodeAt(index) >= 65 && str.charCodeAt(index) <= 90;

const splitCamelCase = key => {
  const out = [];
  let start = 0, previous;
  for (let i = 1; i < key.length; i++) {
    if (!isUpperCase(key, i)) continue;
    const part = key.slice(start, i);
    if (part.length === 1 && previous && previous.length === 1) {
      out[out.length - 1] += part;
    } else {
      out.push(part);
    }
    start = i;
    previous = part;
  }
  const part = key.slice(start);
  if (part.length === 1 && previous && previous.length === 1) {
    out[out.length - 1] += part;
  } else {
    out.push(part);
  }
  return out;
};

function parseValue(value, type) {
  if (typeof value === 'undefined') return;
  switch (type) {
    case 'string':
      // an empty string is already falsy
      return value;
    case 'number':
      if (value === '') return null;
      return parseFloat(value);
    case 'boolean':
      if (value === '') return null;
      return !(value === '0' || value === 'false' || value === 'False');
    case 'object':
      if (value === '' || value === '0') return null;
      return;
    default:
      return;
  }
}

function loadFromEnv(config, schema, context = []) {
  const env = process.env;
  const { properties, additionalProperties } = schema;
  for (const key in properties) {
    const { type } = properties[key];
    context.push(key);
    const envVarName = context.map(x => splitCamelCase(x).map(x => x.toUpperCase()).join('_')).join('_');
    const envValue = parseValue(env[envVarName], type);
    if (envValue === null) {
      delete config[key];
    } else if (type === 'object') {
      const value = config[key] || {};
      loadFromEnv(value, properties[key], context);
      if (Object.keys(value).length > 0) {
        config[key] = value;
      }
    } else {
      if (typeof envValue !== 'undefined') {
        config[key] = envValue;
      }
      const envVarNameFile = `${envVarName}_FILE`;
      const envFileValue = env[envVarNameFile];
      if (typeof envFileValue !== 'undefined') {
        const content = fs.readFileSync(envFileValue);
        config[key] = parseValue(content.toString('utf-8').trim(), type);
      }
    }
    context.pop();
  }
  if (additionalProperties) {
    const prefix = context.map(x => splitCamelCase(x).map(x => x.toUpperCase()).join('_')).join('_') + '_';
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.slice(prefix.length).split('_');
      const firstPart = parts.shift();
      const propName = firstPart.toLowerCase() + parts.map(x => x[0] + x.slice(1).toLowerCase()).join('');
      if (propName.endsWith('File')) {
        const content = fs.readFileSync(value);
        config[propName.slice(0, -4)] = content.toString('utf-8').trim();
      } else {
        config[propName] = value;
      }
    }
  }
}

/**
 * @param {Object} config
 * @param {string[]} args
 * @param {Object} schema
 * @param {string[]} context
 */
function loadFromArgs(config, args, schema, context = []) {
  const { properties, additionalProperties } = schema;
  for (const key in properties) {
    const { type } = properties[key];
    let value = config && config[key];
    context.push(key);
    if (type === 'object') {
      value = value || {};
      loadFromArgs(value, args, properties[key], context);
      if (Object.keys(value).length > 0) {
        config[key] = value;
      }
    } else {
      const argNameIndex = args.indexOf('--' + context.map(x => splitCamelCase(x).map(x => x.toLowerCase()).join('-')).join('-'));
      if (argNameIndex >= 0) {
        const argValue = parseValue(args[argNameIndex + 1], type);
        if (typeof argValue !== 'undefined') {
          config[key] = argValue;
        }
      }
    }
    context.pop();
  }
  if (additionalProperties) {
    const prefix = '--' + context.map(x => splitCamelCase(x).map(x => x.toLowerCase()).join('-')).join('-') + '-';
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (!key.startsWith(prefix)) continue;
      const parts = key.slice(prefix.length).split('-');
      const firstPart = parts.shift();
      const propName = firstPart.toLowerCase() + parts.map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).join('');
      i++;
      config[propName] = args[i];
    }
  }
}

const providers = {
  async fromFile(filePath) {
    if (!filePath) return;
    try {
      return (await fs.promises.readFile(filePath)).toString();
    } catch (err) {
      //do nothing
    }
  },
  fromEnv(name) {
    return process.env[name];
  },
  fromConfig(args) {
    const [config, ...keys] = args;
    let node = config;
    for (const key of keys) {
      node = (node || {})[key];
    }
    return node;
  },
  use(value) {
    return value;
  }
};

/**
 * Get config from multiple providers
 * will return an empty string if no default value is specified
 *
 * i.e. getConfig({fromFile: '/tmp/my.key', fromEnv: 'MY_KEY', use: config.myKey})
 *
 * @param {object} providersConfig
 * @param {string} defaultValue
 * @returns {Promise<string>}
 */
export async function getConfig(providersConfig, defaultValue = '') {
  for (const providerName in providersConfig) {
    const value = await providers[providerName](providersConfig[providerName]);
    if (value) return value;
  }
  return defaultValue;
}
