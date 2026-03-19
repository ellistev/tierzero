import type { JobInput } from "../scheduler";
import { systemHealthJob } from "./system-health";
import { connectorHealthJob } from "./connector-health";
import { dailyReportJob } from "./daily-report";
import { knowledgeMaintenanceJob } from "./knowledge-maintenance";
import { testSuiteJob } from "./test-suite";

export const builtInJobs: JobInput[] = [
  systemHealthJob,
  connectorHealthJob,
  dailyReportJob,
  knowledgeMaintenanceJob,
  testSuiteJob,
];

export { systemHealthJob, connectorHealthJob, dailyReportJob, knowledgeMaintenanceJob, testSuiteJob };
