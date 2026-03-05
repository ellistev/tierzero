export const jsonSerializeWithBigInt = (value, replacer, space) => {
  function replaceBigInt(key, value) {
    //TODO chain replacer
    if (typeof value === 'bigint') {
      return `${value}n`;
    }
    return value;
  }
  return JSON.stringify(value, replaceBigInt, space)
}

const bigIntRegEx = /^\d+n$/;
export const jsonParseWithBigInt = (text, reviver) => {
  function bigIntReviver(key, value) {
    //TODO chain reviver
    if (typeof value === 'string' && value.match(bigIntRegEx)) {
      return BigInt(value.slice(0, value.length - 1));
    }
    return value;
  }
  return JSON.parse(text, bigIntReviver);
}
