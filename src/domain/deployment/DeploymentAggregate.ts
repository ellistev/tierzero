import { Aggregate } from "../../infra/aggregate";
import { InitiateDeploy, RecordDeploySuccess, RecordDeployFailure, InitiateRollback, RecordRollbackComplete } from "./commands";
import { DeployInitiated, DeploySucceeded, DeployFailed, RollbackInitiated, RollbackCompleted } from "./events";

interface DeploymentState extends Record<string, unknown> {
  deployId: string;
  environment: string;
  version: string;
  previousVersion: string;
  strategy: string;
  status: "initiated" | "succeeded" | "failed" | "rolling_back" | "rolled_back";
  healthCheckPassed: boolean;
  error: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

export class DeploymentAggregate extends Aggregate<DeploymentState> {
  static type = "DeploymentAggregate" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(InitiateDeploy, (_state, cmd) => {
      return [new DeployInitiated(cmd.deployId, cmd.environment, cmd.version, cmd.strategy, cmd.initiatedAt)];
    });

    this._registerCommandHandler(RecordDeploySuccess, (state, cmd) => {
      if (!state.deployId) throw new Error("Deploy does not exist");
      if (state.status !== "initiated") throw new Error("Deploy not in initiated state");
      return [new DeploySucceeded(cmd.deployId, cmd.healthCheckPassed, cmd.completedAt)];
    });

    this._registerCommandHandler(RecordDeployFailure, (state, cmd) => {
      if (!state.deployId) throw new Error("Deploy does not exist");
      if (state.status !== "initiated") throw new Error("Deploy not in initiated state");
      return [new DeployFailed(cmd.deployId, cmd.error, cmd.failedAt)];
    });

    this._registerCommandHandler(InitiateRollback, (state, cmd) => {
      if (!state.deployId) throw new Error("Deploy does not exist");
      if (state.status !== "failed" && state.status !== "succeeded") throw new Error("Deploy not in a rollback-eligible state");
      return [new RollbackInitiated(cmd.deployId, cmd.reason, cmd.initiatedAt)];
    });

    this._registerCommandHandler(RecordRollbackComplete, (state, cmd) => {
      if (!state.deployId) throw new Error("Deploy does not exist");
      if (state.status !== "rolling_back") throw new Error("Deploy not in rolling_back state");
      return [new RollbackCompleted(cmd.deployId, cmd.restoredVersion, cmd.completedAt)];
    });

    // Event handlers
    this._registerEventHandler(DeployInitiated, (_state, e) => ({
      deployId: e.deployId,
      environment: e.environment,
      version: e.version,
      previousVersion: "",
      strategy: e.strategy,
      status: "initiated" as const,
      healthCheckPassed: false,
      error: null,
      initiatedAt: e.initiatedAt,
      completedAt: null,
    }));

    this._registerEventHandler(DeploySucceeded, (state, e) => ({
      ...state,
      status: "succeeded" as const,
      healthCheckPassed: e.healthCheckPassed,
      completedAt: e.completedAt,
    }));

    this._registerEventHandler(DeployFailed, (state, e) => ({
      ...state,
      status: "failed" as const,
      error: e.error,
      completedAt: e.failedAt,
    }));

    this._registerEventHandler(RollbackInitiated, (state, _e) => ({
      ...state,
      status: "rolling_back" as const,
    }));

    this._registerEventHandler(RollbackCompleted, (state, e) => ({
      ...state,
      status: "rolled_back" as const,
      previousVersion: e.restoredVersion,
      completedAt: e.completedAt,
    }));
  }
}
