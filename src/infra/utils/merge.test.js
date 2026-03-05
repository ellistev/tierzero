import assert from "assert";
import {merge} from "./index.js";

describe("utils merge tests", function() {
  it("should merge flat objects", () => {
    const result = merge({a: 1, b: 2, c: 3}, {a: 2, d: 4});
    assert.deepStrictEqual(result, {a: 2, b: 2, c: 3, d: 4});
  });
  it("should merge nested objects", () => {
    const result = merge({a: "1", b: 2, c: 3, e: {f: 1}}, {a: 2, d: 4, e: {f: 3}});
    assert.deepStrictEqual(result, {a: 2, b: 2, c: 3, d: 4, e: {f: 3}});
  });
});
