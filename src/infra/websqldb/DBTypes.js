const TypeMappers = Object.freeze({
  $default: {
    toDb(value) {
      return value;
    },
    fromDb(dbValue) {
      return dbValue;
    }
  },
  "boolean": {
    toDb(value) {
      return value ? 1 : 0;
    },
    fromDb(dbValue) {
      return dbValue !== 0;
    }
  },
  "object": {
    toDb(value) {
      return JSON.stringify(value);
    },
    fromDb(dbValue) {
      return JSON.parse(dbValue);
    }
  },
  "array": {
    toDb(value) {
      return JSON.stringify(value);
    },
    fromDb(dbValue) {
      return JSON.parse(dbValue);
    }
  }
});

function getTypeMapperFor(columnDef) {
  return TypeMappers[columnDef.format] || TypeMappers[columnDef.type] || TypeMappers.$default;
}

/**
 * @param {boolean|object|Array|number|string|null} value
 * @param {object} columnDef
 * @returns {*}
 */
export function mapToDb(value, columnDef) {
  if (value === null) return null;
  const mapper = getTypeMapperFor(columnDef);
  return mapper.toDb(value);
}

export function mapRowToDb(row, columnDefs) {
  const dbRow = {};
  for (const column of Object.keys(row)) {
    dbRow[column] = mapToDb(row[column], columnDefs[column]);
  }
  return dbRow;
}

export function mapFromDb(dbValue, columnDef) {
  if (dbValue === null) return null;
  const mapper = getTypeMapperFor(columnDef);
  return mapper.fromDb(dbValue);
}

export function mapRowFromDb(row, modelDef) {
  const obj = {};
  for (const column of modelDef.columns) {
    obj[column] = mapFromDb(row[column], modelDef.columnDefs[column]);
  }
  return obj;
}
