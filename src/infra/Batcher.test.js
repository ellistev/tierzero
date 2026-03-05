/* global jest expect describe beforeEach test */
import Batcher from './Batcher.js';

describe('given a new Batcher', function() {
  let batcher, conn;
  beforeEach(() => {
    conn = {
      beginBatch: jest.fn(),
      endBatch: jest.fn()
    };
    batcher = new Batcher(conn);
  });
  test('with endBatch(commit) not throwing', async function() {
    try {
      await batcher.begin();
      await batcher.end();
    } catch (err) {
      await batcher.dispose();
    }
    expect(conn.beginBatch).toHaveBeenCalledTimes(1);
    expect(conn.endBatch).toHaveBeenCalledTimes(1);
    expect(conn.endBatch).toHaveBeenLastCalledWith(true);
  });
  test('with endBatch(commit) throwing', async function() {
    conn.endBatch.mockRejectedValueOnce(new Error('whatever'));
    try {
      await batcher.begin();
      await batcher.end();
    } catch (err) {
      await batcher.dispose();
    }
    expect(conn.beginBatch).toHaveBeenCalledTimes(1);
    expect(conn.endBatch).toHaveBeenCalledTimes(1);
    expect(conn.endBatch).toHaveBeenLastCalledWith(true);
  });
  test('calling dispose twice should throw', async function() {
    let caught = {};
    try {
      await batcher.dispose();
      await batcher.dispose();
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toMatch(/invalid state disposed for operation dispose/);
  });
});
