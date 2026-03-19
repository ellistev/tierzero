import type { JobInput } from "../scheduler";

export const knowledgeMaintenanceJob: JobInput = {
  id: "knowledge-maintenance",
  name: "Knowledge Maintenance",
  description: "Identify low-confidence knowledge entries, superseded entries, unused entries (>30 days). Generate maintenance report.",
  schedule: "0 0 * * 0",
  taskTemplate: {
    title: "Knowledge Maintenance",
    description: "Identify low-confidence, superseded, and unused (>30 days) knowledge entries. Generate maintenance report.",
    category: "operations",
    priority: "low",
  },
  enabled: true,
  maxConcurrent: 1,
  catchUp: false,
  maxConsecutiveFailures: 5,
};
