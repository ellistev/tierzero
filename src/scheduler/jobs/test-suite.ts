import type { JobInput } from "../scheduler";

export const testSuiteJob: JobInput = {
  id: "test-suite",
  name: "Test Suite Runner",
  description: "Run npm test on main branch, alert if failures",
  schedule: "0 */6 * * *",
  taskTemplate: {
    title: "Test Suite Runner",
    description: "Run npm test on main branch and alert if failures occur",
    category: "code",
    priority: "normal",
  },
  enabled: true,
  maxConcurrent: 1,
  catchUp: false,
  maxConsecutiveFailures: 5,
};
