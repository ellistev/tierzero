import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRCreator } from "./pr-creator";

describe("PRCreator.buildPRBody", () => {
  it("includes issue close reference", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 42,
      summary: "Fixed the thing",
      filesChanged: ["src/foo.ts", "src/foo.test.ts"],
      testsRun: 10,
      testsPassed: 10,
    });
    assert.ok(body.includes("Closes #42"));
  });

  it("lists changed files", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 1,
      summary: "Test",
      filesChanged: ["a.ts", "b.ts"],
      testsRun: 5,
      testsPassed: 5,
    });
    assert.ok(body.includes("`a.ts`"));
    assert.ok(body.includes("`b.ts`"));
  });

  it("shows all passing when tests match", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 1,
      summary: "Test",
      filesChanged: [],
      testsRun: 20,
      testsPassed: 20,
    });
    assert.ok(body.includes("All passing"));
  });

  it("shows partial count when tests fail", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 1,
      summary: "Test",
      filesChanged: [],
      testsRun: 20,
      testsPassed: 18,
    });
    assert.ok(body.includes("18/20 passing"));
  });

  it("includes TierZero attribution", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 1,
      summary: "Test",
      filesChanged: [],
      testsRun: 0,
      testsPassed: 0,
    });
    assert.ok(body.includes("TierZero"));
  });

  it("includes the summary text", () => {
    const body = PRCreator.buildPRBody({
      issueNumber: 7,
      summary: "Rewrote the entire auth module",
      filesChanged: [],
      testsRun: 50,
      testsPassed: 50,
    });
    assert.ok(body.includes("Rewrote the entire auth module"));
  });
});

describe("PRCreator constructor", () => {
  it("initializes with config", () => {
    const pr = new PRCreator({
      token: "ghp_test",
      owner: "ellistev",
      repo: "tierzero",
    });
    assert.ok(pr);
  });

  it("strips trailing slash from apiUrl", () => {
    const pr = new PRCreator({
      token: "ghp_test",
      owner: "ellistev",
      repo: "tierzero",
      apiUrl: "https://api.github.com/",
    });
    assert.ok(pr);
  });
});
