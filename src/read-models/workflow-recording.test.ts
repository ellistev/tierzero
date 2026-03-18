import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkflowRecordingStore } from "./workflow-recording";
import { RecordingStarted, ActionAdded, RecordingAnnotated, SkillGenerated, RecordingCompleted, RecordingFailed } from "../domain/workflow-recording/events";

describe("WorkflowRecordingStore", () => {
  it("should project RecordingStarted", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login flow", "https://example.com", "2026-01-01T00:00:00Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.recordingId, "r1");
    assert.equal(rec.name, "Login flow");
    assert.equal(rec.sourceUrl, "https://example.com");
    assert.equal(rec.status, "recording");
    assert.equal(rec.actionsCount, 0);
    assert.equal(rec.skillId, null);
    assert.equal(rec.completedAt, null);
    assert.equal(rec.error, null);
  });

  it("should project ActionAdded", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new ActionAdded("r1", 0, "2026-01-01T00:00:01Z"));
    store.apply(new ActionAdded("r1", 1, "2026-01-01T00:00:02Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.actionsCount, 2);
    assert.equal(rec.status, "recording");
  });

  it("should project RecordingAnnotated", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new RecordingAnnotated("r1", "Logs into app", "2026-01-01T00:00:02Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.status, "annotating");
    assert.equal(rec.description, "Logs into app");
  });

  it("should project SkillGenerated", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new SkillGenerated("r1", "s1", "login-skill", "2026-01-01T00:00:03Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.status, "generating");
    assert.equal(rec.skillId, "s1");
    assert.equal(rec.skillName, "login-skill");
  });

  it("should project RecordingCompleted", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new RecordingCompleted("r1", "2026-01-01T00:01:00Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.status, "completed");
    assert.equal(rec.completedAt, "2026-01-01T00:01:00Z");
  });

  it("should project RecordingFailed", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new RecordingFailed("r1", "Browser crashed", "2026-01-01T00:01:00Z"));

    const rec = store.get("r1");
    assert.ok(rec);
    assert.equal(rec.status, "failed");
    assert.equal(rec.error, "Browser crashed");
  });

  it("should return undefined for unknown recordingId", () => {
    const store = new WorkflowRecordingStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  it("should list all recordings", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new RecordingStarted("r2", "Checkout", "https://example.com/cart", "2026-01-01T00:00:01Z"));

    const all = store.getAll();
    assert.equal(all.length, 2);
  });

  it("should list with status filter", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));
    store.apply(new RecordingStarted("r2", "Checkout", "https://example.com/cart", "2026-01-01T00:00:01Z"));
    store.apply(new RecordingCompleted("r1", "2026-01-01T00:01:00Z"));

    const completed = store.list({ status: "completed" });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].recordingId, "r1");

    const recording = store.list({ status: "recording" });
    assert.equal(recording.length, 1);
    assert.equal(recording[0].recordingId, "r2");
  });

  it("should return copies from get, not references", () => {
    const store = new WorkflowRecordingStore();
    store.apply(new RecordingStarted("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"));

    const rec1 = store.get("r1");
    const rec2 = store.get("r1");
    assert.notEqual(rec1, rec2);
    assert.deepEqual(rec1, rec2);
  });
});
