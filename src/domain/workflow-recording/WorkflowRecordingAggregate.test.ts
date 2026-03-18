import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkflowRecordingAggregate } from "./WorkflowRecordingAggregate";
import { StartRecording, AddAction, AnnotateRecording, GenerateSkill, CompleteRecording, FailRecording } from "./commands";
import { RecordingStarted, ActionAdded, RecordingAnnotated, SkillGenerated, RecordingCompleted, RecordingFailed } from "./events";

describe("WorkflowRecordingAggregate", () => {
  function startedAggregate() {
    const agg = new WorkflowRecordingAggregate();
    const events = agg.execute(new StartRecording("r1", "Login flow", "https://app.example.com/login", "2026-01-01T00:00:00Z"));
    for (const e of events!) agg.hydrate(e);
    return agg;
  }

  it("should start a recording", () => {
    const agg = new WorkflowRecordingAggregate();
    const events = agg.execute(new StartRecording("r1", "Login flow", "https://app.example.com/login", "2026-01-01T00:00:00Z"));
    assert.equal(events!.length, 1);
    const e = events![0] as RecordingStarted;
    assert.equal(e.constructor, RecordingStarted);
    assert.equal(e.recordingId, "r1");
    assert.equal(e.name, "Login flow");
    assert.equal(e.sourceUrl, "https://app.example.com/login");
  });

  it("should add actions", () => {
    const agg = startedAggregate();
    const events = agg.execute(new AddAction("r1", 0, "2026-01-01T00:00:01Z"));
    assert.equal(events!.length, 1);
    assert.equal((events![0] as ActionAdded).actionIndex, 0);
  });

  it("should annotate recording", () => {
    const agg = startedAggregate();
    const events = agg.execute(new AnnotateRecording("r1", "Logs into the app", "2026-01-01T00:00:02Z"));
    assert.equal(events!.length, 1);
    const e = events![0] as RecordingAnnotated;
    assert.equal(e.description, "Logs into the app");

    // After annotation, status should be annotating
    agg.hydrate(e);
    // Generating skill should now work
    const genEvents = agg.execute(new GenerateSkill("r1", "s1", "login-skill", "2026-01-01T00:00:03Z"));
    assert.equal(genEvents!.length, 1);
  });

  it("should reject GenerateSkill when not annotating", () => {
    const agg = startedAggregate();
    assert.throws(() => {
      agg.execute(new GenerateSkill("r1", "s1", "login-skill", "2026-01-01T00:00:03Z"));
    }, /not in annotating state/);
  });

  it("should complete recording", () => {
    const agg = startedAggregate();
    const events = agg.execute(new CompleteRecording("r1", "2026-01-01T00:01:00Z"));
    assert.equal(events!.length, 1);
    assert.equal((events![0] as RecordingCompleted).completedAt, "2026-01-01T00:01:00Z");
  });

  it("should fail recording", () => {
    const agg = startedAggregate();
    const events = agg.execute(new FailRecording("r1", "Browser crashed", "2026-01-01T00:01:00Z"));
    assert.equal(events!.length, 1);
    assert.equal((events![0] as RecordingFailed).error, "Browser crashed");
  });

  it("should reject commands on finished recording", () => {
    const agg = startedAggregate();
    const events = agg.execute(new CompleteRecording("r1", "2026-01-01T00:01:00Z"));
    for (const e of events!) agg.hydrate(e);

    assert.throws(() => {
      agg.execute(new CompleteRecording("r1", "2026-01-01T00:02:00Z"));
    }, /already finished/);

    assert.throws(() => {
      agg.execute(new FailRecording("r1", "err", "2026-01-01T00:02:00Z"));
    }, /already finished/);
  });

  it("should reject AddAction when not in recording state", () => {
    const agg = startedAggregate();
    // Annotate to change status
    const annotateEvents = agg.execute(new AnnotateRecording("r1", "desc", "2026-01-01T00:00:02Z"));
    for (const e of annotateEvents!) agg.hydrate(e);

    assert.throws(() => {
      agg.execute(new AddAction("r1", 1, "2026-01-01T00:00:03Z"));
    }, /not in recording state/);
  });

  it("should track full lifecycle via hydration", () => {
    const agg = new WorkflowRecordingAggregate();
    const allEvents: unknown[] = [];

    const start = agg.execute(new StartRecording("r1", "Login", "https://example.com", "2026-01-01T00:00:00Z"))!;
    for (const e of start) { agg.hydrate(e); allEvents.push(e); }

    const action = agg.execute(new AddAction("r1", 0, "2026-01-01T00:00:01Z"))!;
    for (const e of action) { agg.hydrate(e); allEvents.push(e); }

    const annotate = agg.execute(new AnnotateRecording("r1", "Login workflow", "2026-01-01T00:00:02Z"))!;
    for (const e of annotate) { agg.hydrate(e); allEvents.push(e); }

    const gen = agg.execute(new GenerateSkill("r1", "s1", "login", "2026-01-01T00:00:03Z"))!;
    for (const e of gen) { agg.hydrate(e); allEvents.push(e); }

    const complete = agg.execute(new CompleteRecording("r1", "2026-01-01T00:00:04Z"))!;
    for (const e of complete) { agg.hydrate(e); allEvents.push(e); }

    assert.equal(allEvents.length, 5);
  });

  it("should have correct static type", () => {
    assert.equal(WorkflowRecordingAggregate.type, "WorkflowRecordingAggregate");
  });

  it("events should have correct static types", () => {
    assert.equal(RecordingStarted.type, "RecordingStarted");
    assert.equal(ActionAdded.type, "ActionAdded");
    assert.equal(RecordingAnnotated.type, "RecordingAnnotated");
    assert.equal(SkillGenerated.type, "SkillGenerated");
    assert.equal(RecordingCompleted.type, "RecordingCompleted");
    assert.equal(RecordingFailed.type, "RecordingFailed");
  });

  it("commands should have correct static types", () => {
    assert.equal(StartRecording.type, "StartRecording");
    assert.equal(AddAction.type, "AddAction");
    assert.equal(AnnotateRecording.type, "AnnotateRecording");
    assert.equal(GenerateSkill.type, "GenerateSkill");
    assert.equal(CompleteRecording.type, "CompleteRecording");
    assert.equal(FailRecording.type, "FailRecording");
  });
});
