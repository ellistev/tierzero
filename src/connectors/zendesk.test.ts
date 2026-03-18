import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports, ZendeskConnector } from "./zendesk";

const { mapStatus, mapPriority, mapType, toTicket, toComment, toAttachment } = _testExports;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe("Zendesk mapStatus", () => {
  it("maps new to open", () => assert.equal(mapStatus("new"), "open"));
  it("maps open to open", () => assert.equal(mapStatus("open"), "open"));
  it("maps pending to pending", () => assert.equal(mapStatus("pending"), "pending"));
  it("maps hold to pending", () => assert.equal(mapStatus("hold"), "pending"));
  it("maps solved to resolved", () => assert.equal(mapStatus("solved"), "resolved"));
  it("maps closed to closed", () => assert.equal(mapStatus("closed"), "closed"));
  it("defaults unknown to open", () => assert.equal(mapStatus("weird"), "open"));
});

// ---------------------------------------------------------------------------
// Priority mapping
// ---------------------------------------------------------------------------

describe("Zendesk mapPriority", () => {
  it("maps urgent to critical", () => assert.equal(mapPriority("urgent"), "critical"));
  it("maps high to high", () => assert.equal(mapPriority("high"), "high"));
  it("maps normal to medium", () => assert.equal(mapPriority("normal"), "medium"));
  it("maps low to low", () => assert.equal(mapPriority("low"), "low"));
  it("defaults null to medium", () => assert.equal(mapPriority(null), "medium"));
  it("defaults unknown to medium", () => assert.equal(mapPriority("unknown"), "medium"));
});

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

describe("Zendesk mapType", () => {
  it("maps problem", () => assert.equal(mapType("problem"), "problem"));
  it("maps incident", () => assert.equal(mapType("incident"), "incident"));
  it("maps question to request", () => assert.equal(mapType("question"), "request"));
  it("maps task", () => assert.equal(mapType("task"), "task"));
  it("defaults null to task", () => assert.equal(mapType(null), "task"));
});

// ---------------------------------------------------------------------------
// Ticket mapping
// ---------------------------------------------------------------------------

const sampleTicket = {
  id: 12345,
  subject: "Cannot login to portal",
  description: "User reports unable to login since Tuesday",
  status: "open",
  priority: "high" as string | null,
  type: "incident" as string | null,
  requester_id: 100,
  assignee_id: 200,
  tags: ["login", "portal", "urgent"],
  group_id: 50,
  created_at: "2026-03-17T10:00:00Z",
  updated_at: "2026-03-17T12:00:00Z",
  url: "https://example.zendesk.com/api/v2/tickets/12345.json",
};

describe("Zendesk toTicket", () => {
  it("maps all fields", () => {
    const ticket = toTicket(sampleTicket, "https://example.zendesk.com");
    assert.equal(ticket.id, "12345");
    assert.equal(ticket.source, "zendesk");
    assert.equal(ticket.url, "https://example.zendesk.com/agent/tickets/12345");
    assert.equal(ticket.title, "Cannot login to portal");
    assert.equal(ticket.type, "incident");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.priority, "high");
    assert.equal(ticket.reporter.id, "100");
    assert.equal(ticket.assignee?.id, "200");
    assert.deepEqual(ticket.tags, ["login", "portal", "urgent"]);
  });

  it("handles no assignee", () => {
    const ticket = toTicket({ ...sampleTicket, assignee_id: null }, "https://x.zendesk.com");
    assert.equal(ticket.assignee, undefined);
  });

  it("handles null priority", () => {
    const ticket = toTicket({ ...sampleTicket, priority: null }, "https://x.zendesk.com");
    assert.equal(ticket.priority, "medium");
  });

  it("handles null subject", () => {
    const ticket = toTicket({ ...sampleTicket, subject: undefined as unknown as string }, "https://x.zendesk.com");
    assert.equal(ticket.title, "(no subject)");
  });
});

// ---------------------------------------------------------------------------
// Comment mapping
// ---------------------------------------------------------------------------

describe("Zendesk toComment", () => {
  it("maps public comment", () => {
    const comment = toComment({
      id: 999, author_id: 100, body: "Thanks for reporting",
      public: true, created_at: "2026-03-17T13:00:00Z", attachments: [],
    });
    assert.equal(comment.id, "999");
    assert.equal(comment.body, "Thanks for reporting");
    assert.equal(comment.isInternal, false);
  });

  it("maps internal note", () => {
    const comment = toComment({
      id: 888, author_id: 200, body: "Internal: checking logs",
      public: false, created_at: "2026-03-17T14:00:00Z", attachments: [],
    });
    assert.equal(comment.isInternal, true);
  });
});

// ---------------------------------------------------------------------------
// Attachment mapping
// ---------------------------------------------------------------------------

describe("Zendesk toAttachment", () => {
  it("maps attachment fields", () => {
    const att = toAttachment({
      id: 555, file_name: "screenshot.png",
      content_url: "https://example.zendesk.com/attachments/555/screenshot.png",
      size: 1024, content_type: "image/png",
    });
    assert.equal(att.id, "555");
    assert.equal(att.filename, "screenshot.png");
    assert.equal(att.size, 1024);
    assert.equal(att.mimeType, "image/png");
  });
});

// ---------------------------------------------------------------------------
// Connector constructor
// ---------------------------------------------------------------------------

describe("ZendeskConnector", () => {
  it("initializes with config", () => {
    const conn = new ZendeskConnector({
      subdomain: "mycompany",
      email: "test@example.com",
      apiToken: "abc123",
    });
    assert.equal(conn.name, "Zendesk");
  });

  it("has a healthCheck method", () => {
    const conn = new ZendeskConnector({
      subdomain: "mycompany",
      email: "test@example.com",
      apiToken: "abc123",
    });
    assert.equal(typeof conn.healthCheck, "function");
  });
});
