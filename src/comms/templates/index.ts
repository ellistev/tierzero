export { taskCompleted } from "./task-completed";
export { taskFailed } from "./task-failed";
export { taskEscalated } from "./task-escalated";
export { agentHung } from "./agent-hung";
export { healthReport } from "./health-report";
export { prCreated } from "./pr-created";
export { deploySuccess } from "./deploy-success";
export { deployFailed } from "./deploy-failed";

import type { CommMessage } from "../channel";
import { taskCompleted } from "./task-completed";
import { taskFailed } from "./task-failed";
import { taskEscalated } from "./task-escalated";
import { agentHung } from "./agent-hung";
import { healthReport } from "./health-report";
import { prCreated } from "./pr-created";
import { deploySuccess } from "./deploy-success";
import { deployFailed } from "./deploy-failed";

export type TemplateName = 'task-completed' | 'task-failed' | 'task-escalated' | 'agent-hung' | 'health-report' | 'pr-created' | 'deploy-success' | 'deploy-failed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const templateMap: Record<TemplateName, (data: any) => CommMessage> = {
  "task-completed": taskCompleted,
  "task-failed": taskFailed,
  "task-escalated": taskEscalated,
  "agent-hung": agentHung,
  "health-report": healthReport,
  "pr-created": prCreated,
  "deploy-success": deploySuccess,
  "deploy-failed": deployFailed,
};

export function renderTemplate(name: string, data: unknown): CommMessage | null {
  const fn = templateMap[name as TemplateName];
  if (!fn) return null;
  return fn(data);
}
