import type { CommMessage } from "../channel";

export function prCreated(data: { title: string; prNumber: number; prUrl: string; branch: string; taskId: string }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] PR Created: #${data.prNumber} ${data.title}`,
    body: `A pull request has been created for review.\n\nPR #${data.prNumber}: ${data.title}\nBranch: ${data.branch}\nURL: ${data.prUrl}\n\nTask ID: ${data.taskId}`,
  };
}
