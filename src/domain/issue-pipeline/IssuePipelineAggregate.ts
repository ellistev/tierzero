import { Aggregate } from "../../infra/aggregate";
import { StartPipeline, CompleteAgentWork, RecordTestRun, RecordTestFix, CreatePR, CompletePipeline, FailPipeline } from "./commands";
import { PipelineStarted, AgentWorkCompleted, TestsRan, TestFixApplied, PRCreated, PipelineCompleted, PipelineFailed } from "./events";

interface IssuePipelineState extends Record<string, unknown> {
  pipelineId: string;
  issueNumber: number;
  title: string;
  branch: string;
  status: "started" | "agent_done" | "tests_passing" | "tests_failing" | "pr_created" | "completed" | "failed";
  summary: string;
  filesChanged: string[];
  testsRun: number;
  testsPassed: number;
  testAttempts: number;
  prNumber: number | null;
  prUrl: string | null;
  error: string | null;
}

export class IssuePipelineAggregate extends Aggregate<IssuePipelineState> {
  static type = "IssuePipelineAggregate" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(StartPipeline, (_state, cmd) => {
      return [new PipelineStarted(cmd.pipelineId, cmd.issueNumber, cmd.title, cmd.branch, cmd.startedAt)];
    });

    this._registerCommandHandler(CompleteAgentWork, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      if (state.status !== "started") throw new Error("Pipeline not in started state");
      return [new AgentWorkCompleted(cmd.pipelineId, cmd.summary, cmd.filesChanged, cmd.completedAt)];
    });

    this._registerCommandHandler(RecordTestRun, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      return [new TestsRan(cmd.pipelineId, cmd.passed, cmd.total, cmd.passing, cmd.failing, cmd.attempt, cmd.ranAt)];
    });

    this._registerCommandHandler(RecordTestFix, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      if (state.status !== "tests_failing") throw new Error("No test failures to fix");
      return [new TestFixApplied(cmd.pipelineId, cmd.attempt, cmd.summary, cmd.filesChanged, cmd.fixedAt)];
    });

    this._registerCommandHandler(CreatePR, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      return [new PRCreated(cmd.pipelineId, cmd.prNumber, cmd.prUrl, cmd.draft, cmd.createdAt)];
    });

    this._registerCommandHandler(CompletePipeline, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      if (state.status === "completed" || state.status === "failed") throw new Error("Pipeline already finished");
      return [new PipelineCompleted(cmd.pipelineId, cmd.status, cmd.completedAt)];
    });

    this._registerCommandHandler(FailPipeline, (state, cmd) => {
      if (!state.pipelineId) throw new Error("Pipeline does not exist");
      if (state.status === "completed" || state.status === "failed") throw new Error("Pipeline already finished");
      return [new PipelineFailed(cmd.pipelineId, cmd.error, cmd.failedAt)];
    });

    // Event handlers
    this._registerEventHandler(PipelineStarted, (_state, e) => ({
      pipelineId: e.pipelineId,
      issueNumber: e.issueNumber,
      title: e.title,
      branch: e.branch,
      status: "started" as const,
      summary: "",
      filesChanged: [],
      testsRun: 0,
      testsPassed: 0,
      testAttempts: 0,
      prNumber: null,
      prUrl: null,
      error: null,
    }));

    this._registerEventHandler(AgentWorkCompleted, (state, e) => ({
      ...state,
      status: "agent_done" as const,
      summary: e.summary,
      filesChanged: e.filesChanged,
    }));

    this._registerEventHandler(TestsRan, (state, e) => ({
      ...state,
      status: e.passed ? "tests_passing" as const : "tests_failing" as const,
      testsRun: e.total,
      testsPassed: e.passing,
      testAttempts: e.attempt,
    }));

    this._registerEventHandler(TestFixApplied, (state, e) => ({
      ...state,
      summary: `${state.summary}\n\nFix attempt ${e.attempt}: ${e.summary}`,
      filesChanged: [...new Set([...(state.filesChanged as string[]), ...e.filesChanged])],
    }));

    this._registerEventHandler(PRCreated, (state, e) => ({
      ...state,
      status: "pr_created" as const,
      prNumber: e.prNumber,
      prUrl: e.prUrl,
    }));

    this._registerEventHandler(PipelineCompleted, (state, e) => ({
      ...state,
      status: "completed" as const,
    }));

    this._registerEventHandler(PipelineFailed, (state, e) => ({
      ...state,
      status: "failed" as const,
      error: e.error,
    }));
  }
}
