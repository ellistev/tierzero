import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _testExports, FreshdeskConnector } from "./freshdesk";

const {
  mapStatus,
  mapPriority,
  mapType,
  toUser,
  toUserFromId,
  toAttachment,
  toTicket,
  toComment,
  buildUpdateBody,
} = _testExports;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe("mapStatus", () => {
  it("maps 2 to open", () => {
    assert.equal(mapStatus(2), "open");
  });

  it("maps 3 to pending", () => {
    assert.equal(mapStatus(3), "pending");
  });

  it("maps 4 to resolved", () => {
    assert.equal(mapStatus(4), "resolved");
  });

  it("maps 5 to closed", () => {
    assert.equal(mapStatus(5), "closed");
  });

  it("defaults unknown status to open", () => {
    assert.equal(mapStatus(99), "open");
  });
});

// ---------------------------------------------------------------------------
// Priority mapping
// ---------------------------------------------------------------------------

describe("mapPriority", () => {
  it("maps 1 to low", () => {
    assert.equal(mapPriority(1), "low");
  });

  it("maps 2 to medium", () => {
    assert.equal(mapPriority(2), "medium");
  });

  it("maps 3 to high", () => {
    assert.equal(mapPriority(3), "high");
  });

  it("maps 4 (Urgent) to critical", () => {
    assert.equal(mapPriority(4), "critical");
  });

  it("defaults unknown priority to medium", () => {
    assert.equal(mapPriority(0), "medium");
  });
});

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

describe("mapType", () => {
  it("maps Incident", () => {
    assert.equal(mapType("Incident"), "incident");
  });

  it("maps Service Request", () => {
    assert.equal(mapType("Service Request"), "request");
  });

  it("maps Bug", () => {
    assert.equal(mapType("Bug"), "bug");
  });

  it("maps null to incident", () => {
    assert.equal(mapType(null), "incident");
  });

  it("maps unknown type to incident", () => {
    assert.equal(mapType("Custom Type"), "incident");
  });
});

// ---------------------------------------------------------------------------
// User mapping
// ---------------------------------------------------------------------------

describe("toUser", () => {
  it("maps contact fields", () => {
    const user = toUser({ id: 42, name: "Alice", email: "alice@example.com" });
    assert.equal(user.id, "42");
    assert.equal(user.name, "Alice");
    assert.equal(user.email, "alice@example.com");
  });

  it("handles null email", () => {
    const user = toUser({ id: 1, name: "Bob", email: null });
    assert.equal(user.email, undefined);
  });
});

describe("toUserFromId", () => {
  it("creates placeholder user from ID", () => {
    const user = toUserFromId(123);
    assert.equal(user.id, "123");
    assert.equal(user.name, "user-123");
  });
});

// ---------------------------------------------------------------------------
// Attachment mapping
// ---------------------------------------------------------------------------

describe("toAttachment", () => {
  it("maps attachment fields", () => {
    const att = toAttachment({
      id: 55,
      name: "screenshot.png",
      size: 12345,
      content_type: "image/png",
      attachment_url: "https://myco.freshdesk.com/att/55",
    });
    assert.equal(att.id, "55");
    assert.equal(att.filename, "screenshot.png");
    assert.equal(att.size, 12345);
    assert.equal(att.mimeType, "image/png");
    assert.equal(att.url, "https://myco.freshdesk.com/att/55");
  });
});

// ---------------------------------------------------------------------------
// Ticket mapping
// ---------------------------------------------------------------------------

const sampleFDTicket = {
  id: 101,
  subject: "Cannot connect to VPN",
  description_text: "I get an error when connecting to VPN from home.",
  description: "<p>I get an error when connecting to VPN from home.</p>",
  status: 2,
  priority: 3,
  type: "Incident" as string | null,
  requester_id: 42,
  responder_id: 7,
  group_id: 3,
  tags: ["vpn", "network"],
  created_at: "2026-03-17T08:00:00Z",
  updated_at: "2026-03-17T10:30:00Z",
  due_by: "2026-03-18T08:00:00Z",
  attachments: [
    {
      id: 55,
      name: "error.png",
      size: 8000,
      content_type: "image/png",
      attachment_url: "https://myco.freshdesk.com/att/55",
    },
  ],
  custom_fields: { cf_department: "Engineering" },
  requester: { id: 42, name: "Alice", email: "alice@example.com" },
};

describe("toTicket", () => {
  it("maps all fields correctly", () => {
    const ticket = toTicket(sampleFDTicket, "https://myco.freshdesk.com");
    assert.equal(ticket.id, "101");
    assert.equal(ticket.externalId, "101");
    assert.equal(ticket.source, "freshdesk");
    assert.equal(ticket.url, "https://myco.freshdesk.com/a/tickets/101");
    assert.equal(ticket.title, "Cannot connect to VPN");
    assert.equal(ticket.description, "I get an error when connecting to VPN from home.");
    assert.equal(ticket.type, "incident");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.priority, "high");
    assert.equal(ticket.reporter.name, "Alice");
    assert.equal(ticket.reporter.email, "alice@example.com");
    assert.equal(ticket.assignee?.id, "7");
    assert.deepEqual(ticket.tags, ["vpn", "network"]);
    assert.equal(ticket.queue, "3");
    assert.equal(ticket.attachments?.length, 1);
    assert.equal(ticket.attachments?.[0].filename, "error.png");
    assert.ok(ticket.dueAt);
  });

  it("handles no responder", () => {
    const fd = { ...sampleFDTicket, responder_id: null };
    const ticket = toTicket(fd, "https://myco.freshdesk.com");
    assert.equal(ticket.assignee, undefined);
  });

  it("handles null type", () => {
    const fd = { ...sampleFDTicket, type: null };
    const ticket = toTicket(fd, "https://myco.freshdesk.com");
    assert.equal(ticket.type, "incident");
  });

  it("handles no group", () => {
    const fd = { ...sampleFDTicket, group_id: null };
    const ticket = toTicket(fd, "https://myco.freshdesk.com");
    assert.equal(ticket.queue, undefined);
  });

  it("falls back to description when description_text is empty", () => {
    const fd = { ...sampleFDTicket, description_text: "" };
    const ticket = toTicket(fd, "https://myco.freshdesk.com");
    assert.equal(ticket.description, "<p>I get an error when connecting to VPN from home.</p>");
  });

  it("uses toUserFromId when requester is absent", () => {
    const fd = { ...sampleFDTicket, requester: undefined as any };
    const ticket = toTicket(fd, "https://myco.freshdesk.com");
    assert.equal(ticket.reporter.id, "42");
    assert.equal(ticket.reporter.name, "user-42");
  });
});

// ---------------------------------------------------------------------------
// Comment mapping
// ---------------------------------------------------------------------------

describe("toComment", () => {
  it("maps conversation to comment", () => {
    const conv = {
      id: 200,
      body_text: "Have you tried restarting?",
      body: "<p>Have you tried restarting?</p>",
      user_id: 7,
      private: true,
      incoming: false,
      created_at: "2026-03-17T09:00:00Z",
      updated_at: "2026-03-17T09:00:00Z",
      attachments: [],
    };
    const comment = toComment(conv);
    assert.equal(comment.id, "200");
    assert.equal(comment.author.id, "7");
    assert.equal(comment.body, "Have you tried restarting?");
    assert.equal(comment.isInternal, true);
  });

  it("maps public reply", () => {
    const conv = {
      id: 201,
      body_text: "Thanks, that fixed it!",
      body: "<p>Thanks, that fixed it!</p>",
      user_id: 42,
      private: false,
      incoming: true,
      created_at: "2026-03-17T11:00:00Z",
      updated_at: "2026-03-17T11:00:00Z",
      attachments: [],
    };
    const comment = toComment(conv);
    assert.equal(comment.isInternal, false);
  });

  it("falls back to HTML body when body_text is empty", () => {
    const conv = {
      id: 202,
      body_text: "",
      body: "<p>HTML only</p>",
      user_id: 1,
      private: false,
      incoming: false,
      created_at: "2026-03-17T12:00:00Z",
      updated_at: "2026-03-17T12:00:00Z",
      attachments: [],
    };
    const comment = toComment(conv);
    assert.equal(comment.body, "<p>HTML only</p>");
  });
});

// ---------------------------------------------------------------------------
// buildUpdateBody
// ---------------------------------------------------------------------------

describe("buildUpdateBody", () => {
  it("maps status", () => {
    const body = buildUpdateBody({ status: "resolved" });
    assert.equal(body.status, 4);
  });

  it("maps priority", () => {
    const body = buildUpdateBody({ priority: "critical" });
    assert.equal(body.priority, 4);
  });

  it("maps assigneeId to responder_id", () => {
    const body = buildUpdateBody({ assigneeId: "42" });
    assert.equal(body.responder_id, 42);
  });

  it("maps assigneeGroupId to group_id", () => {
    const body = buildUpdateBody({ assigneeGroupId: "5" });
    assert.equal(body.group_id, 5);
  });

  it("maps in_progress to open (status 2)", () => {
    const body = buildUpdateBody({ status: "in_progress" });
    assert.equal(body.status, 2);
  });

  it("returns empty object when no fields", () => {
    const body = buildUpdateBody({});
    assert.deepEqual(body, {});
  });
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("FreshdeskConnector", () => {
  it("initializes with domain string", () => {
    const conn = new FreshdeskConnector({
      domain: "myco.freshdesk.com",
      apiKey: "test-key",
    });
    assert.equal(conn.name, "Freshdesk");
  });

  it("initializes with full URL", () => {
    const conn = new FreshdeskConnector({
      domain: "https://myco.freshdesk.com",
      apiKey: "test-key",
    });
    assert.equal(conn.name, "Freshdesk");
  });

  it("strips trailing slash", () => {
    const conn = new FreshdeskConnector({
      domain: "https://myco.freshdesk.com/",
      apiKey: "test-key",
    });
    assert.equal(conn.name, "Freshdesk");
  });
});
