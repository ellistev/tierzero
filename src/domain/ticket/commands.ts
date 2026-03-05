export class ReceiveTicket {
  static type = "ReceiveTicket" as const;
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly description: string,
    public readonly source: string,
    public readonly fields: Record<string, unknown>,
    public readonly receivedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new ReceiveTicket(d.id as string, d.title as string, d.description as string, d.source as string, (d.fields ?? {}) as Record<string, unknown>, d.receivedAt as string);
  }
}

export class AnalyzeTicket {
  static type = "AnalyzeTicket" as const;
  constructor(
    public readonly ticketId: string,
    public readonly extractedFields: Record<string, unknown>,
    public readonly analysisResult: string,
    public readonly analyzedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AnalyzeTicket(d.ticketId as string, (d.extractedFields ?? {}) as Record<string, unknown>, d.analysisResult as string, d.analyzedAt as string);
  }
}

export class MatchToWorkflow {
  static type = "MatchToWorkflow" as const;
  constructor(
    public readonly ticketId: string,
    public readonly workflowId: string,
    public readonly confidence: number,
    public readonly matchedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new MatchToWorkflow(d.ticketId as string, d.workflowId as string, d.confidence as number, d.matchedAt as string);
  }
}

export class EscalateTicket {
  static type = "EscalateTicket" as const;
  constructor(
    public readonly ticketId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new EscalateTicket(d.ticketId as string, d.reason as string, d.escalatedAt as string);
  }
}

export class ResolveTicket {
  static type = "ResolveTicket" as const;
  constructor(
    public readonly ticketId: string,
    public readonly resolution: string,
    public readonly resolvedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new ResolveTicket(d.ticketId as string, d.resolution as string, d.resolvedAt as string);
  }
}

export class PostComment {
  static type = "PostComment" as const;
  constructor(
    public readonly ticketId: string,
    public readonly comment: string,
    public readonly isInternal: boolean,
    public readonly postedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new PostComment(d.ticketId as string, d.comment as string, d.isInternal as boolean, d.postedAt as string);
  }
}
