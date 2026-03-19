import type { JobInput } from "../scheduler";

export const systemHealthJob: JobInput = {
  id: "system-health",
  name: "System Health Check",
  description: "Run health aggregator, record metrics, check alert rules",
  schedule: "*/5 * * * *",
  taskTemplate: {
    title: "System Health Check",
    description: "Run health aggregator, record metrics, and check alert rules",
    category: "monitoring",
    priority: "high",
  },
  enabled: true,
  maxConcurrent: 1,
  catchUp: false,
  maxConsecutiveFailures: 5,
};
