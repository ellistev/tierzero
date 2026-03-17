import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports, GitHubConnector } from "./github";

const { inferPriority, inferType, mapStatus, toTicket, toComment } = _testExports;

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function makeLabel(name: string) {
  return { id: 1, name, color: "000000" };
}

describe("inferPriority", () => {
  it("maps p0 to critical", () => {
    assert.equal(inferPriority([makeLabel("p0")]), "critical");
  });

  it("maps p1 to high", () => {
    assert.equal(inferPriority([makeLabel("p1")]), "high");
  });

  it("maps priority: medium label", () => {
    assert.equal(inferPriority([makeLabel("priority: medium")]), "medium");
  });

  it("maps priority: low label", () => {
    assert.equal(inferPriority([makeLabel("priority: low")]), "low");
  });

  it("returns medium as default", () => {
    assert.equal(inferPriority([makeLabel("enhancement")]), "medium");
  });

  it("picks first matching label", () => {
    assert.equal(inferPriority([makeLabel("p3"), makeLabel("p0")]), "low");
  });
});

describe("inferType", () => {
  it("maps bug label", () => {
    assert.equal(inferType([makeLabel("bug")]), "bug");
  });

  it("maps enhancement to task", () => {
    assert.equal(inferType([makeLabel("enhancement")]), "task");
  });

  it("maps feature to task", () => {
    assert.equal(inferType([makeLabel("feature")]), "task");
  });

  it("returns task as default", () => {
    assert.equal(inferType([makeLabel("documentation")]), "task");
  });
});

describe("mapStatus", () => {
  it("maps open to open", () => {
    assert.equal(mapStatus("open"), "open");
  });

  it("maps closed to resolved", () => {
    assert.equal(mapStatus("closed"), "resolved");
  });
});

// ---------------------------------------------------------------------------
// Ticket mapping
// ---------------------------------------------------------------------------

const sampleIssue = {
  id: 12345,
  number: 42,
  title: "Fix adaptive browser retry logic",
  body: "The retry logic fails when page navigates during action",
  state: "open" as const,
  user: { id: 1, login: "ellistev", email: "steve@test.com" },
  assignee: { id: 2, login: "tierzero-bot" },
  assignees: [{ id: 2, login: "tierzero-bot" }],
  labels: [makeLabel("bug"), makeLabel("p1")],
  milestone: { id: 1, title: "v0.2.0", number: 1 },
  created_at: "2026-03-17T10:00:00Z",
  updated_at: "2026-03-17T12:00:00Z",
  closed_at: null,
  html_url: "https://github.com/ellistev/tierzero/issues/42",
  comments: 3,
};

describe("toTicket", () => {
  it("maps all fields correctly", () => {
    const ticket = toTicket(sampleIssue, "ellistev", "tierzero");
    assert.equal(ticket.id, "42");
    assert.equal(ticket.externalId, "12345");
    assert.equal(ticket.source, "github");
    assert.equal(ticket.url, "https://github.com/ellistev/tierzero/issues/42");
    assert.equal(ticket.title, "Fix adaptive browser retry logic");
    assert.equal(ticket.description, "The retry logic fails when page navigates during action");
    assert.equal(ticket.type, "bug");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.priority, "high"); // p1
    assert.equal(ticket.reporter.name, "ellistev");
    assert.equal(ticket.assignee?.name, "tierzero-bot");
    assert.deepEqual(ticket.tags, ["bug", "p1"]);
    assert.equal(ticket.project, "v0.2.0");
  });

  it("handles null body", () => {
    const issue = { ...sampleIssue, body: null };
    const ticket = toTicket(issue, "ellistev", "tierzero");
    assert.equal(ticket.description, "");
  });

  it("handles closed issue", () => {
    const issue = { ...sampleIssue, state: "closed" as const, closed_at: "2026-03-17T14:00:00Z" };
    const ticket = toTicket(issue, "ellistev", "tierzero");
    assert.equal(ticket.status, "resolved");
    assert.ok(ticket.resolvedAt);
  });

  it("handles no assignee", () => {
    const issue = { ...sampleIssue, assignee: null, assignees: [] };
    const ticket = toTicket(issue, "ellistev", "tierzero");
    assert.equal(ticket.assignee, undefined);
  });

  it("handles no milestone", () => {
    const issue = { ...sampleIssue, milestone: null };
    const ticket = toTicket(issue, "ellistev", "tierzero");
    assert.equal(ticket.project, undefined);
  });
});

// ---------------------------------------------------------------------------
// Comment mapping
// ---------------------------------------------------------------------------

describe("toComment", () => {
  it("maps comment fields", () => {
    const ghComment = {
      id: 999,
      user: { id: 1, login: "ellistev" },
      body: "Fixed in commit abc123",
      created_at: "2026-03-17T13:00:00Z",
      updated_at: "2026-03-17T13:00:00Z",
    };
    const comment = toComment(ghComment);
    assert.equal(comment.id, "999");
    assert.equal(comment.author.name, "ellistev");
    assert.equal(comment.body, "Fixed in commit abc123");
    assert.equal(comment.isInternal, false);
  });
});

// ---------------------------------------------------------------------------
// Constructor & request path
// ---------------------------------------------------------------------------

describe("GitHubConnector", () => {
  it("initializes with config", () => {
    const conn = new GitHubConnector({
      token: "ghp_test",
      owner: "ellistev",
      repo: "tierzero",
    });
    assert.equal(conn.name, "GitHub");
  });

  it("strips trailing slash from apiUrl", () => {
    const conn = new GitHubConnector({
      token: "ghp_test",
      owner: "ellistev",
      repo: "tierzero",
      apiUrl: "https://api.github.com/",
    });
    assert.equal(conn.name, "GitHub");
  });
});
