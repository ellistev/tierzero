import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EscalationManager } from "./escalation";
import type { ActiveAlert } from "./alert-engine";
import { EscalationTriggered } from "../domain/monitoring/events";

function makeAlert(overrides?: Partial<ActiveAlert>): ActiveAlert {
  return {
    id: "alert-1",
    severity: "critical",
    title: "Agent Hung",
    description: "Agent process is not responding",
    component: "agents",
    triggeredAt: new Date().toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    ruleId: "agent-hung",
    ...overrides,
  };
}

describe("EscalationManager", () => {
  it("should add and retrieve policies", () => {
    const mgr = new EscalationManager();
    mgr.addPolicy({
      alertSeverity: "critical",
      waitBeforeEscalateMs: 120000,
      escalateVia: ["email", "slack"],
      escalateMessage: "Critical alert requires attention",
    });

    assert.equal(mgr.getPolicies().length, 1);
  });

  it("should execute escalation and send notifications", async () => {
    const sentMessages: Array<{ channel: string; message: any }> = [];

    const fakeNotificationManager = {
      send: async (channel: string, message: any) => {
        sentMessages.push({ channel, message });
        return { success: true, sentAt: new Date().toISOString() };
      },
    };

    const mgr = new EscalationManager({
      notificationManager: fakeNotificationManager as any,
    });

    const policy = {
      alertSeverity: "critical" as const,
      waitBeforeEscalateMs: 0,
      escalateVia: ["email", "slack"],
      escalateMessage: "Urgent: system needs attention",
    };
    mgr.addPolicy(policy);

    const alert = makeAlert();
    await mgr.executeEscalation(alert, policy, 0);

    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].channel, "email");
    assert.equal(sentMessages[1].channel, "slack");
    assert.ok(sentMessages[0].message.subject.includes("CRITICAL"));
  });

  it("should emit EscalationTriggered event", async () => {
    const mgr = new EscalationManager();

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    const policy = {
      alertSeverity: "critical" as const,
      waitBeforeEscalateMs: 0,
      escalateVia: ["email"],
      escalateMessage: "Test",
    };

    await mgr.executeEscalation(makeAlert(), policy, 0);

    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof EscalationTriggered);
    assert.deepEqual((events[0] as EscalationTriggered).channels, ["email"]);
  });

  it("should log escalation records", async () => {
    const mgr = new EscalationManager();

    const policy = {
      alertSeverity: "critical" as const,
      waitBeforeEscalateMs: 0,
      escalateVia: ["slack"],
      escalateMessage: "Alert!",
    };

    await mgr.executeEscalation(makeAlert(), policy, 0);

    const log = mgr.getLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].alertId, "alert-1");
    assert.deepEqual(log[0].channels, ["slack"]);
  });

  it("should execute auto-action when configured", async () => {
    const actions: Array<{ action: string; alert: ActiveAlert }> = [];

    const mgr = new EscalationManager({
      onAutoAction: (action, alert) => {
        actions.push({ action, alert });
      },
    });

    const policy = {
      alertSeverity: "critical" as const,
      waitBeforeEscalateMs: 0,
      escalateVia: [],
      escalateMessage: "Auto restart",
      autoAction: "restart" as const,
    };

    const alert = makeAlert();
    await mgr.executeEscalation(alert, policy, 0);

    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "restart");
    assert.equal(actions[0].alert.id, "alert-1");
  });

  it("should schedule and cancel escalation", async () => {
    const mgr = new EscalationManager();
    mgr.addPolicy({
      alertSeverity: "critical",
      waitBeforeEscalateMs: 100000, // long enough it won't fire
      escalateVia: ["email"],
      escalateMessage: "Test",
    });

    const alert = makeAlert();
    mgr.scheduleEscalation(alert);

    // Cancel before it fires
    mgr.cancelEscalation(alert.id);

    // No escalation should have happened
    assert.equal(mgr.getLog().length, 0);

    mgr.stop();
  });

  it("should schedule escalation with short timer", async () => {
    const sentMessages: Array<{ channel: string }> = [];

    const fakeNotificationManager = {
      send: async (channel: string) => {
        sentMessages.push({ channel });
        return { success: true, sentAt: new Date().toISOString() };
      },
    };

    const mgr = new EscalationManager({
      notificationManager: fakeNotificationManager as any,
    });

    mgr.addPolicy({
      alertSeverity: "critical",
      waitBeforeEscalateMs: 50, // 50ms
      escalateVia: ["email"],
      escalateMessage: "Urgent",
    });

    const alert = makeAlert();
    mgr.scheduleEscalation(alert);

    // Wait for timer to fire
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.equal(sentMessages.length, 1);
    assert.equal(mgr.getLog().length, 1);

    mgr.stop();
  });

  it("should only match policies by severity", () => {
    const mgr = new EscalationManager();
    mgr.addPolicy({
      alertSeverity: "warning",
      waitBeforeEscalateMs: 100000,
      escalateVia: ["email"],
      escalateMessage: "Warning",
    });

    // Critical alert should not match warning policy
    const alert = makeAlert({ severity: "critical" });
    mgr.scheduleEscalation(alert);

    // No timers should have been set (no matching policy)
    mgr.cancelEscalation(alert.id);
    assert.equal(mgr.getLog().length, 0);

    mgr.stop();
  });

  it("should stop all pending timers on stop()", () => {
    const mgr = new EscalationManager();
    mgr.addPolicy({
      alertSeverity: "critical",
      waitBeforeEscalateMs: 100000,
      escalateVia: ["email"],
      escalateMessage: "Test",
    });

    mgr.scheduleEscalation(makeAlert());
    mgr.scheduleEscalation(makeAlert({ id: "alert-2" }));

    // stop should clear all timers without error
    mgr.stop();
    assert.equal(mgr.getLog().length, 0);
  });
});
