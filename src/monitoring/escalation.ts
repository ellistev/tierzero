import { EventEmitter } from "events";
import type { NotificationManager } from "../comms/notification-manager";
import type { ActiveAlert } from "./alert-engine";
import { EscalationTriggered } from "../domain/monitoring/events";

export interface EscalationPolicy {
  alertSeverity: "critical" | "warning";
  waitBeforeEscalateMs: number;
  escalateVia: string[];
  escalateMessage: string;
  autoAction?: "pause" | "restart" | "shutdown";
}

export interface EscalationRecord {
  alertId: string;
  policyIndex: number;
  escalatedAt: string;
  channels: string[];
  autoAction?: string;
}

export interface EscalationManagerDeps {
  notificationManager?: NotificationManager;
  onAutoAction?: (action: "pause" | "restart" | "shutdown", alert: ActiveAlert) => void;
}

export class EscalationManager extends EventEmitter {
  private readonly policies: EscalationPolicy[] = [];
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly escalationLog: EscalationRecord[] = [];
  private readonly deps: EscalationManagerDeps;

  constructor(deps: EscalationManagerDeps = {}) {
    super();
    this.deps = deps;
  }

  addPolicy(policy: EscalationPolicy): void {
    this.policies.push(policy);
  }

  getPolicies(): EscalationPolicy[] {
    return [...this.policies];
  }

  getLog(): EscalationRecord[] {
    return [...this.escalationLog];
  }

  /**
   * Called when a new alert fires. Schedules escalation based on matching policies.
   */
  scheduleEscalation(alert: ActiveAlert): void {
    for (let i = 0; i < this.policies.length; i++) {
      const policy = this.policies[i];
      if (policy.alertSeverity !== alert.severity) continue;

      const timerKey = `${alert.id}:${i}`;
      if (this.pendingTimers.has(timerKey)) continue;

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timerKey);
        void this.executeEscalation(alert, policy, i);
      }, policy.waitBeforeEscalateMs);

      this.pendingTimers.set(timerKey, timer);
    }
  }

  /**
   * Called when an alert resolves. Cancels any pending escalation timers.
   */
  cancelEscalation(alertId: string): void {
    for (const [key, timer] of this.pendingTimers.entries()) {
      if (key.startsWith(`${alertId}:`)) {
        clearTimeout(timer);
        this.pendingTimers.delete(key);
      }
    }
  }

  /**
   * Force-execute escalation immediately (useful for testing or manual escalation).
   */
  async executeEscalation(
    alert: ActiveAlert,
    policy: EscalationPolicy,
    policyIndex: number
  ): Promise<void> {
    const now = new Date().toISOString();

    // Send notifications via configured channels
    if (this.deps.notificationManager) {
      for (const channelName of policy.escalateVia) {
        await this.deps.notificationManager.send(channelName, {
          to: channelName,
          subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          body: `${policy.escalateMessage}\n\nAlert: ${alert.title}\nDescription: ${alert.description}\nComponent: ${alert.component}\nTriggered: ${alert.triggeredAt}`,
          priority: alert.severity === "critical" ? "high" : "normal",
        });
      }
    }

    // Execute auto-action if configured
    if (policy.autoAction && this.deps.onAutoAction) {
      this.deps.onAutoAction(policy.autoAction, alert);
    }

    const record: EscalationRecord = {
      alertId: alert.id,
      policyIndex,
      escalatedAt: now,
      channels: [...policy.escalateVia],
      autoAction: policy.autoAction,
    };
    this.escalationLog.push(record);

    this.emit(
      "event",
      new EscalationTriggered(alert.id, policy.escalateVia, now)
    );
  }

  stop(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}
