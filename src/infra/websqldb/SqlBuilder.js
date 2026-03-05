import {genNumbers} from './utils.js';

const SqlOperators = {
  'eq': {operator: '='},
  'neq': {operator: '!='},
  'gt': {operator: '>'},
  'gte': {operator: '>='},
  'lt': {operator: '<'},
  'lte': {operator: '<='},
  'between': {operator: 'BETWEEN', values: true, rhs: pos => `? AND ?`},
  'inq': {operator: 'IN', values: true, rhs: (pos, nb) => `(${genNumbers(pos, nb).map(n => '?')})`},
  'nin': { operator: 'NOT IN', values: true, rhs: (pos, nb) => `(${genNumbers(pos, nb).map((/*n*/) => '?')})` },
  'ilike': {operator: 'LIKE', value: d => `%${d}%`}, //TODO fixme using PRAGMA case_sensitive_like=OFF;
  'and': {operator: 'AND'},
  'or': {operator: 'OR'},
};

const TypeToDbTypeMap = {
  'boolean': 'BOOLEAN',
  'string': 'TEXT',
  'number': 'REAL',
  'object': 'BLOB',
  'array': 'BLOB'
};
const FormatToDbTypeMap = {
  'uuid': 'TEXT'
};

const defaultRHS = pos => `?`;

const formatBinaryValue = v =>
  v ? 'TRUE'
    : v === false
      ? 'FALSE'
      : 'NULL';

export default class SqlBuilder {
  /**
   * Generate INSERT sql
   * @param {string[]} insertColumns
   * @param {string} tableName
   * @returns {string}
   */
  static insert(insertColumns, {tableName}) {
    return `INSERT INTO "${tableName}" (${insertColumns.map(SqlBuilder._quote).join(', ')})` +
      ` VALUES (${insertColumns.map((x) => `:${x}`)})`;
  }

  /**
   * Generate UPSERT sql
   * @param {string[]} insertColumns
   * @param {string} tableName
   * @returns {string}
   */
  static upsert(insertColumns, {tableName}) {
    return `INSERT OR REPLACE INTO "${tableName}" (${insertColumns.map(SqlBuilder._quote).join(', ')})` +
      ` VALUES (${insertColumns.map((x) => `:${x}`)})`;
  }

  /**
   * Generate SELECT sql
   * @param {string} whereSql
   * @param {Order} orderBy
   * @param {string} tableName
   * @param {string[]} columns
   * @returns {string}
   */
  static select(whereSql, orderBy, {tableName, columns}) {
    const orderByList = orderBy.getOrders().map(SqlBuilder._toOrderSql);
    const orderBySql = (orderByList && orderByList.length) ? ` ORDER BY ${orderByList.join(', ')}` : '';
    return `SELECT ${columns.map(SqlBuilder._quote).join(', ')} FROM "${tableName}"${whereSql}${orderBySql}`;
  }

  /**
   * Generate UPDATE sql
   * @param {string[]} setColumns
   * @param {string} whereSql
   * @param {string} tableName
   * @returns {string}
   */
  static update(setColumns, whereSql, {tableName}) {
    const sets = setColumns.map((c, i) => `"${c}" = :${c}`);
    return `UPDATE "${tableName}" SET ${sets.join(', ')}${whereSql}`;
  }

  /**
   * Generate DELETE sql
   * @param {string} whereSql
   * @param {string} tableName
   */
  static delete(whereSql, {tableName}) {
    return `DELETE FROM "${tableName}" ${whereSql}`;
  }

  /**
   * Transform Where to SQL
   * @param {Where} where
   * @param {object[]} values
   * @return {{sql: '', values: []}}
   */
  static toWhereSql(where, values = []) {
    if (where.isEmptyOrNull()) return {sql: '', values};
    const sql = SqlBuilder._visitNode(where.rootNode(), values);
    return {sql: ` WHERE ${sql}`, values};
  }

  /**
   * Transform Where and OrderBy to SQL (for cursor queries)
   * @param {Where} where
   * @param {string[]} orderBy
   * @param {string} nextToken
   * @param {string} tableName
   * @return {{sql: '', values: []}}
   */
  static toWhereCursorSql(where, orderBy, nextToken, { tableName, primaryKey }) {
    if (!nextToken) {
      return SqlBuilder.toWhereSql(where);
    }
    const values = [nextToken];
    const orderField = SqlBuilder._quote(orderBy[0]);
    const idField = SqlBuilder._quote(primaryKey[0]);
    const isAscending = orderBy[1] === 'ASC';
    const cursorSql = `(${orderField} ${isAscending?'>':'<'} (SELECT ${orderField} FROM ${tableName} WHERE ${idField} = $1) OR ` +
      `(${orderField} = (SELECT ${orderField} FROM ${tableName} WHERE ${idField} = $1) AND ${idField} > $1))`;
    if (where.isEmptyOrNull()) {
      return { sql: ` WHERE ${cursorSql}`, values };
    }
    const sql = SqlBuilder._visitNode(where.rootNode(), values);
    return { sql: ` WHERE ${cursorSql} AND ${sql}`, values };
  }

  static createTable({tableName, columns, columnDefs, primaryKey}) {
    const pkSql = `CONSTRAINT pk_${tableName} PRIMARY KEY (${primaryKey.map(SqlBuilder._quote).join(', ')})`;
    //TODO indexes SQL
    const columnTypes = columns.reduce((colTypes, col) => {
      colTypes[col] = SqlBuilder._toColumnType(columnDefs[col], true);
      return colTypes;
    }, {});
    const columnsSql = columns.map(col => `"${col}" ${columnTypes[col]}`).join(',');
    return `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnsSql}, ${pkSql})`;
  }

  static dropTable({tableName}) {
    return `DROP TABLE IF EXISTS "${tableName}"`;
  }

  static createIndexes({tableName, indexes}) {
    return indexes.map((x, i) => `CREATE INDEX IF NOT EXISTS ${tableName}_${i} ON ${tableName} (${x.map(SqlBuilder._quote).join(', ')})`);
  }

  static _toColumnType(columnDef, forCreate) {
    let dbType;
    switch (columnDef.type) {
      case 'string': {
        dbType = FormatToDbTypeMap[columnDef.format];
        if (!dbType) dbType = TypeToDbTypeMap[columnDef.type];
        break;
      }
      default: {
        dbType = TypeToDbTypeMap[columnDef.type];
      }
    }
    if (forCreate && columnDef.nullable === false) dbType += ' NOT NULL';
    return dbType;
  }

  static _toOrderSql(order) {
    if (order[1] === 1) {
      return `${SqlBuilder._quote(order[0])} ASC`;
    }
    if (order[1] === -1) {
      return `${SqlBuilder._quote(order[0])} DESC`;
    }
    throw new Error('Invalid direction.');
  }

  static _visitNode(node, values) {
    let sql = '';
    const key = Object.keys(node)[0];
    const value = node[key];
    if (['or', 'and'].includes(key)) {
      const innerSqls = [];
      for (const child of value) {
        innerSqls.push(SqlBuilder._visitNode(child, values));
      }
      const sqlOperator = SqlOperators[key];
      sql += `(${innerSqls.join(` ${sqlOperator.operator} `)})`;
    } else {
      const operator = Object.keys(value)[0];
      const sqlOperator = SqlOperators[operator];
      //TODO this could be simplified by moving formatting to SqlOperator, i.e. SqlOperator.format(left, right)
      const sqlValue = (sqlOperator.rhs || defaultRHS)(values.length + 1, sqlOperator.values ? value[operator].length : 1);
      const realValue = value[operator];
      const isBinaryValue = [null, true, false].includes(realValue);
      if (sqlOperator === SqlOperators.inq && realValue.length === 0) {
        sql += '1 = 0';
      } else if (sqlOperator === SqlOperators.nin && realValue.length === 0) {
        sql += '1 = 1';
      } else if (sqlOperator === SqlOperators.eq && isBinaryValue) {
        sql += `${SqlBuilder._quote(key)} IS ${formatBinaryValue(realValue)}`;
        return sql;
      } else if (sqlOperator === SqlOperators.neq && isBinaryValue) {
        sql += `${SqlBuilder._quote(key)} IS NOT ${formatBinaryValue(realValue)}`;
        return sql;
      } else {
        sql += `${SqlBuilder._quote(key)} ${sqlOperator.operator} ${sqlValue}`;
      }
      if (sqlOperator.values) {
        values.push(...realValue);
      } else if (sqlOperator.value) {
        values.push(sqlOperator.value(realValue));
      } else {
        values.push(realValue);
      }
    }
    return sql;
  }

  static _quote(col) {
    return `"${col}"`;
  }
}
