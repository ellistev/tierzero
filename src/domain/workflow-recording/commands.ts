export class StartRecording {
  static type = "StartRecording" as const;
  constructor(
    public readonly recordingId: string,
    public readonly name: string,
    public readonly sourceUrl: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new StartRecording(d.recordingId as string, d.name as string, d.sourceUrl as string, d.startedAt as string);
  }
}

export class AddAction {
  static type = "AddAction" as const;
  constructor(
    public readonly recordingId: string,
    public readonly actionIndex: number,
    public readonly addedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AddAction(d.recordingId as string, d.actionIndex as number, d.addedAt as string);
  }
}

export class AnnotateRecording {
  static type = "AnnotateRecording" as const;
  constructor(
    public readonly recordingId: string,
    public readonly description: string,
    public readonly annotatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AnnotateRecording(d.recordingId as string, d.description as string, d.annotatedAt as string);
  }
}

export class GenerateSkill {
  static type = "GenerateSkill" as const;
  constructor(
    public readonly recordingId: string,
    public readonly skillId: string,
    public readonly skillName: string,
    public readonly generatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new GenerateSkill(d.recordingId as string, d.skillId as string, d.skillName as string, d.generatedAt as string);
  }
}

export class CompleteRecording {
  static type = "CompleteRecording" as const;
  constructor(
    public readonly recordingId: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompleteRecording(d.recordingId as string, d.completedAt as string);
  }
}

export class FailRecording {
  static type = "FailRecording" as const;
  constructor(
    public readonly recordingId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailRecording(d.recordingId as string, d.error as string, d.failedAt as string);
  }
}
