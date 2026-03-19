export class AddKnowledge {
  static type = "AddKnowledge" as const;
  constructor(
    public readonly id: string,
    public readonly type: string,
    public readonly title: string,
    public readonly content: string,
    public readonly source: { taskId: string; agentName: string; timestamp: string },
    public readonly tags: string[],
    public readonly relatedFiles: string[],
    public readonly confidence: number
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AddKnowledge(
      d.id as string, d.type as string, d.title as string, d.content as string,
      d.source as { taskId: string; agentName: string; timestamp: string },
      d.tags as string[], d.relatedFiles as string[], d.confidence as number
    );
  }
}

export class RecordKnowledgeUsage {
  static type = "RecordKnowledgeUsage" as const;
  constructor(
    public readonly id: string,
    public readonly taskId: string,
    public readonly usedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordKnowledgeUsage(d.id as string, d.taskId as string, d.usedAt as string);
  }
}

export class SupersedeKnowledge {
  static type = "SupersedeKnowledge" as const;
  constructor(
    public readonly oldId: string,
    public readonly newId: string,
    public readonly reason: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SupersedeKnowledge(d.oldId as string, d.newId as string, d.reason as string);
  }
}
