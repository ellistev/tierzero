export class AgentSpawned {
  static type = "AgentSpawned" as const;
  constructor(
    public readonly processId: string,
    public readonly agentName: string,
    public readonly taskId: string,
    public readonly spawnedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentSpawned(
      d.processId as string, d.agentName as string,
      d.taskId as string, d.spawnedAt as string
    );
  }
}

export class AgentHeartbeatReceived {
  static type = "AgentHeartbeatReceived" as const;
  constructor(
    public readonly processId: string,
    public readonly progress: string,
    public readonly receivedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentHeartbeatReceived(
      d.processId as string, d.progress as string, d.receivedAt as string
    );
  }
}

export class AgentCompleted {
  static type = "AgentCompleted" as const;
  constructor(
    public readonly processId: string,
    public readonly taskId: string,
    public readonly result: unknown,
    public readonly completedAt: string,
    public readonly durationMs: number
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentCompleted(
      d.processId as string, d.taskId as string,
      d.result, d.completedAt as string, d.durationMs as number
    );
  }
}

export class AgentFailed {
  static type = "AgentFailed" as const;
  constructor(
    public readonly processId: string,
    public readonly taskId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentFailed(
      d.processId as string, d.taskId as string,
      d.error as string, d.failedAt as string
    );
  }
}

export class AgentHung {
  static type = "AgentHung" as const;
  constructor(
    public readonly processId: string,
    public readonly taskId: string,
    public readonly lastHeartbeatAt: string,
    public readonly detectedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentHung(
      d.processId as string, d.taskId as string,
      d.lastHeartbeatAt as string, d.detectedAt as string
    );
  }
}

export class AgentKilled {
  static type = "AgentKilled" as const;
  constructor(
    public readonly processId: string,
    public readonly taskId: string,
    public readonly reason: string,
    public readonly killedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentKilled(
      d.processId as string, d.taskId as string,
      d.reason as string, d.killedAt as string
    );
  }
}

export type AgentProcessEvent =
  | AgentSpawned
  | AgentHeartbeatReceived
  | AgentCompleted
  | AgentFailed
  | AgentHung
  | AgentKilled;

export const agentProcessEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [AgentSpawned.type]: AgentSpawned.fromObject,
  [AgentHeartbeatReceived.type]: AgentHeartbeatReceived.fromObject,
  [AgentCompleted.type]: AgentCompleted.fromObject,
  [AgentFailed.type]: AgentFailed.fromObject,
  [AgentHung.type]: AgentHung.fromObject,
  [AgentKilled.type]: AgentKilled.fromObject,
};
