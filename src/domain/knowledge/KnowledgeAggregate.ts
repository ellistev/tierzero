import { Aggregate } from "../../infra/aggregate";
import { AddKnowledge, RecordKnowledgeUsage, SupersedeKnowledge } from "./commands";
import { KnowledgeAdded, KnowledgeUsed, KnowledgeSuperseded } from "./events";

interface KnowledgeState extends Record<string, unknown> {
  id: string;
  type: string;
  title: string;
  content: string;
  source: { taskId: string; agentName: string; timestamp: string } | null;
  tags: string[];
  relatedFiles: string[];
  confidence: number;
  usageCount: number;
  lastUsedAt: string | null;
  supersededBy: string | null;
}

export class KnowledgeAggregate extends Aggregate<KnowledgeState> {
  static type = "KnowledgeAggregate" as const;

  constructor() {
    super();

    // Command handlers
    this._registerCommandHandler(AddKnowledge, (_state, cmd) => {
      return [new KnowledgeAdded(
        cmd.id, cmd.type, cmd.title, cmd.content,
        cmd.source, cmd.tags, cmd.relatedFiles, cmd.confidence
      )];
    });

    this._registerCommandHandler(RecordKnowledgeUsage, (state, cmd) => {
      if (!state.id) throw new Error("Knowledge entry does not exist");
      if (state.supersededBy !== null) throw new Error("Knowledge entry has been superseded");
      return [new KnowledgeUsed(cmd.id, cmd.taskId, cmd.usedAt)];
    });

    this._registerCommandHandler(SupersedeKnowledge, (state, cmd) => {
      if (!state.id) throw new Error("Knowledge entry does not exist");
      if (state.supersededBy !== null) throw new Error("Knowledge entry already superseded");
      return [new KnowledgeSuperseded(cmd.oldId, cmd.newId, cmd.reason)];
    });

    // Event handlers
    this._registerEventHandler(KnowledgeAdded, (_state, e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      content: e.content,
      source: e.source,
      tags: e.tags,
      relatedFiles: e.relatedFiles,
      confidence: e.confidence,
      usageCount: 0,
      lastUsedAt: null,
      supersededBy: null,
    }));

    this._registerEventHandler(KnowledgeUsed, (state, e) => ({
      ...state,
      usageCount: (state.usageCount ?? 0) + 1,
      lastUsedAt: e.usedAt,
    }));

    this._registerEventHandler(KnowledgeSuperseded, (state, e) => ({
      ...state,
      supersededBy: e.newId,
    }));
  }
}
