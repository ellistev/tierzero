import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CDP_URL, CHROME_USER_DATA, CHROME_EXE } from "./connection";

describe("connection constants", () => {
  it("CDP_URL points to localhost:18792", () => {
    assert.equal(CDP_URL, "http://localhost:18792");
  });

  it("CHROME_USER_DATA uses openclaw browser dir", () => {
    assert.ok(CHROME_USER_DATA.includes(".openclaw"));
    assert.ok(CHROME_USER_DATA.includes("chrome"));
  });

  it("CHROME_EXE points to Chrome", () => {
    assert.ok(CHROME_EXE.includes("chrome.exe"), "Should reference chrome.exe");
  });
});
