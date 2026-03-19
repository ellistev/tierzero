import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationStore } from "./notifications";
import { NotificationSent, NotificationFailed, NotificationRuleTriggered } from "../domain/notification/events";

describe("NotificationStore", () => {
  it("should track NotificationSent", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "user@test.com", "Subject", "2026-03-18T10:00:00Z"));

    const record = store.get("n1");
    assert.ok(record);
    assert.equal(record.channelName, "email");
    assert.equal(record.recipient, "user@test.com");
    assert.equal(record.subject, "Subject");
    assert.equal(record.status, "sent");
  });

  it("should track NotificationFailed", () => {
    const store = new NotificationStore();
    store.apply(new NotificationFailed("n2", "slack", "Connection timeout", "2026-03-18T10:01:00Z"));

    const record = store.get("n2");
    assert.ok(record);
    assert.equal(record.channelName, "slack");
    assert.equal(record.status, "failed");
    assert.equal(record.error, "Connection timeout");
  });

  it("should track NotificationRuleTriggered", () => {
    const store = new NotificationStore();
    store.apply(new NotificationRuleTriggered("r1", "task.completed", 2, "2026-03-18T10:00:00Z"));

    const history = store.getRuleHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].ruleId, "r1");
    assert.equal(history[0].channelCount, 2);
  });

  it("should filter by channelName", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationSent("n2", "slack", "#gen", "S2", "2026-03-18T10:01:00Z"));
    store.apply(new NotificationSent("n3", "email", "b@test.com", "S3", "2026-03-18T10:02:00Z"));

    const emailOnly = store.list({ channelName: "email" });
    assert.equal(emailOnly.length, 2);
    emailOnly.forEach(r => assert.equal(r.channelName, "email"));
  });

  it("should filter by status", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationFailed("n2", "slack", "error", "2026-03-18T10:01:00Z"));

    const sent = store.list({ status: "sent" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].status, "sent");

    const failed = store.list({ status: "failed" });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, "failed");
  });

  it("should support limit and offset", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationSent("n2", "email", "b@test.com", "S2", "2026-03-18T10:01:00Z"));
    store.apply(new NotificationSent("n3", "email", "c@test.com", "S3", "2026-03-18T10:02:00Z"));

    assert.equal(store.list({ limit: 2 }).length, 2);
    assert.equal(store.list({ offset: 1, limit: 1 }).length, 1);
    assert.equal(store.list({ offset: 1, limit: 1 })[0].notificationId, "n2");
  });

  it("should return all via getAll()", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationFailed("n2", "slack", "err", "2026-03-18T10:01:00Z"));

    assert.equal(store.getAll().length, 2);
  });

  it("should calculate success rate", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationSent("n2", "email", "b@test.com", "S2", "2026-03-18T10:01:00Z"));
    store.apply(new NotificationFailed("n3", "email", "err", "2026-03-18T10:02:00Z"));
    store.apply(new NotificationSent("n4", "slack", "#gen", "S3", "2026-03-18T10:03:00Z"));

    const emailRate = store.getSuccessRate("email");
    assert.equal(emailRate.total, 3);
    assert.equal(emailRate.sent, 2);
    assert.equal(emailRate.failed, 1);
    assert.ok(Math.abs(emailRate.rate - 2 / 3) < 0.01);

    const overall = store.getSuccessRate();
    assert.equal(overall.total, 4);
    assert.equal(overall.sent, 3);
  });

  it("should return copies from get()", () => {
    const store = new NotificationStore();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));

    const r1 = store.get("n1");
    const r2 = store.get("n1");
    assert.notEqual(r1, r2); // different objects
    assert.deepEqual(r1, r2); // same content
  });

  it("should return undefined for unknown id", () => {
    const store = new NotificationStore();
    assert.equal(store.get("nonexistent"), undefined);
  });
});
