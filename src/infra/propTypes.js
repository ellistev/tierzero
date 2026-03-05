import { validate as validateUuid } from 'uuid';

const isVowel = (x) => ['a', 'e', 'i', 'o', 'u'].includes((x || '').toLowerCase());
const aGrammar = (nextWord) => isVowel(nextWord[0]) ? 'an' : 'a';

function isValid(propType, value) {
  const { type: expectedType, nullable, format, optional, instanceOf, items, schema, oneOf } = propType;
  if (optional && value === undefined) return true;
  if (!optional && value === undefined) return false;
  if (nullable && value === null) return true;
  if (!nullable && value === null) return false;
  if (instanceOf) return value instanceof instanceOf;
  let valid;
  switch (expectedType) {
    case 'string':
    case 'boolean':
      valid = typeof value === expectedType;
      break;
    case 'number':
      valid = Number.isFinite(value);
      break;
    case 'array':
      valid = Array.isArray(value);
      if (valid && items) {
        for (const val of value) {
          valid = isValid(items, val);
          if (!valid) return valid;
        }
      }
      return valid;
    case 'object':
      valid = typeof value === 'object';
      if (valid && items) {
        if (Array.isArray(value)) return false;
        for (const val of Object.values(value)) {
          valid = isValid(items, val);
          if (!valid) return valid;
        }
      } else if (valid && schema) {
        for (const key of Object.keys(value)) {
          const val = value[key];
          const pt = schema[key];
          valid = !!pt && isValid(pt, val);
          if (!valid) return valid;
        }
      }
      return valid;
    default:
      valid = false;
  }
  if (!valid) return valid;
  switch (format) {
    case 'uuid':
      return validateUuid(value);
    case 'integer':
      return Number.isInteger(value);
  }
  if (oneOf) valid = oneOf.includes(value);
  return valid;
}

function capitalize(x) { return x[0].toUpperCase() + x.slice(1); }

function shapeOf(obj) {
  return '{' + Object.keys(obj).map(k => k + ':' + getInstanceTypeName(obj[k])).join(',') + '}';
}

function getInstanceTypeName(x, precise = false) {
  if (x === undefined) return 'undefined';
  if (x === null) return 'null';
  if (precise && typeof x === 'number') {
    if (!Number.isFinite(x)) return x.toString();
    if (Number.isInteger(x)) return 'integer Number';
    return 'float Number';
  }
  if (Array.isArray(x)) return 'Array' + (x[0] ? ' of ' + getInstanceTypeName(x[0]) : '');
  if (x.constructor.name === 'Object') return 'Object of shape ' + shapeOf(x);
  return x.constructor.name;
}

function getFormattedType(propType) {
  if (propType.instanceOf) return propType.instanceOf.name;
  if (propType.format) return [propType.format, capitalize(propType.type)].join(' ');
  if (propType.oneOf) return 'oneOf (' + propType.oneOf + ')';
  return capitalize(propType.type);
}

function getFullPropTypeName(propType) {
  switch (propType.type) {
    case 'string': case 'number': case 'boolean': return getFormattedType(propType);
    case 'object': {
      if (propType.instanceOf) return getFormattedType(propType);
      if (propType.items) return 'Object map of ' + getFullPropTypeName(propType.items);
      return getFormattedType(propType);
    }
    case 'array': {
      if (propType.items) return 'Array of ' + getFullPropTypeName(propType.items);
      return getFormattedType(propType);
    }
    default: return 'unknown';
  }
}

class ValidationFailed extends Error {
  constructor(suppliedTo, errors) {
    super(errors.reduce((a, c) => a + ' ' + c.field + ' ' + (c.msg || c.message), 'Validation failed' + (suppliedTo ? ' for ' + suppliedTo : '') + ':'));
    this.name = 'ValidationFailed';
    this.validationErrors = errors;
  }
}

function validateAll(propTypes, values, suppliedTo = '') {
  return validate(propTypes, values, suppliedTo, 'prop', true);
}

function validate(propTypes, values, suppliedTo, argType = 'prop', all = false) {
  if (typeof propTypes !== 'object') throw new TypeError('propTypes must be an object');
  if (typeof values !== 'object') throw new TypeError('values must be an object');
  const errors = [];
  for (const propName in propTypes) {
    const propType = propTypes[propName];
    if (!propType) throw new Error('missing propType for ' + propName + ' of ' + suppliedTo);
    const value = values[propName];
    const valid = isValid(propType, value);
    const typeName = getFullPropTypeName(propType);
    const valueType = getInstanceTypeName(value, propType.type === 'number');
    const received = (x) => ['null', 'undefined', 'NaN', 'Infinity'].includes(x) ? x : aGrammar(x) + ' ' + x;
    const expectedTypeName = propType.nullable ? 'nullable ' + typeName : typeName;
    if (valid) continue;
    if (!all) throw new TypeError(argType + ' ' + propName + ' supplied to ' + suppliedTo + ' must be ' + aGrammar(expectedTypeName) + ' ' + expectedTypeName + ', received ' + received(valueType));
    errors.push({ field: propName, msg: 'must be ' + aGrammar(expectedTypeName) + ' ' + expectedTypeName + ' received ' + received(valueType) });
  }
  if (errors.length) throw new ValidationFailed(suppliedTo, errors);
}

const validStringTypes = ['string','number','boolean','array','object'];

class PropType {
  constructor({ type, nullable = true, format, items, schema, optional = false, instanceOf, oneOf }) {
    this.type = type;
    this.nullable = !!nullable;
    this.optional = !!optional;
    if (format) this.format = format;
    if (items) this.items = items;
    if (schema) this.schema = schema;
    if (instanceOf) this.instanceOf = instanceOf;
    if (oneOf) this.oneOf = oneOf;
    Object.freeze(this);
  }
  get isRequired() { return new PropType({ ...this, nullable: false, optional: false }); }
  get isOptional() { return new PropType({ ...this, optional: true }); }
  get nonNullable() { return new PropType({ ...this, nullable: false }); }
}

function oneOf(values) {
  if (!values || !values.length) throw new TypeError('values cannot be empty');
  const type = typeof values[0] === 'string' ? 'string' : typeof values[0] === 'number' ? 'number' : null;
  if (!type) throw new TypeError('values must be array of strings or numbers');
  return new PropType({ type, oneOf: values });
}

export { PropType, ValidationFailed };

export default {
  validate,
  validateAll,
  string: new PropType({ type: 'string' }),
  uuid: new PropType({ type: 'string', format: 'uuid' }),
  number: new PropType({ type: 'number' }),
  boolean: new PropType({ type: 'boolean' }),
  bool: new PropType({ type: 'boolean' }),
  integer: new PropType({ type: 'number', format: 'integer' }),
  array: new PropType({ type: 'array' }),
  object: new PropType({ type: 'object' }),
  instanceOf: (x) => new PropType({ type: 'object', instanceOf: x }),
  arrayOf: (x) => new PropType({ type: 'array', items: x }),
  objectOf: (x) => new PropType({ type: 'object', items: x }),
  shape: (x) => new PropType({ type: 'object', schema: x }),
  oneOf,
};
