export function genNumbers(from, count) {
  const numbers = [];
  for (let n = from; n < from + count; n++) {
    numbers.push(n);
  }
  return numbers;
}

// returns: undefined, object, string, number, boolean, array, null
export function typeOf(v) {
  if (v === null) return 'null';
  const type = typeof v;
  if (type === 'object' && Array.isArray(v)) return 'array';
  return type;
}

export function defer() {
  const d = {};
  d.promise = new Promise((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
}
