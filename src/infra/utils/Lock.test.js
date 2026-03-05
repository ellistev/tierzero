import Lock from "./Lock.js";
import {delay} from "./time.js";

let lock;

beforeEach(() => {
  lock = new Lock();
});

test("acquire", async() => {
  await expect(lock.acquire()).resolves.toBeUndefined();
});
test("acquire / acquire", async() => {
  await expect(lock.acquire()).resolves.toBeUndefined();
  const locked = lock.acquire();
  expect(locked).toBeInstanceOf(Promise);
  const timeout = (async() => { await delay(5); return 'timeout'; })();
  await expect(Promise.race([locked, timeout])).resolves.toBe('timeout');
});
test("acquire / acquire / release / acquire / release", async() => {
  await expect(lock.acquire()).resolves.toBeUndefined();
  expect(lock.acquire()).toBeInstanceOf(Promise);
  lock.release();
  expect(lock.acquire()).toBeInstanceOf(Promise);
  lock.release();
  lock.release();
  await expect(lock.acquire()).resolves.toBeUndefined();
});
test("locked", async() => {
  const nb = 1000;
  let cpt = 0;
  await expect(lock.acquire()).resolves.toBeUndefined();
  const q = [];
  for (let i = 0; i < nb; i++) {
    q.push(lock.acquire().then(() => cpt++));
  }
  const pall = Promise.all(q);
  for (let i = 0; i < nb; i++) {
    lock.release();
  }
  const r = await pall;
  for (let i = 0; i < nb; i++) {
    expect(r[i]).toBe(i);
  }
});
