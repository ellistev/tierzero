export const isClassWithMetadata = x =>
  typeof x === 'function' &&
  typeof x.type === 'string' &&
  typeof x.propTypes === 'object';
