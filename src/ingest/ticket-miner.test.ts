import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTicketArticle, mineFilename } from "./ticket-miner";
import type { Ticket, TicketComment } from "../connectors/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-001",
    externalId: "INC0001234",
    source: "servicenow",
    title: "Cannot connect to VPN",
    description: "User is unable to connect to the company VPN from home.",
    type: "incident",
    status: "resolved",
    priority: "high",
    reporter: { id: "u-1", name: "Alice", email: "alice@example.com" },
    assignee: { id: "u-2", name: "Bob" },
    createdAt: new Date("2024-01-10T09:00:00Z"),
    updatedAt: new Date("2024-01-11T15:30:00Z"),
    resolvedAt: new Date("2024-01-11T15:30:00Z"),
    ...overrides,
  };
}

function makeComment(overrides: Partial<TicketComment> = {}): TicketComment {
  return {
    id: "c-001",
    author: { id: "u-2", name: "Bob" },
    body: "Reinstalled the VPN client and it now works.",
    isInternal: false,
    createdAt: new Date("2024-01-11T14:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatTicketArticle
// ---------------------------------------------------------------------------

describe("formatTicketArticle", () => {
  it("includes the ticket title as an h1", () => {
    assert.ok(formatTicketArticle(makeTicket(), []).includes("# Cannot connect to VPN"));
  });

  it("includes externalId, resolved date, and priority in header", () => {
    const result = formatTicketArticle(makeTicket(), []);
    assert.ok(result.includes("INC0001234"));
    assert.ok(result.includes("2024-01-11"));
    assert.ok(result.includes("high"));
  });

  it("includes Problem section with description", () => {
    const result = formatTicketArticle(makeTicket(), []);
    assert.ok(result.includes("## Problem"));
    assert.ok(result.includes("User is unable to connect"));
  });

  it("includes Resolution Thread section with a comment", () => {
    const result = formatTicketArticle(makeTicket(), [makeComment()]);
    assert.ok(result.includes("## Resolution Thread"));
    assert.ok(result.includes("### Bob (public)"));
    assert.ok(result.includes("Reinstalled the VPN client"));
  });

  it("marks internal comments correctly", () => {
    const comment = makeComment({ isInternal: true, author: { id: "u-3", name: "Agent" } });
    const result = formatTicketArticle(makeTicket(), [comment]);
    assert.ok(result.includes("### Agent (internal)"));
  });

  it("shows placeholder when no comments exist", () => {
    const result = formatTicketArticle(makeTicket(), []);
    assert.ok(result.includes("_No comments recorded._"));
  });

  it("uses updatedAt when resolvedAt is not set", () => {
    const ticket = makeTicket({ resolvedAt: undefined, updatedAt: new Date("2024-03-05T00:00:00Z") });
    const result = formatTicketArticle(ticket, []);
    assert.ok(result.includes("2024-03-05"));
  });

  it("handles empty description with placeholder", () => {
    const ticket = makeTicket({ description: "" });
    const result = formatTicketArticle(ticket, []);
    assert.ok(result.includes("_No description provided._"));
  });

  it("renders multiple comments", () => {
    const comments = [
      makeComment({ id: "c1", body: "First response" }),
      makeComment({ id: "c2", body: "Follow-up note", author: { id: "u-3", name: "Carol" } }),
    ];
    const result = formatTicketArticle(makeTicket(), comments);
    assert.ok(result.includes("First response"));
    assert.ok(result.includes("Follow-up note"));
    assert.ok(result.includes("### Carol (public)"));
  });
});

// ---------------------------------------------------------------------------
// mineFilename
// ---------------------------------------------------------------------------

describe("mineFilename", () => {
  it("generates a filename from source, id, and title", () => {
    const name = mineFilename("servicenow", "INC0001234", "VPN not working");
    assert.equal(name, "servicenow-INC0001234-vpn-not-working.md");
  });

  it("slugifies the source name", () => {
    const name = mineFilename("Service Now", "123", "Test");
    assert.ok(name.startsWith("service-now-"));
  });

  it("sanitizes special characters from external ID", () => {
    const name = mineFilename("jira", "PROJ-123", "Bug fix");
    assert.ok(name.includes("PROJ-123"));
    assert.ok(!name.includes(" "));
  });

  it("truncates very long titles to keep filename reasonable", () => {
    const longTitle = "a".repeat(200);
    const name = mineFilename("jira", "PROJ-1", longTitle);
    assert.ok(name.length < 200);
  });

  it("always ends with .md", () => {
    assert.match(mineFilename("gitlab", "42", "Some issue"), /\.md$/);
  });

  it("handles special characters in title", () => {
    const name = mineFilename("servicenow", "INC1", "Can't login to Office 365!");
    assert.ok(name.includes("cant-login-to-office-365"));
  });
});
