import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  _testExports,
  DEFAULT_TRANSITION_NAMES,
  STATUS_JQL,
} from "./jira";

const {
  PRIORITY_MAP,
  PRIORITY_TO_NAME,
  TYPE_MAP,
  mapStatus,
  extractAdfText,
  textToAdf,
  toUser,
  buildFieldUpdate,
} = _testExports;

// ---------------------------------------------------------------------------
// PRIORITY_MAP
// ---------------------------------------------------------------------------

describe("PRIORITY_MAP", () => {
  test("maps critical/blocker/highest to critical", () => {
    assert.equal(PRIORITY_MAP["critical"], "critical");
    assert.equal(PRIORITY_MAP["blocker"],  "critical");
    assert.equal(PRIORITY_MAP["highest"],  "critical");
  });

  test("maps major/high to high", () => {
    assert.equal(PRIORITY_MAP["high"],  "high");
    assert.equal(PRIORITY_MAP["major"], "high");
  });

  test("maps medium to medium", () => {
    assert.equal(PRIORITY_MAP["medium"], "medium");
  });

  test("maps low/minor/lowest/trivial to low", () => {
    assert.equal(PRIORITY_MAP["low"],     "low");
    assert.equal(PRIORITY_MAP["minor"],   "low");
    assert.equal(PRIORITY_MAP["lowest"],  "low");
    assert.equal(PRIORITY_MAP["trivial"], "low");
  });

  test("unknown priority name returns undefined", () => {
    assert.equal(PRIORITY_MAP["unknown"], undefined);
  });
});

// ---------------------------------------------------------------------------
// PRIORITY_TO_NAME (reverse)
// ---------------------------------------------------------------------------

describe("PRIORITY_TO_NAME", () => {
  test("maps all canonical TicketPriority values to Jira names", () => {
    assert.equal(PRIORITY_TO_NAME.critical, "Critical");
    assert.equal(PRIORITY_TO_NAME.high,     "High");
    assert.equal(PRIORITY_TO_NAME.medium,   "Medium");
    assert.equal(PRIORITY_TO_NAME.low,      "Low");
  });
});

// ---------------------------------------------------------------------------
// TYPE_MAP
// ---------------------------------------------------------------------------

describe("TYPE_MAP", () => {
  test("maps bug to bug", () => assert.equal(TYPE_MAP["bug"], "bug"));

  test("maps story/task/sub-task/epic to task", () => {
    assert.equal(TYPE_MAP["story"],    "task");
    assert.equal(TYPE_MAP["task"],     "task");
    assert.equal(TYPE_MAP["sub-task"], "task");
    assert.equal(TYPE_MAP["epic"],     "task");
  });

  test("maps incident to incident", () => assert.equal(TYPE_MAP["incident"], "incident"));

  test("maps service request variants to request", () => {
    assert.equal(TYPE_MAP["service request"],      "request");
    assert.equal(TYPE_MAP["service desk request"], "request");
  });

  test("maps change types to change", () => {
    assert.equal(TYPE_MAP["change"],          "change");
    assert.equal(TYPE_MAP["change request"],  "change");
  });

  test("maps problem to problem", () => assert.equal(TYPE_MAP["problem"], "problem"));

  test("unknown issue type returns undefined", () => {
    assert.equal(TYPE_MAP["unknown_type"], undefined);
  });
});

// ---------------------------------------------------------------------------
// mapStatus
// ---------------------------------------------------------------------------

describe("mapStatus", () => {
  test("statusCategory 'new' maps to open", () => {
    assert.equal(mapStatus({ name: "Open", statusCategory: { key: "new" } }), "open");
    assert.equal(mapStatus({ name: "To Do", statusCategory: { key: "new" } }), "open");
  });

  test("statusCategory 'indeterminate' maps to in_progress", () => {
    assert.equal(mapStatus({ name: "In Progress", statusCategory: { key: "indeterminate" } }), "in_progress");
  });

  test("statusCategory 'done' with non-close name maps to resolved", () => {
    assert.equal(mapStatus({ name: "Done", statusCategory: { key: "done" } }), "resolved");
    assert.equal(mapStatus({ name: "Resolved", statusCategory: { key: "done" } }), "resolved");
  });

  test("statusCategory 'done' with 'close' in name maps to closed", () => {
    assert.equal(mapStatus({ name: "Closed", statusCategory: { key: "done" } }), "closed");
    assert.equal(mapStatus({ name: "Close Issue", statusCategory: { key: "done" } }), "closed");
  });

  test("status name containing 'pending' maps to pending regardless of category", () => {
    assert.equal(mapStatus({ name: "Pending", statusCategory: { key: "indeterminate" } }), "pending");
  });

  test("status name containing 'on hold' maps to pending", () => {
    assert.equal(mapStatus({ name: "On Hold", statusCategory: { key: "indeterminate" } }), "pending");
  });

  test("status name containing 'waiting' maps to pending", () => {
    assert.equal(mapStatus({ name: "Waiting for Customer", statusCategory: { key: "indeterminate" } }), "pending");
  });

  test("unknown statusCategory key defaults to open", () => {
    assert.equal(mapStatus({ name: "Custom", statusCategory: { key: "undefined" } }), "open");
  });
});

// ---------------------------------------------------------------------------
// extractAdfText
// ---------------------------------------------------------------------------

describe("extractAdfText", () => {
  test("returns empty string for null/undefined input", () => {
    assert.equal(extractAdfText(null), "");
    assert.equal(extractAdfText(undefined), "");
  });

  test("returns empty string for non-object input", () => {
    assert.equal(extractAdfText("string"), "");
    assert.equal(extractAdfText(42), "");
  });

  test("extracts text from a bare text node", () => {
    assert.equal(extractAdfText({ type: "text", text: "Hello" }), "Hello");
  });

  test("extracts text from a simple paragraph", () => {
    const node = {
      type: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    };
    assert.equal(extractAdfText(node).trim(), "Hello world");
  });

  test("extracts and concatenates text from multiple text nodes", () => {
    const node = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    };
    assert.ok(extractAdfText(node).includes("Hello world"));
  });

  test("extracts text from nested doc/paragraph structure", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First paragraph" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    };
    const text = extractAdfText(doc);
    assert.ok(text.includes("First paragraph"));
    assert.ok(text.includes("Second paragraph"));
  });

  test("ignores nodes without text or content", () => {
    const node = { type: "hardBreak" };
    assert.equal(extractAdfText(node), "");
  });

  test("handles empty content array", () => {
    const node = { type: "paragraph", content: [] };
    assert.equal(extractAdfText(node).trim(), "");
  });
});

// ---------------------------------------------------------------------------
// textToAdf
// ---------------------------------------------------------------------------

describe("textToAdf", () => {
  test("produces a doc node at the root", () => {
    const adf = textToAdf("Hello");
    assert.equal(adf.type, "doc");
  });

  test("wraps text in a paragraph", () => {
    const adf = textToAdf("Hello");
    assert.ok(Array.isArray(adf.content));
    assert.equal(adf.content![0].type, "paragraph");
  });

  test("the paragraph contains a text node with the input string", () => {
    const adf = textToAdf("Hello world");
    const para = adf.content![0];
    assert.ok(Array.isArray(para.content));
    assert.equal(para.content![0].type, "text");
    assert.equal(para.content![0].text, "Hello world");
  });

  test("round-trips through extractAdfText", () => {
    const original = "This is a test message.";
    const adf = textToAdf(original);
    const recovered = extractAdfText(adf).trim();
    assert.equal(recovered, original);
  });
});

// ---------------------------------------------------------------------------
// toUser
// ---------------------------------------------------------------------------

describe("toUser", () => {
  test("maps accountId, displayName, emailAddress", () => {
    const user = toUser({ accountId: "acc-1", displayName: "Alice", emailAddress: "a@co.com" });
    assert.equal(user.id, "acc-1");
    assert.equal(user.name, "Alice");
    assert.equal(user.email, "a@co.com");
  });

  test("email is undefined when not provided", () => {
    const user = toUser({ accountId: "acc-2", displayName: "Bob" });
    assert.equal(user.email, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildFieldUpdate
// ---------------------------------------------------------------------------

describe("buildFieldUpdate", () => {
  test("returns empty object when no fields provided", () => {
    assert.deepEqual(buildFieldUpdate({}), {});
  });

  test("maps assigneeId to { assignee: { accountId } }", () => {
    const out = buildFieldUpdate({ assigneeId: "acc-abc" });
    assert.deepEqual(out, { assignee: { accountId: "acc-abc" } });
  });

  test("maps empty assigneeId to { assignee: null } (unassign)", () => {
    const out = buildFieldUpdate({ assigneeId: "" });
    assert.deepEqual(out, { assignee: null });
  });

  test("maps priority to { priority: { name } }", () => {
    assert.deepEqual(buildFieldUpdate({ priority: "high" }),     { priority: { name: "High" } });
    assert.deepEqual(buildFieldUpdate({ priority: "critical" }), { priority: { name: "Critical" } });
    assert.deepEqual(buildFieldUpdate({ priority: "low" }),      { priority: { name: "Low" } });
  });

  test("combines assignee and priority in one object", () => {
    const out = buildFieldUpdate({ assigneeId: "abc", priority: "medium" });
    assert.deepEqual(out, {
      assignee: { accountId: "abc" },
      priority: { name: "Medium" },
    });
  });

  test("silently ignores assigneeGroupId (not a standard Jira field)", () => {
    const out = buildFieldUpdate({ assigneeGroupId: "grp-1" });
    assert.deepEqual(out, {});
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_TRANSITION_NAMES
// ---------------------------------------------------------------------------

describe("DEFAULT_TRANSITION_NAMES", () => {
  test("has entries for all TicketStatus values", () => {
    const statuses = ["open", "in_progress", "pending", "resolved", "closed"] as const;
    for (const s of statuses) {
      assert.ok(
        Array.isArray(DEFAULT_TRANSITION_NAMES[s]) && DEFAULT_TRANSITION_NAMES[s].length > 0,
        `Missing DEFAULT_TRANSITION_NAMES entry for "${s}"`
      );
    }
  });

  test("resolved names include at least 'Resolve' as a hint", () => {
    assert.ok(
      DEFAULT_TRANSITION_NAMES.resolved.some((n) => n.toLowerCase().includes("resolve")),
      "expected 'resolved' to include a 'Resolve' hint"
    );
  });
});

// ---------------------------------------------------------------------------
// STATUS_JQL
// ---------------------------------------------------------------------------

describe("STATUS_JQL", () => {
  test("has entries for all TicketStatus values", () => {
    const statuses = ["open", "in_progress", "pending", "resolved", "closed"] as const;
    for (const s of statuses) {
      assert.ok(
        Array.isArray(STATUS_JQL[s]) && STATUS_JQL[s].length > 0,
        `Missing STATUS_JQL entry for "${s}"`
      );
    }
  });

  test("open JQL uses statusCategory = 'To Do'", () => {
    assert.ok(STATUS_JQL.open.some((q) => q.includes("To Do")));
  });

  test("in_progress JQL uses statusCategory = 'In Progress'", () => {
    assert.ok(STATUS_JQL.in_progress.some((q) => q.includes("In Progress")));
  });

  test("pending JQL uses status in (...) form", () => {
    assert.ok(STATUS_JQL.pending.some((q) => q.toLowerCase().includes("pending") || q.toLowerCase().includes("on hold")));
  });
});
