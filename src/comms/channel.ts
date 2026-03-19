export interface CommChannel {
  name: string;
  type: 'email' | 'slack' | 'discord' | 'webhook' | 'telegram';

  send(message: CommMessage): Promise<CommResult>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}

export interface CommMessage {
  to: string | string[];
  subject?: string;
  body: string;
  bodyHtml?: string;
  priority?: 'high' | 'normal' | 'low';
  threadId?: string;
  attachments?: CommAttachment[];
  metadata?: Record<string, unknown>;
}

export interface CommAttachment {
  filename: string;
  content: string | Buffer;
  mimeType: string;
}

export interface CommResult {
  success: boolean;
  messageId?: string;
  error?: string;
  sentAt: string;
}
