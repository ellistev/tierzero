import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { _testExports } from "./servicenow";

const { STATE_MAP, PRIORITY_MAP, CLASS_TYPE_MAP, snRef, snDate, toComment, toAttachment } = _testExports;

// ---------------------------------------------------------------------------
// STATE_MAP
// ---------------------------------------------------------------------------

describe("STATE_MAP", () => {
  test("maps all known ServiceNow state codes", () => {
    assert.equal(STATE_MAP["1"], "open");
    assert.equal(STATE_MAP["2"], "in_progress");
    assert.equal(STATE_MAP["3"], "pending");
    assert.equal(STATE_MAP["6"], "resolved");
    assert.equal(STATE_MAP["7"], "closed");
  });

  test("unknown state code is undefined (caller defaults to open)", () => {
    assert.equal(STATE_MAP["99"], undefined);
    assert.equal(STATE_MAP[""], undefined);
  });
});

// ---------------------------------------------------------------------------
// PRIORITY_MAP
// ---------------------------------------------------------------------------

describe("PRIORITY_MAP", () => {
  test("maps all standard priority codes", () => {
    assert.equal(PRIORITY_MAP["1"], "critical");
    assert.equal(PRIORITY_MAP["2"], "high");
    assert.equal(PRIORITY_MAP["3"], "medium");
    assert.equal(PRIORITY_MAP["4"], "low");
  });

  test("code 5 (Planning) maps to low", () => {
    assert.equal(PRIORITY_MAP["5"], "low");
  });

  test("unknown priority code is undefined", () => {
    assert.equal(PRIORITY_MAP["9"], undefined);
  });
});

// ---------------------------------------------------------------------------
// CLASS_TYPE_MAP
// ---------------------------------------------------------------------------

describe("CLASS_TYPE_MAP", () => {
  test("incident class maps to incident", () => {
    assert.equal(CLASS_TYPE_MAP["incident"], "incident");
  });

  test("service catalog classes map to request", () => {
    assert.equal(CLASS_TYPE_MAP["sc_request"], "request");
    assert.equal(CLASS_TYPE_MAP["sc_req_item"], "request");
  });

  test("change and task classes map correctly", () => {
    assert.equal(CLASS_TYPE_MAP["change_request"], "change");
    assert.equal(CLASS_TYPE_MAP["change_task"], "task");
    assert.equal(CLASS_TYPE_MAP["sc_task"], "task");
  });

  test("problem class maps to problem", () => {
    assert.equal(CLASS_TYPE_MAP["problem"], "problem");
  });

  test("unknown class is undefined (caller defaults to incident)", () => {
    assert.equal(CLASS_TYPE_MAP["unknown_class"], undefined);
  });
});

// ---------------------------------------------------------------------------
// snRef
// ---------------------------------------------------------------------------

describe("snRef", () => {
  test("returns undefined for undefined input", () => {
    assert.equal(snRef(undefined), undefined);
  });

  test("returns undefined when value is empty string", () => {
    assert.equal(snRef({ value: "", display_value: "Alice" }), undefined);
  });

  test("maps ref to TicketUser with id and name", () => {
    const user = snRef({ value: "abc123", display_value: "Alice Smith" });
    assert.deepEqual(user, { id: "abc123", name: "Alice Smith" });
  });
});

// ---------------------------------------------------------------------------
// snDate
// ---------------------------------------------------------------------------

describe("snDate", () => {
  test("returns undefined for undefined input", () => {
    assert.equal(snDate(undefined), undefined);
  });

  test("returns undefined when value is empty string", () => {
    assert.equal(snDate({ value: "", display_value: "" }), undefined);
  });

  test("parses ServiceNow space-separated datetime as UTC Date", () => {
    const d = snDate({ value: "2024-03-15 10:30:00", display_value: "" });
    assert.ok(d instanceof Date, "should return a Date");
    assert.equal(d!.toISOString(), "2024-03-15T10:30:00.000Z");
  });

  test("also handles T-separated ISO strings", () => {
    const d = snDate({ value: "2024-06-01T08:00:00", display_value: "" });
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString(), "2024-06-01T08:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// toComment
// ---------------------------------------------------------------------------

describe("toComment", () => {
  const base = {
    sys_id: "entry-001",
    sys_created_by: "jsmith",
    sys_created_on: "2024-03-15 09:00:00",
    value: "Hello from comment",
  };

  test("public comment (element=comments) sets isInternal false", () => {
    const c = toComment({ ...base, element: "comments" });
    assert.equal(c.isInternal, false);
    assert.equal(c.body, "Hello from comment");
    assert.equal(c.id, "entry-001");
    assert.equal(c.author.id, "jsmith");
    assert.equal(c.author.name, "jsmith");
  });

  test("internal note (element=work_notes) sets isInternal true", () => {
    const c = toComment({ ...base, element: "work_notes" });
    assert.equal(c.isInternal, true);
  });

  test("parses sys_created_on as UTC Date", () => {
    const c = toComment({ ...base, element: "comments" });
    assert.ok(c.createdAt instanceof Date);
    assert.equal(c.createdAt.toISOString(), "2024-03-15T09:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// toAttachment
// ---------------------------------------------------------------------------

describe("toAttachment", () => {
  const base = {
    sys_id: "att-001",
    file_name: "screenshot.png",
    download_link: "https://instance.service-now.com/api/now/attachment/att-001/file",
    size_bytes: "204800",
    content_type: "image/png",
  };

  test("maps all fields correctly", () => {
    const att = toAttachment(base);
    assert.equal(att.id, "att-001");
    assert.equal(att.filename, "screenshot.png");
    assert.equal(att.url, base.download_link);
    assert.equal(att.size, 204800);
    assert.equal(att.mimeType, "image/png");
  });

  test("handles non-numeric size_bytes gracefully", () => {
    const att = toAttachment({ ...base, size_bytes: "not-a-number" });
    assert.equal(att.size, undefined);
  });
});
