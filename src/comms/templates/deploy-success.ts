import type { CommMessage } from "../channel";

export function deploySuccess(data: { version: string; environment: string; durationMs: number }): CommMessage {
  return {
    to: [],
    subject: `[TierZero] Deploy Succeeded: ${data.environment}`,
    body: `Deployed v${data.version} to ${data.environment} (${Math.round(data.durationMs / 1000)}s)`,
  };
}
