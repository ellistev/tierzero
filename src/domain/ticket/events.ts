export class TicketReceived {
  static type = "TicketReceived" as const;
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly description: string,
    public readonly source: string,
    public readonly fields: Record<string, unknown>,
    public readonly receivedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketReceived(d.id as string, d.title as string, d.description as string, d.source as string, (d.fields ?? {}) as Record<string, unknown>, d.receivedAt as string);
  }
}

export class TicketAnalyzed {
  static type = "TicketAnalyzed" as const;
  constructor(
    public readonly ticketId: string,
    public readonly extractedFields: Record<string, unknown>,
    public readonly analysisResult: string,
    public readonly analyzedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketAnalyzed(d.ticketId as string, (d.extractedFields ?? {}) as Record<string, unknown>, d.analysisResult as string, d.analyzedAt as string);
  }
}

export class TicketMatchedToWorkflow {
  static type = "TicketMatchedToWorkflow" as const;
  constructor(
    public readonly ticketId: string,
    public readonly workflowId: string,
    public readonly confidence: number,
    public readonly matchedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketMatchedToWorkflow(d.ticketId as string, d.workflowId as string, d.confidence as number, d.matchedAt as string);
  }
}

export class TicketEscalated {
  static type = "TicketEscalated" as const;
  constructor(
    public readonly ticketId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketEscalated(d.ticketId as string, d.reason as string, d.escalatedAt as string);
  }
}

export class TicketResolved {
  static type = "TicketResolved" as const;
  constructor(
    public readonly ticketId: string,
    public readonly resolution: string,
    public readonly resolvedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketResolved(d.ticketId as string, d.resolution as string, d.resolvedAt as string);
  }
}

export class TicketCommentPosted {
  static type = "TicketCommentPosted" as const;
  constructor(
    public readonly ticketId: string,
    public readonly comment: string,
    public readonly isInternal: boolean,
    public readonly postedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TicketCommentPosted(d.ticketId as string, d.comment as string, d.isInternal as boolean, d.postedAt as string);
  }
}

export const ticketEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [TicketReceived.type]: TicketReceived.fromObject,
  [TicketAnalyzed.type]: TicketAnalyzed.fromObject,
  [TicketMatchedToWorkflow.type]: TicketMatchedToWorkflow.fromObject,
  [TicketEscalated.type]: TicketEscalated.fromObject,
  [TicketResolved.type]: TicketResolved.fromObject,
  [TicketCommentPosted.type]: TicketCommentPosted.fromObject,
};
