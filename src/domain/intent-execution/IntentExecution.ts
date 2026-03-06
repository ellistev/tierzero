import { Aggregate } from "../../infra/aggregate";
import { AttemptIntent, ResolveSelector, SucceedIntent, FailIntent, AttemptRecovery, SucceedRecovery, FailRecovery, EscalateIntent } from "./commands";
import { IntentAttempted, SelectorResolved, IntentSucceeded, IntentFailed, RecoveryAttempted, RecoverySucceeded, RecoveryFailed, IntentEscalated } from "./events";

interface IntentExecutionState extends Record<string, unknown> {
  intentId: string;
  intentName: string;
  goal: string;
  page: string;
  status: "attempting" | "resolved" | "succeeded" | "failed" | "recovering" | "escalated";
  attempts: number;
  resolvedSelector: string | null;
  method: string | null;
  recoveryAttempts: number;
}

export class IntentExecution extends Aggregate<IntentExecutionState> {
  static type = "IntentExecution" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(AttemptIntent, (_state, cmd) => {
      return [new IntentAttempted(cmd.intentId, cmd.intentName, cmd.goal, cmd.page, cmd.value, cmd.context, cmd.attemptedAt)];
    });

    this._registerCommandHandler(ResolveSelector, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status === "succeeded" || state.status === "escalated") throw new Error("Intent already finalized");
      return [new SelectorResolved(cmd.intentId, cmd.selector, cmd.method, cmd.durationMs, cmd.resolvedAt)];
    });

    this._registerCommandHandler(SucceedIntent, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status === "succeeded") throw new Error("Intent already succeeded");
      if (state.status === "escalated") throw new Error("Intent already escalated");
      return [new IntentSucceeded(cmd.intentId, cmd.selector, cmd.method, cmd.durationMs, cmd.succeededAt)];
    });

    this._registerCommandHandler(FailIntent, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status === "succeeded") throw new Error("Intent already succeeded");
      if (state.status === "escalated") throw new Error("Intent already escalated");
      return [new IntentFailed(cmd.intentId, cmd.error, cmd.failedAt)];
    });

    this._registerCommandHandler(AttemptRecovery, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status === "succeeded" || state.status === "escalated") throw new Error("Intent already finalized");
      return [new RecoveryAttempted(cmd.intentId, cmd.reason, cmd.strategy, cmd.attemptNumber, cmd.attemptedAt)];
    });

    this._registerCommandHandler(SucceedRecovery, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status !== "recovering") throw new Error("Not in recovery state");
      return [new RecoverySucceeded(cmd.intentId, cmd.strategy, cmd.detail, cmd.succeededAt)];
    });

    this._registerCommandHandler(FailRecovery, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status !== "recovering") throw new Error("Not in recovery state");
      return [new RecoveryFailed(cmd.intentId, cmd.strategy, cmd.error, cmd.failedAt)];
    });

    this._registerCommandHandler(EscalateIntent, (state, cmd) => {
      if (!state.intentId) throw new Error("Intent does not exist");
      if (state.status === "succeeded") throw new Error("Intent already succeeded");
      if (state.status === "escalated") throw new Error("Intent already escalated");
      return [new IntentEscalated(cmd.intentId, cmd.reason, cmd.escalatedAt)];
    });

    // Event handlers
    this._registerEventHandler(IntentAttempted, (_state, e) => ({
      intentId: e.intentId,
      intentName: e.intentName,
      goal: e.goal,
      page: e.page,
      status: "attempting" as const,
      attempts: 1,
      resolvedSelector: null,
      method: null,
      recoveryAttempts: 0,
    }));

    this._registerEventHandler(SelectorResolved, (state, e) => ({
      ...state,
      status: "resolved" as const,
      resolvedSelector: e.selector,
      method: e.method,
    }));

    this._registerEventHandler(IntentSucceeded, (state, e) => ({
      ...state,
      status: "succeeded" as const,
      resolvedSelector: e.selector,
      method: e.method,
    }));

    this._registerEventHandler(IntentFailed, (state, _e) => ({
      ...state,
      status: "failed" as const,
      attempts: state.attempts + 1,
    }));

    this._registerEventHandler(RecoveryAttempted, (state, _e) => ({
      ...state,
      status: "recovering" as const,
      recoveryAttempts: state.recoveryAttempts + 1,
    }));

    this._registerEventHandler(RecoverySucceeded, (state, _e) => ({
      ...state,
      status: "attempting" as const,
    }));

    this._registerEventHandler(RecoveryFailed, (state, _e) => ({
      ...state,
      status: "failed" as const,
    }));

    this._registerEventHandler(IntentEscalated, (state, _e) => ({
      ...state,
      status: "escalated" as const,
    }));
  }
}
