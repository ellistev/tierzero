import type { TaskSource } from "../agent-registry";

export interface InputAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onTask: (source: TaskSource) => void;
}

export interface ScheduledTask {
  id: string;
  cron: string;
  taskTemplate: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
  };
  enabled: boolean;
}
