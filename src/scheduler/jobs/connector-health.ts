import type { JobInput } from "../scheduler";

export const connectorHealthJob: JobInput = {
  id: "connector-health",
  name: "Connector Health Check",
  description: "Run healthCheck() on all registered connectors",
  schedule: "*/15 * * * *",
  taskTemplate: {
    title: "Connector Health Check",
    description: "Run healthCheck() on all registered connectors",
    category: "monitoring",
    priority: "normal",
  },
  enabled: true,
  maxConcurrent: 1,
  catchUp: false,
  maxConsecutiveFailures: 5,
};
