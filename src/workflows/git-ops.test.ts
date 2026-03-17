import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitOps } from "./git-ops";

describe("GitOps.branchName", () => {
  it("creates slug from issue number and title", () => {
    const name = GitOps.branchName(42, "Fix adaptive browser retry logic");
    assert.equal(name, "tierzero/42-fix-adaptive-browser-retry-logic");
  });

  it("strips special characters", () => {
    const name = GitOps.branchName(7, "Add support for @mentions & #tags!");
    assert.equal(name, "tierzero/7-add-support-for-mentions-tags");
  });

  it("truncates long titles to 40 chars", () => {
    const name = GitOps.branchName(1, "This is a very long issue title that should be truncated to prevent overly long branch names");
    const slug = name.replace("tierzero/1-", "");
    assert.ok(slug.length <= 40, `Slug "${slug}" should be <= 40 chars`);
  });

  it("handles empty title", () => {
    const name = GitOps.branchName(99, "");
    assert.equal(name, "tierzero/99-");
  });

  it("handles title with only special chars", () => {
    const name = GitOps.branchName(5, "!@#$%^&*()");
    assert.equal(name, "tierzero/5-");
  });

  it("lowercases the title", () => {
    const name = GitOps.branchName(10, "FIX NPE In UserService");
    assert.equal(name, "tierzero/10-fix-npe-in-userservice");
  });
});

describe("GitOps constructor", () => {
  it("accepts minimal config", () => {
    const git = new GitOps({ cwd: "/tmp/test" });
    assert.ok(git);
  });

  it("accepts custom remote", () => {
    const git = new GitOps({ cwd: "/tmp/test", remote: "upstream" });
    assert.ok(git);
  });
});
