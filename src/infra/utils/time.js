export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const hrTimeDiff = (start, end) => {
  end = end ?? process.hrtime();
  return ((end[0] - start[0]) * 1000) + ((end[1] - start[1]) / 1000000);
}

export async function time(fn) {
  const start = process.hrtime();
  const res = await fn();
  return [res, hrTimeDiff(start)];
}

export async function trace(message, fn) {
  const [res, fn_time] = await time(fn);
  console.log(message, fn_time);
  return res;
}
