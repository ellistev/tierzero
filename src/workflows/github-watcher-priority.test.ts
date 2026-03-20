import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitHubWatcher } from "./github-watcher";
import type { Ticket } from "../connectors/types";

// Helper to create a minimal ticket with tags
function makeTicket(id: string, tags: string[] = []): Ticket {
  return {
    id,
    title: `Issue #${id}`,
    description: "",
    status: "open",
    tags,
    source: "github",
    reporter: { id: "testuser", name: "testuser" },
  } as Ticket;
}

describe("GitHubWatcher.getPriority", () => {
  it("extracts priority from priority-N label", () => {
    assert.equal(GitHubWatcher.getPriority(makeTicket("1", ["priority-1"])), 1);
    assert.equal(GitHubWatcher.getPriority(makeTicket("2", ["priority-5"])), 5);
    assert.equal(GitHubWatcher.getPriority(makeTicket("3", ["priority-100"])), 100);
  });

  it("returns 999 when no priority label exists", () => {
    assert.equal(GitHubWatcher.getPriority(makeTicket("1", ["bug", "tierzero-agent"])), 999);
    assert.equal(GitHubWatcher.getPriority(makeTicket("2", [])), 999);
    assert.equal(GitHubWatcher.getPriority(makeTicket("3")), 999);
  });

  it("ignores labels that look similar but don't match", () => {
    assert.equal(GitHubWatcher.getPriority(makeTicket("1", ["priority-high"])), 999);
    assert.equal(GitHubWatcher.getPriority(makeTicket("2", ["priority-"])), 999);
    assert.equal(GitHubWatcher.getPriority(makeTicket("3", ["my-priority-1"])), 999);
  });
});

describe("Priority-based sorting", () => {
  it("sorts mixed priorities correctly", () => {
    const tickets = [
      makeTicket("10", ["priority-3"]),
      makeTicket("5", ["priority-1"]),
      makeTicket("20", []),
      makeTicket("8", ["priority-2"]),
    ];

    tickets.sort((a, b) => {
      const aPri = GitHubWatcher.getPriority(a);
      const bPri = GitHubWatcher.getPriority(b);
      if (aPri !== bPri) return aPri - bPri;
      return parseInt(a.id) - parseInt(b.id);
    });

    assert.deepEqual(
      tickets.map((t) => t.id),
      ["5", "8", "10", "20"],
    );
  });

  it("sorts same priority by issue number ascending", () => {
    const tickets = [
      makeTicket("15", ["priority-1"]),
      makeTicket("3", ["priority-1"]),
      makeTicket("9", ["priority-1"]),
    ];

    tickets.sort((a, b) => {
      const aPri = GitHubWatcher.getPriority(a);
      const bPri = GitHubWatcher.getPriority(b);
      if (aPri !== bPri) return aPri - bPri;
      return parseInt(a.id) - parseInt(b.id);
    });

    assert.deepEqual(
      tickets.map((t) => t.id),
      ["3", "9", "15"],
    );
  });

  it("sorts by issue number when no priority labels exist", () => {
    const tickets = [
      makeTicket("30", ["bug"]),
      makeTicket("10", ["enhancement"]),
      makeTicket("20", []),
    ];

    tickets.sort((a, b) => {
      const aPri = GitHubWatcher.getPriority(a);
      const bPri = GitHubWatcher.getPriority(b);
      if (aPri !== bPri) return aPri - bPri;
      return parseInt(a.id) - parseInt(b.id);
    });

    assert.deepEqual(
      tickets.map((t) => t.id),
      ["10", "20", "30"],
    );
  });

  it("puts prioritized issues before unprioritized ones", () => {
    const tickets = [
      makeTicket("1", []),
      makeTicket("2", ["priority-5"]),
      makeTicket("3", []),
      makeTicket("4", ["priority-2"]),
    ];

    tickets.sort((a, b) => {
      const aPri = GitHubWatcher.getPriority(a);
      const bPri = GitHubWatcher.getPriority(b);
      if (aPri !== bPri) return aPri - bPri;
      return parseInt(a.id) - parseInt(b.id);
    });

    assert.deepEqual(
      tickets.map((t) => t.id),
      ["4", "2", "1", "3"],
    );
  });
});
