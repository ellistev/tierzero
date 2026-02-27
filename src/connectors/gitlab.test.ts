import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  _testExports,
  DEFAULT_IN_PROGRESS_LABELS,
  DEFAULT_PENDING_LABELS,
} from "./gitlab";

const {
  LABEL_PRIORITY_MAP,
  ISSUE_TYPE_MAP,
  SEVERITY_MAP,
  mapStatus,
  mapPriorityFromLabels,
  buildUpdateFields,
  toUser,
} = _testExports;

// ---------------------------------------------------------------------------
// LABEL_PRIORITY_MAP
// ---------------------------------------------------------------------------

describe("LABEL_PRIORITY_MAP", () => {
  test("maps priority:: scoped labels", () => {
    assert.equal(LABEL_PRIORITY_MAP["priority::critical"], "critical");
    assert.equal(LABEL_PRIORITY_MAP["priority::high"],     "high");
    assert.equal(LABEL_PRIORITY_MAP["priority::medium"],   "medium");
    assert.equal(LABEL_PRIORITY_MAP["priority::low"],      "low");
  });

  test("maps short-form labels", () => {
    assert.equal(LABEL_PRIORITY_MAP["critical"], "critical");
    assert.equal(LABEL_PRIORITY_MAP["high"],     "high");
    assert.equal(LABEL_PRIORITY_MAP["medium"],   "medium");
    assert.equal(LABEL_PRIORITY_MAP["low"],      "low");
  });

  test("maps severity:: scoped labels", () => {
    assert.equal(LABEL_PRIORITY_MAP["severity::critical"], "critical");
    assert.equal(LABEL_PRIORITY_MAP["severity::high"],     "high");
    assert.equal(LABEL_PRIORITY_MAP["severity::medium"],   "medium");
    assert.equal(LABEL_PRIORITY_MAP["severity::low"],      "low");
  });

  test("unknown label returns undefined", () => {
    assert.equal(LABEL_PRIORITY_MAP["unknown-label"], undefined);
  });
});

// ---------------------------------------------------------------------------
// ISSUE_TYPE_MAP
// ---------------------------------------------------------------------------

describe("ISSUE_TYPE_MAP", () => {
  test("issue and task map to task", () => {
    assert.equal(ISSUE_TYPE_MAP["issue"], "task");
    assert.equal(ISSUE_TYPE_MAP["task"],  "task");
  });

  test("incident maps to incident", () => {
    assert.equal(ISSUE_TYPE_MAP["incident"], "incident");
  });

  test("test_case maps to task", () => {
    assert.equal(ISSUE_TYPE_MAP["test_case"], "task");
  });

  test("unknown type returns undefined", () => {
    assert.equal(ISSUE_TYPE_MAP["unknown"], undefined);
  });
});

// ---------------------------------------------------------------------------
// SEVERITY_MAP
// ---------------------------------------------------------------------------

describe("SEVERITY_MAP", () => {
  test("maps all GitLab severity values", () => {
    assert.equal(SEVERITY_MAP["CRITICAL"], "critical");
    assert.equal(SEVERITY_MAP["HIGH"],     "high");
    assert.equal(SEVERITY_MAP["MEDIUM"],   "medium");
    assert.equal(SEVERITY_MAP["LOW"],      "low");
    assert.equal(SEVERITY_MAP["UNKNOWN"],  "medium");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT labels
// ---------------------------------------------------------------------------

describe("DEFAULT_IN_PROGRESS_LABELS / DEFAULT_PENDING_LABELS", () => {
  test("in-progress defaults are non-empty", () => {
    assert.ok(DEFAULT_IN_PROGRESS_LABELS.length > 0);
    assert.ok(DEFAULT_IN_PROGRESS_LABELS.includes("in-progress"));
  });

  test("pending defaults are non-empty", () => {
    assert.ok(DEFAULT_PENDING_LABELS.length > 0);
    assert.ok(DEFAULT_PENDING_LABELS.includes("blocked") || DEFAULT_PENDING_LABELS.includes("pending"));
  });
});

// ---------------------------------------------------------------------------
// mapStatus
// ---------------------------------------------------------------------------

const IP_LABELS  = ["in-progress", "doing"];
const PND_LABELS = ["blocked", "pending"];

describe("mapStatus", () => {
  test("closed state always maps to resolved", () => {
    assert.equal(mapStatus("closed", [], IP_LABELS, PND_LABELS), "resolved");
    assert.equal(mapStatus("closed", ["in-progress"], IP_LABELS, PND_LABELS), "resolved");
  });

  test("opened with no relevant labels maps to open", () => {
    assert.equal(mapStatus("opened", [], IP_LABELS, PND_LABELS), "open");
    assert.equal(mapStatus("opened", ["bug", "help wanted"], IP_LABELS, PND_LABELS), "open");
  });

  test("opened with in-progress label maps to in_progress", () => {
    assert.equal(mapStatus("opened", ["in-progress"], IP_LABELS, PND_LABELS), "in_progress");
    assert.equal(mapStatus("opened", ["doing", "bug"], IP_LABELS, PND_LABELS), "in_progress");
  });

  test("opened with pending label maps to pending", () => {
    assert.equal(mapStatus("opened", ["blocked"], IP_LABELS, PND_LABELS), "pending");
    assert.equal(mapStatus("opened", ["pending", "bug"], IP_LABELS, PND_LABELS), "pending");
  });

  test("pending labels take priority over in-progress labels when both present", () => {
    // If someone accidentally has both, pending wins
    assert.equal(mapStatus("opened", ["in-progress", "blocked"], IP_LABELS, PND_LABELS), "pending");
  });

  test("label comparison is case-insensitive", () => {
    assert.equal(mapStatus("opened", ["IN-PROGRESS"], IP_LABELS, PND_LABELS), "in_progress");
    assert.equal(mapStatus("opened", ["BLOCKED"], IP_LABELS, PND_LABELS), "pending");
  });

  test("custom inProgressLabels and pendingLabels are respected", () => {
    assert.equal(mapStatus("opened", ["wip"],    ["wip"], ["hold"]), "in_progress");
    assert.equal(mapStatus("opened", ["hold"],   ["wip"], ["hold"]), "pending");
    assert.equal(mapStatus("opened", ["in-progress"], ["wip"], ["hold"]), "open");
  });
});

// ---------------------------------------------------------------------------
// mapPriorityFromLabels
// ---------------------------------------------------------------------------

describe("mapPriorityFromLabels", () => {
  test("returns medium when no priority labels present", () => {
    assert.equal(mapPriorityFromLabels([]), "medium");
    assert.equal(mapPriorityFromLabels(["bug", "feature"]), "medium");
  });

  test("reads priority from priority:: scoped label", () => {
    assert.equal(mapPriorityFromLabels(["priority::critical"]), "critical");
    assert.equal(mapPriorityFromLabels(["priority::low", "bug"]),  "low");
  });

  test("reads priority from short-form label", () => {
    assert.equal(mapPriorityFromLabels(["high"]),   "high");
    assert.equal(mapPriorityFromLabels(["medium"]), "medium");
  });

  test("severity field takes precedence over labels", () => {
    assert.equal(mapPriorityFromLabels(["priority::low"], "CRITICAL"), "critical");
    assert.equal(mapPriorityFromLabels(["high"],          "LOW"),      "low");
  });

  test("UNKNOWN severity falls back to medium", () => {
    assert.equal(mapPriorityFromLabels([], "UNKNOWN"), "medium");
  });

  test("label matching is case-insensitive", () => {
    assert.equal(mapPriorityFromLabels(["Priority::High"]), "high");
    assert.equal(mapPriorityFromLabels(["CRITICAL"]),       "critical");
  });
});

// ---------------------------------------------------------------------------
// buildUpdateFields
// ---------------------------------------------------------------------------

describe("buildUpdateFields", () => {
  test("returns empty object for empty fields", () => {
    assert.deepEqual(buildUpdateFields({}, IP_LABELS, PND_LABELS), {});
  });

  test("resolved status → state_event: close", () => {
    const out = buildUpdateFields({ status: "resolved" }, IP_LABELS, PND_LABELS);
    assert.equal(out.state_event, "close");
  });

  test("closed status → state_event: close", () => {
    const out = buildUpdateFields({ status: "closed" }, IP_LABELS, PND_LABELS);
    assert.equal(out.state_event, "close");
  });

  test("open status → state_event: reopen, removes in-progress/pending labels", () => {
    const out = buildUpdateFields({ status: "open" }, IP_LABELS, PND_LABELS);
    assert.equal(out.state_event, "reopen");
    const removed = String(out.remove_labels ?? "");
    assert.ok(removed.includes("in-progress"));
    assert.ok(removed.includes("blocked") || removed.includes("pending"));
  });

  test("in_progress status → state_event: reopen, adds first in-progress label", () => {
    const out = buildUpdateFields({ status: "in_progress" }, IP_LABELS, PND_LABELS);
    assert.equal(out.state_event, "reopen");
    assert.ok(String(out.add_labels ?? "").includes("in-progress"));
  });

  test("pending status → adds first pending label, removes in-progress labels", () => {
    const out = buildUpdateFields({ status: "pending" }, IP_LABELS, PND_LABELS);
    assert.ok(String(out.add_labels ?? "").includes("blocked") || String(out.add_labels ?? "").includes("pending"));
    assert.ok(String(out.remove_labels ?? "").includes("in-progress"));
    assert.equal(out.state_event, undefined);
  });

  test("assigneeId sets assignee_ids to [numeric id]", () => {
    const out = buildUpdateFields({ assigneeId: "42" }, IP_LABELS, PND_LABELS);
    assert.deepEqual(out.assignee_ids, [42]);
  });

  test("empty assigneeId sets assignee_ids to [] (unassign)", () => {
    const out = buildUpdateFields({ assigneeId: "" }, IP_LABELS, PND_LABELS);
    assert.deepEqual(out.assignee_ids, []);
  });

  test("priority sets add_labels with priority:: label and removes old priority:: labels", () => {
    const out = buildUpdateFields({ priority: "high" }, IP_LABELS, PND_LABELS);
    assert.ok(String(out.add_labels ?? "").includes("priority::high"));
    const removed = String(out.remove_labels ?? "");
    assert.ok(removed.includes("priority::critical"));
    assert.ok(removed.includes("priority::medium"));
    assert.ok(removed.includes("priority::low"));
  });

  test("combines status + assigneeId + priority in one object", () => {
    const out = buildUpdateFields(
      { status: "in_progress", assigneeId: "7", priority: "medium" },
      IP_LABELS,
      PND_LABELS
    );
    assert.equal(out.state_event, "reopen");
    assert.deepEqual(out.assignee_ids, [7]);
    assert.ok(String(out.add_labels ?? "").includes("priority::medium"));
  });

  test("custom inProgressLabels are used in add_labels", () => {
    const out = buildUpdateFields({ status: "in_progress" }, ["wip"], ["hold"]);
    assert.ok(String(out.add_labels ?? "").includes("wip"));
  });
});

// ---------------------------------------------------------------------------
// toUser
// ---------------------------------------------------------------------------

describe("toUser", () => {
  test("maps GitLab numeric id to string id", () => {
    const user = toUser({ id: 42, name: "Alice", username: "alice", email: "a@co.com" });
    assert.equal(user.id, "42");
    assert.equal(user.name, "Alice");
    assert.equal(user.email, "a@co.com");
  });

  test("email is undefined when absent", () => {
    const user = toUser({ id: 1, name: "Bob", username: "bob" });
    assert.equal(user.email, undefined);
  });
});
