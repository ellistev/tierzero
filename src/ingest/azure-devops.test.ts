import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pagePathToFilename, formatWorkItem } from "./azure-devops";
import { slugify } from "./types";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    assert.equal(slugify("Password Reset"), "password-reset");
  });

  it("removes punctuation", () => {
    assert.equal(slugify("How to Fix VPN (Step-by-Step)!"), "how-to-fix-vpn-step-by-step");
  });

  it("collapses multiple dashes", () => {
    assert.equal(slugify("hello   world"), "hello-world");
  });

  it("trims leading and trailing dashes", () => {
    assert.equal(slugify("  -hello- "), "hello");
  });

  it("handles empty string", () => {
    assert.equal(slugify(""), "");
  });

  it("handles strings with only punctuation", () => {
    assert.equal(slugify("!@#$%"), "");
  });
});

// ---------------------------------------------------------------------------
// pagePathToFilename
// ---------------------------------------------------------------------------

describe("pagePathToFilename", () => {
  it("converts a simple wiki path to a filename", () => {
    assert.equal(pagePathToFilename("/Runbooks/Password Reset"), "runbooks-password-reset.md");
  });

  it("handles root page path", () => {
    assert.equal(pagePathToFilename("/"), "index.md");
  });

  it("handles a single-segment path", () => {
    assert.equal(pagePathToFilename("/Home"), "home.md");
  });

  it("strips leading slash for nested paths", () => {
    assert.equal(pagePathToFilename("/IT/Network/VPN Setup Guide"), "it-network-vpn-setup-guide.md");
  });

  it("handles special characters in path segments", () => {
    assert.equal(pagePathToFilename("/How-To's/Reset (AD) Password"), "how-tos-reset-ad-password.md");
  });

  it("always ends with .md", () => {
    assert.match(pagePathToFilename("/Docs/README"), /\.md$/);
  });
});

// ---------------------------------------------------------------------------
// formatWorkItem
// ---------------------------------------------------------------------------

describe("formatWorkItem", () => {
  it("renders all fields correctly", () => {
    const result = formatWorkItem({
      id: 42,
      title: "Fix login timeout",
      description: "Users get logged out after 5 minutes.",
      resolvedReason: "Increased session timeout to 30 minutes in config.",
      workItemType: "Bug",
      resolvedDate: "2024-06-01T00:00:00Z",
    });

    assert.ok(result.includes("# Fix login timeout"), "should include title");
    assert.ok(result.includes("**Type:** Bug"), "should include type");
    assert.ok(result.includes("**Resolved:** 2024-06-01"), "should include resolved date");
    assert.ok(result.includes("## Problem"), "should include Problem header");
    assert.ok(result.includes("Users get logged out after 5 minutes."), "should include description");
    assert.ok(result.includes("## Resolution"), "should include Resolution header");
    assert.ok(result.includes("Increased session timeout to 30 minutes in config."), "should include resolution");
  });

  it("uses closedDate when resolvedDate is absent", () => {
    const result = formatWorkItem({
      id: 1,
      title: "Test",
      closedDate: "2025-01-15T12:00:00Z",
    });
    assert.ok(result.includes("**Resolved:** 2025-01-15"), "should use closedDate");
  });

  it("shows placeholder when description is missing", () => {
    const result = formatWorkItem({ id: 1, title: "No description" });
    assert.ok(result.includes("_No description provided._"));
  });

  it("shows placeholder when resolvedReason is missing", () => {
    const result = formatWorkItem({ id: 1, title: "No resolution" });
    assert.ok(result.includes("_No resolution details recorded._"));
  });

  it("defaults workItemType to 'Work Item'", () => {
    const result = formatWorkItem({ id: 1, title: "Untitled" });
    assert.ok(result.includes("**Type:** Work Item"));
  });

  it("shows 'unknown' when no date fields are present", () => {
    const result = formatWorkItem({ id: 1, title: "No date" });
    assert.ok(result.includes("**Resolved:** unknown"));
  });
});
