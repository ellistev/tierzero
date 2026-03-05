export { Aggregate, type ClassWithMeta } from "./aggregate";
export { EventStore, ConcurrencyError } from "./event-store";
export { createCommandHandler } from "./command-handler";
export { ReadRepository, ReadModelBuilder } from "./read-model";
export { deepClone, getTypeName } from "./utils";
export type {
  StoredEvent,
  EventFactory,
  ReadModelConfig,
  ReadModelHandler,
  ReadModelRepo,
  ReadModelDefinition,
} from "./interfaces";
