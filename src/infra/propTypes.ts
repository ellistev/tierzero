import { validate as validateUuid } from 'uuid';
const isVowel = (x: string) => ['a', 'e', 'i', 'o', 'u'].includes((x || '').toLowerCase());
const aGrammar = (nextWord: string) => isVowel(nextWord[0]) ? 'an' : 'a';

type Class<T> = abstract new (...args: unknown[]) => T

function isValid<T>({type: expectedType, nullable, format, optional, instanceOf, items, schema, oneOf}: PropType, value: T): boolean {
  if (optional && value === undefined) return true;
  if (!optional && value === undefined) return false;
  if (nullable && value === null) return true;
  if (!nullable && value === null) return false;
  if (instanceOf) {
    return value instanceof instanceOf;
  }
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
        for (const val of (value as unknown[])) {
          valid = isValid(items, val);
          if (!valid) return valid;
        }
      }
      return valid;
    case 'object':
      valid = typeof value === 'object';
      if (valid && items) {
        if (Array.isArray(value)) return false;
        const obj = value as Record<string, unknown>;
        for (const val of Object.values(obj)) {
          valid = isValid(items, val);
          if (!valid) return valid;
        }
      } else if (valid && schema) {
        const obj = value as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
          const val = (value as Record<string, unknown>)[key];
          const propType = (schema as Record<string, PropType>)[key];
          valid = !!propType && isValid(propType, val);
          if (!valid) return valid;
        }
      }
      return valid;
    default: {
      valid = false;
    }
  }
  if (!valid) return valid;
  switch (format) {
    case 'uuid':
      return validateUuid(value as string);
    case 'integer':
      return Number.isInteger(value);
  }
  if (!valid) return valid;
  if (oneOf) {
    valid = oneOf.includes(value);
  }
  return valid;
}

function capitalize(x: string) {
  return x[0].toUpperCase() + x.slice(1);
}

function shapeOf(obj: Record<string, unknown>) {
  const parts = Object.keys(obj).map(k => `${k}:${getInstanceTypeName(obj[k])}`);
  return `{${parts}}`;
}

function getInstanceTypeName(x: unknown, precise = false): string {
  if (x === undefined) return 'undefined';
  if (x === null) return 'null';
  const type = typeof x;
  if (precise && type === 'number') {
    if (!Number.isFinite(x)) {
      return x.toString();
    } else if (Number.isInteger(x)) {
      return 'integer Number';
    } else {
      return 'float Number';
    }
  }
  if (Array.isArray(x)) {
    return "Array" + (x[0] ? " of " + getInstanceTypeName(x[0]) : '');
  }
  if (x.constructor.name === 'Object') {
    return `Object of shape ${shapeOf(x as Record<string, unknown>)}`;
  }
  return x.constructor.name;
}

function getFormattedType(propType: PropType) {
  if (propType.instanceOf) {
    return propType.instanceOf.name;
  }
  if (propType.format) {
    return [propType.format, capitalize(propType.type)].join(' ');
  }
  if (propType.oneOf) {
    return `oneOf (${propType.oneOf})`;
  }
  return capitalize(propType.type);
}

function schemaString<T>(schema: PropTypeMap<T>) {
  const parts = Object.keys(schema).map(k => `${k}:${getFormattedType(schema[k as keyof T])}${schema[k as keyof T].nullable?'':'!'}`);
  return `{${parts}}`;
}

function getFullPropTypeName(propType: PropType): string {
  switch (propType.type) {
    case "string":
    case "number":
    case "boolean":
      return getFormattedType(propType);
    case "object": {
      if (propType.instanceOf) return getFormattedType(propType);
      if (propType.schema) return "Object of shape " + schemaString(propType.schema);
      if (propType.items) return "Object map of " + getFullPropTypeName(propType.items);
      return getFormattedType(propType);
    }
    case "array": {
      if (propType.items) return "Array of " + getFullPropTypeName(propType.items);
      return getFormattedType(propType);
    }
    default:
      return "unknown";
  }
}

type FieldError = {
  field: string
  msg?: string
  message?: string
}

class ValidationFailed extends Error {
  public validationErrors: FieldError[];

  constructor(suppliedTo: string, errors: FieldError[]) {
    super(errors.reduce((a, c) => a + ` ${c.field} ${c.msg||c.message}`, `Validation failed${suppliedTo && ` for ${suppliedTo}`}:`));
    this.name = 'ValidationFailed';
    this.validationErrors = errors;
  }
}

function validateAll<T>(propTypes: PropTypeMap, values: NonNullable<T>, suppliedTo = '') {
  return validate(propTypes, values, suppliedTo, 'prop', true);
}

function validate<T>(propTypes: PropTypeMap, values: NonNullable<T>, suppliedTo: string, argType = 'prop', all = false) {
  if (typeof propTypes !== 'object') throw new TypeError('propTypes must be an object');
  if (typeof values !== 'object') throw new TypeError('values must be an object');
  if (typeof suppliedTo !== 'string') throw new TypeError('suppliedTo must be a string');

  const errors = [];
  const propTypes2 = propTypes as Record<string, PropType>;
  for (const propName in propTypes2) {
    const propType = propTypes2[propName];
    if (!propType) throw new Error(`missing propType for ${propName} of ${suppliedTo}`);
    const value = values[propName as keyof PropTypeMap];
    const expectedType = propType.type;
    const valid = isValid(propType, value);
    const typeName = getFullPropTypeName(propType);
    const valueType = getInstanceTypeName(value, expectedType === 'number');
    const received = (x: string) => ['null', 'undefined', 'NaN', 'Infinity'].includes(x) ? x : `${aGrammar(x)} ${x}`;
    const expectedTypeName = propType.nullable ? `nullable ${typeName}` : typeName;
    if (valid) continue;
    if (!all) {
      throw new TypeError(`${argType} ${propName} supplied to ${suppliedTo} must be ${aGrammar(expectedTypeName)} ${expectedTypeName}, received ${received(valueType)}`);
    } else {
      errors.push({ field: propName, msg: `must be ${aGrammar(expectedTypeName)} ${expectedTypeName} received ${received(valueType)}`});
    }
  }
  if (errors.length) throw new ValidationFailed(suppliedTo, errors);
}

const validStringTypes = ['string','number','boolean','array','object'];
const validObjectStringTypes = ['string','number','boolean'];
const validArrayStringTypes = ['string','number','boolean','object'];

export type PropTypeMap<T = unknown> = {
  [K in keyof T]: PropType<T[K]>
}

type PropTypeProps<T> = {
  readonly type: string
  readonly nullable?: boolean
  readonly optional?: boolean
  readonly format?: string
  readonly items?: PropType
  readonly schema?: PropTypeMap<T>
  readonly instanceOf?: Class<T>
  readonly oneOf?: T[]
}

const instanceKey = Symbol('instanceKey');

/**
 * Property type descriptor
 */
export class PropType<T = unknown> {
  readonly type: string;
  readonly format?: string;
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly items?: PropType;
  readonly schema?: PropTypeMap<T>;
  readonly instanceOf?: Class<T>;
  readonly oneOf?: T[];
  readonly [instanceKey]?: {
    type: T
  };

  constructor({type, nullable = true, format, items, schema, optional = false, instanceOf, oneOf}: PropTypeProps<T>) {
    if (!['function', 'string'].includes(typeof type)) throw new TypeError('type must be a string or a function');
    if (typeof nullable !== 'boolean') throw new TypeError('nullable must be a boolean');
    if (format && typeof format !== 'string') throw new TypeError('format must be a string');
    if (items && !(items instanceof PropType)) throw new TypeError('items must be an instance of PropType');
    if (schema && typeof schema !== 'object') throw new TypeError('schema must be an object');

    if (typeof type === 'string' && !validStringTypes.includes(type)) {
      throw new Error(`type must be one of: ${validStringTypes}`);
    }
    if (items && typeof items.type === 'string' && !validArrayStringTypes.includes(items.type)) {
      throw new Error(`items.type must be one of: ${validArrayStringTypes}`);
    }
    if (type === 'object' && schema && Object.keys(schema).map(k => schema[k as keyof T]).some(x => !validObjectStringTypes.includes(x.type))) {
      throw new Error(`shape types must be one of: ${validObjectStringTypes}`);
    }

    this.type = type;
    this.nullable = !!nullable;
    this.optional = !!optional;
    if (format) {
      this.format = format;
    }
    if (items) {
      this.items = items;
    }
    if (schema) {
      this.schema = schema;
    }
    if (instanceOf) {
      this.instanceOf = instanceOf;
    }
    if (oneOf) {
      this.oneOf = oneOf;
    }
    Object.freeze(this);
  }
  get isRequired(): PropType<T> {
    return new PropType<T>({...this, nullable: false, optional: false});
  }
  get isOptional(): PropType<T> {
    return new PropType<T>({...this, optional: true});
  }
  get nonNullable(): PropType<T> {
    return new PropType<T>({...this, nullable: false});
  }
}

type InferInnerProps<P> = P extends PropType<infer T> ? T : unknown
type InferProps<T extends PropTypeMap> = {
  [K in keyof T]: InferInnerProps<T[K]>
}

function oneOf<T extends number|string>(values: T[]): PropType<T> {
  if (!values?.length) throw new TypeError('values cannot be empty');
  if (typeof values[0] === 'string') {
    return new PropType<T>({ type: 'string', oneOf: values });
  }
  if (typeof values[0] === 'number') {
    return new PropType<T>({type: 'number', oneOf: values});
  }
  throw new TypeError('values must be array of strings or numbers');
}

export default {
  validate,
  validateAll,
  string: new PropType<string>({type: 'string'}),
  uuid: new PropType<string>({type: 'string', format: 'uuid'}),
  number: new PropType<number>({type: 'number'}),
  boolean: new PropType<boolean>({type: 'boolean'}),
  bool: new PropType<boolean>({type: 'boolean'}),
  integer: new PropType<number>({type: 'number', format: 'integer'}),
  array: new PropType<unknown[]>({type: 'array'}),
  object: new PropType<Record<string, unknown>>({type: 'object'}),
  instanceOf: <T>(x: Class<T>) => new PropType<T>({type: "object", instanceOf: x}),
  arrayOf: <T>(x: PropType<T>) => new PropType<T[]>({type: 'array', items: x}),
  objectOf: <T>(x: PropType<T>) => new PropType<{[k: string]: T}>({type: 'object', items: x}),
  shape: <P extends PropTypeMap>(x: P) => new PropType<InferProps<P>>({type: 'object', schema: x as PropTypeMap<InferProps<P>>}),
  oneOf,
};
