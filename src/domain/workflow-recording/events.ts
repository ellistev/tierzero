export class RecordingStarted {
  static type = "RecordingStarted" as const;
  constructor(
    public readonly recordingId: string,
    public readonly name: string,
    public readonly sourceUrl: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordingStarted(d.recordingId as string, d.name as string, d.sourceUrl as string, d.startedAt as string);
  }
}

export class ActionAdded {
  static type = "ActionAdded" as const;
  constructor(
    public readonly recordingId: string,
    public readonly actionIndex: number,
    public readonly addedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new ActionAdded(d.recordingId as string, d.actionIndex as number, d.addedAt as string);
  }
}

export class RecordingAnnotated {
  static type = "RecordingAnnotated" as const;
  constructor(
    public readonly recordingId: string,
    public readonly description: string,
    public readonly annotatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordingAnnotated(d.recordingId as string, d.description as string, d.annotatedAt as string);
  }
}

export class SkillGenerated {
  static type = "SkillGenerated" as const;
  constructor(
    public readonly recordingId: string,
    public readonly skillId: string,
    public readonly skillName: string,
    public readonly generatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SkillGenerated(d.recordingId as string, d.skillId as string, d.skillName as string, d.generatedAt as string);
  }
}

export class RecordingCompleted {
  static type = "RecordingCompleted" as const;
  constructor(
    public readonly recordingId: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordingCompleted(d.recordingId as string, d.completedAt as string);
  }
}

export class RecordingFailed {
  static type = "RecordingFailed" as const;
  constructor(
    public readonly recordingId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordingFailed(d.recordingId as string, d.error as string, d.failedAt as string);
  }
}

export const workflowRecordingEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [RecordingStarted.type]: RecordingStarted.fromObject,
  [ActionAdded.type]: ActionAdded.fromObject,
  [RecordingAnnotated.type]: RecordingAnnotated.fromObject,
  [SkillGenerated.type]: SkillGenerated.fromObject,
  [RecordingCompleted.type]: RecordingCompleted.fromObject,
  [RecordingFailed.type]: RecordingFailed.fromObject,
};
