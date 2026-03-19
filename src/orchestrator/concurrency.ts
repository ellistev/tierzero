export interface ConcurrencyUtilization {
  total: number;
  max: number;
  byType: Record<string, { running: number; max: number }>;
}

export class ConcurrencyManager {
  private readonly maxTotal: number;
  private totalRunning = 0;
  private readonly limits = new Map<string, number>();
  private readonly running = new Map<string, number>();

  constructor(maxTotal: number) {
    this.maxTotal = maxTotal;
  }

  /** Register a per-agent-type concurrency limit */
  setLimit(agentType: string, max: number): void {
    this.limits.set(agentType, max);
    if (!this.running.has(agentType)) {
      this.running.set(agentType, 0);
    }
  }

  /** Try to acquire a slot for an agent type. Returns false if at capacity. */
  acquire(agentType: string): boolean {
    if (this.totalRunning >= this.maxTotal) return false;
    const max = this.limits.get(agentType);
    const current = this.running.get(agentType) ?? 0;
    if (max !== undefined && current >= max) return false;
    this.running.set(agentType, current + 1);
    this.totalRunning++;
    return true;
  }

  /** Release a slot when agent completes */
  release(agentType: string): void {
    const current = this.running.get(agentType) ?? 0;
    if (current > 0) {
      this.running.set(agentType, current - 1);
      this.totalRunning--;
    }
  }

  /** Check if a slot is available */
  available(agentType: string): boolean {
    if (this.totalRunning >= this.maxTotal) return false;
    const max = this.limits.get(agentType);
    const current = this.running.get(agentType) ?? 0;
    if (max !== undefined && current >= max) return false;
    return true;
  }

  /** Get current utilization */
  utilization(): ConcurrencyUtilization {
    const byType: Record<string, { running: number; max: number }> = {};
    for (const [type, max] of this.limits) {
      byType[type] = { running: this.running.get(type) ?? 0, max };
    }
    return { total: this.totalRunning, max: this.maxTotal, byType };
  }
}
