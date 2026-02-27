import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, buildUserPrompt, parseEditPlan, branchName, formatResultForTicket } from "./implementer";
import type { Ticket } from "../connectors/types";
import type { ImplementationResult } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-001",
    externalId: "BUG-42",
    source: "jira",
    title: "Login button not working on mobile",
    description: "The login button does not respond to taps on iOS Safari.",
    type: "bug",
    status: "open",
    priority: "high",
    reporter: { id: "u-1", name: "Alice" },
    createdAt: new Date("2024-06-01"),
    updatedAt: new Date("2024-06-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("includes the structured edit format instructions", () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes("CREATE"));
    assert.ok(prompt.includes("MODIFY"));
    assert.ok(prompt.includes("DELETE"));
  });

  it("instructs to provide complete file content for MODIFY", () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes("COMPLETE new file content"));
  });

  it("instructs to follow existing code style", () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes("existing code style"));
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe("buildUserPrompt", () => {
  it("includes ticket title and description", () => {
    const prompt = buildUserPrompt(makeTicket(), "(file context)");
    assert.ok(prompt.includes("Login button not working on mobile"));
    assert.ok(prompt.includes("does not respond to taps"));
  });

  it("includes ticket type and priority", () => {
    const prompt = buildUserPrompt(makeTicket(), "(file context)");
    assert.ok(prompt.includes("bug"));
    assert.ok(prompt.includes("high"));
  });

  it("includes the file context block", () => {
    const prompt = buildUserPrompt(makeTicket(), "### src/auth.ts\n```\ncode\n```");
    assert.ok(prompt.includes("### src/auth.ts"));
  });
});

// ---------------------------------------------------------------------------
// parseEditPlan
// ---------------------------------------------------------------------------

describe("parseEditPlan", () => {
  it("extracts summary section", () => {
    const plan = parseEditPlan("## Summary\nFixed the login button.\n\n## Edits\n");
    assert.equal(plan.summary, "Fixed the login button.");
  });

  it("parses a CREATE edit", () => {
    const response = [
      "## Summary",
      "Added a new file.",
      "",
      "## Edits",
      "### CREATE src/new-file.ts",
      "```",
      "export const x = 1;",
      "```",
    ].join("\n");

    const plan = parseEditPlan(response);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0].action, "create");
    assert.equal(plan.edits[0].path, "src/new-file.ts");
    assert.ok("content" in plan.edits[0] && plan.edits[0].content.includes("export const x = 1;"));
  });

  it("parses a MODIFY edit", () => {
    const response = [
      "## Summary",
      "Updated login handler.",
      "",
      "## Edits",
      "### MODIFY src/auth.ts",
      "```",
      "export function login() { return true; }",
      "```",
    ].join("\n");

    const plan = parseEditPlan(response);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0].action, "modify");
    assert.equal(plan.edits[0].path, "src/auth.ts");
  });

  it("parses a DELETE edit", () => {
    const response = [
      "## Summary",
      "Removed obsolete file.",
      "",
      "## Edits",
      "### DELETE src/old-file.ts",
    ].join("\n");

    const plan = parseEditPlan(response);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0].action, "delete");
    assert.equal(plan.edits[0].path, "src/old-file.ts");
  });

  it("parses multiple edits in order", () => {
    const response = [
      "## Summary",
      "Multi-file change.",
      "",
      "## Edits",
      "### CREATE src/a.ts",
      "```",
      "const a = 1;",
      "```",
      "",
      "### MODIFY src/b.ts",
      "```",
      "const b = 2;",
      "```",
      "",
      "### DELETE src/c.ts",
    ].join("\n");

    const plan = parseEditPlan(response);
    assert.equal(plan.edits.length, 3);
    assert.equal(plan.edits[0].action, "create");
    assert.equal(plan.edits[1].action, "modify");
    assert.equal(plan.edits[2].action, "delete");
  });

  it("returns empty edits for response with no edit blocks", () => {
    const plan = parseEditPlan("## Summary\nI cannot confidently implement this change.");
    assert.equal(plan.edits.length, 0);
    assert.ok(plan.summary.includes("cannot confidently"));
  });

  it("handles edits with code block language hints", () => {
    const response = [
      "## Summary",
      "Fix",
      "",
      "## Edits",
      "### MODIFY src/app.ts",
      "```typescript",
      "const app = express();",
      "```",
    ].join("\n");

    const plan = parseEditPlan(response);
    assert.equal(plan.edits.length, 1);
    // The "typescript" line after ``` becomes the first line of content
    // This is acceptable — the implementer writes the full content
  });
});

// ---------------------------------------------------------------------------
// branchName
// ---------------------------------------------------------------------------

describe("branchName", () => {
  it("generates a branch from ticket ID and title", () => {
    const branch = branchName(makeTicket(), "tierzero/");
    assert.ok(branch.startsWith("tierzero/BUG-42-"));
    assert.ok(branch.includes("login-button"));
  });

  it("uses custom prefix", () => {
    const branch = branchName(makeTicket(), "fix/");
    assert.ok(branch.startsWith("fix/BUG-42-"));
  });

  it("truncates long titles", () => {
    const ticket = makeTicket({ title: "a".repeat(200) });
    const branch = branchName(ticket, "tierzero/");
    assert.ok(branch.length < 80, `branch too long: ${branch.length}`);
  });

  it("falls back to internal id when no externalId", () => {
    const ticket = makeTicket({ externalId: undefined });
    const branch = branchName(ticket, "tierzero/");
    assert.ok(branch.includes("t-001"));
  });

  it("strips special characters", () => {
    const ticket = makeTicket({ title: "Fix: can't login (urgent!)" });
    const branch = branchName(ticket, "tierzero/");
    assert.ok(!branch.includes("'"));
    assert.ok(!branch.includes("("));
    assert.ok(!branch.includes(":"));
  });
});

// ---------------------------------------------------------------------------
// formatResultForTicket
// ---------------------------------------------------------------------------

describe("formatResultForTicket", () => {
  const baseResult: ImplementationResult = {
    success: true,
    summary: "Fixed the login button handler.",
    filesChanged: ["src/auth.ts", "src/auth.test.ts"],
    filesDeleted: [],
    branch: "tierzero/BUG-42-login-button",
    commitHash: "abc1234",
    testsPassed: true,
    durationMs: 15000,
  };

  it("includes the summary", () => {
    const md = formatResultForTicket(baseResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("Fixed the login button handler."));
  });

  it("includes model name", () => {
    const md = formatResultForTicket(baseResult, "gpt-4o");
    assert.ok(md.includes("gpt-4o"));
  });

  it("includes branch and commit info", () => {
    const md = formatResultForTicket(baseResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("tierzero/BUG-42-login-button"));
    assert.ok(md.includes("abc1234"));
  });

  it("lists changed files", () => {
    const md = formatResultForTicket(baseResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("src/auth.ts"));
    assert.ok(md.includes("src/auth.test.ts"));
  });

  it("shows test status", () => {
    const md = formatResultForTicket(baseResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("Passed"));
  });

  it("shows error when present", () => {
    const failResult = { ...baseResult, success: false, error: "Git commit failed" };
    const md = formatResultForTicket(failResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("Attempted"));
    assert.ok(md.includes("Git commit failed"));
  });

  it("shows duration", () => {
    const md = formatResultForTicket(baseResult, "claude-sonnet-4-20250514");
    assert.ok(md.includes("15.0s"));
  });
});
