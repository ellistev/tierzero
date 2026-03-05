const defaultKeyHasher = key => key;

/**
 * @param {object} cache
 * @param {function(key:any):Promise<any>} fn
 * @param {function(key:any):string} keyHasher
 * @returns {function(key:any): Promise<any>}
 */
export const memoize = (cache, fn, keyHasher = defaultKeyHasher) => async(key) => {
  const h = keyHasher(key);
  let r = cache[h];
  if (!r) {
    r = cache[h] = await fn(key);
  }
  return r;
};
