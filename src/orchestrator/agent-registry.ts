export interface TaskResult {
  success: boolean;
  output: unknown;
  filesChanged?: string[];
  error?: string;
  durationMs: number;
}

export interface NormalizedTask {
  taskId: string;
  source: TaskSource;
  title: string;
  description: string;
  category: 'code' | 'communication' | 'research' | 'operations' | 'monitoring';
  priority: 'critical' | 'high' | 'normal' | 'low';
  assignedAgent: string | null;
  status: 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'escalated';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
}

export interface TaskSource {
  type: 'github' | 'email' | 'webhook' | 'schedule' | 'slack' | 'discord' | 'manual';
  id: string;
  payload: unknown;
  receivedAt: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  metadata?: Record<string, unknown>;
}

export interface AgentDefinition {
  name: string;
  type: string;
  capabilities: string[];
  maxConcurrent: number;
  available: boolean;
  execute: (task: NormalizedTask) => Promise<TaskResult>;
}

export interface AgentUtilization {
  name: string;
  type: string;
  capabilities: string[];
  maxConcurrent: number;
  available: boolean;
  runningTasks: number;
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  private runningCounts = new Map<string, number>();

  register(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
    this.runningCounts.set(agent.name, 0);
  }

  unregister(name: string): void {
    this.agents.delete(name);
    this.runningCounts.delete(name);
  }

  getAgent(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /** Find an available agent that can handle the given category */
  findAgent(category: string): AgentDefinition | null {
    for (const agent of this.agents.values()) {
      if (!agent.available) continue;
      if (!agent.capabilities.includes(category)) continue;
      const running = this.runningCounts.get(agent.name) ?? 0;
      if (running >= agent.maxConcurrent) continue;
      return agent;
    }
    return null;
  }

  /** Mark an agent as having one more running task */
  markRunning(name: string): void {
    const current = this.runningCounts.get(name) ?? 0;
    this.runningCounts.set(name, current + 1);
  }

  /** Mark an agent as having one fewer running task */
  markDone(name: string): void {
    const current = this.runningCounts.get(name) ?? 0;
    this.runningCounts.set(name, Math.max(0, current - 1));
  }

  /** Get utilization info for all agents */
  listAgents(): AgentUtilization[] {
    const result: AgentUtilization[] = [];
    for (const agent of this.agents.values()) {
      result.push({
        name: agent.name,
        type: agent.type,
        capabilities: [...agent.capabilities],
        maxConcurrent: agent.maxConcurrent,
        available: agent.available,
        runningTasks: this.runningCounts.get(agent.name) ?? 0,
      });
    }
    return result;
  }
}
