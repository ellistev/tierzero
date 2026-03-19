import type { JobInput } from "../scheduler";

export const dailyReportJob: JobInput = {
  id: "daily-report",
  name: "Daily Summary Report",
  description: "Generate daily summary of tasks completed, failed, pending, agent utilization, and alerts. Send via Communication Layer.",
  schedule: "0 9 * * *",
  timezone: "UTC",
  taskTemplate: {
    title: "Daily Summary Report",
    description: "Generate daily summary (tasks completed, failed, pending, agent utilization, alerts) and send via Communication Layer",
    category: "communication",
    priority: "normal",
  },
  enabled: true,
  maxConcurrent: 1,
  catchUp: false,
  maxConsecutiveFailures: 5,
};
