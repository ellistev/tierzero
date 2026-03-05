import { deepClone, getTypeName } from "./utils";

export interface ClassWithMeta<T> {
  type: string;
  new (...args: any[]): T;
}

class Memento<TState extends Record<string, unknown> = Record<string, unknown>> {
  constructor(public readonly state: TState) {}
}

export class Aggregate<TState extends Record<string, unknown> = Record<string, unknown>> {
  private readonly _commandHandlers: Map<string, (state: TState, cmd: unknown) => unknown[]>;
  private readonly _eventHandlers: Map<string, (state: TState, event: unknown) => TState>;
  private _state: TState;

  constructor() {
    this._commandHandlers = new Map();
    this._eventHandlers = new Map();
    this._state = {} as TState;
  }

  _registerCommandHandler<TCommand>(TCommand: ClassWithMeta<TCommand>, handler: (state: TState, cmd: TCommand) => unknown[]) {
    this._commandHandlers.set(TCommand.type, handler as (state: TState, cmd: unknown) => unknown[]);
  }

  _registerEventHandler<TEvent>(TEvent: ClassWithMeta<TEvent>, handler: (state: TState, event: TEvent) => TState) {
    this._eventHandlers.set(TEvent.type, handler as (state: TState, event: unknown) => TState);
  }

  hydrate<TEvent>(event: TEvent) {
    const handler = this._eventHandlers.get(getTypeName(event));
    if (handler) this._state = handler(Object.freeze(this._state), event);
  }

  execute<TCommand>(command: TCommand) {
    const handler = this._commandHandlers.get(getTypeName(command));
    if (handler) return handler(Object.freeze(this._state), command);
    throw new Error(`Unknown command "${getTypeName(command)}" for ${getTypeName(this)}`);
  }

  restoreFromMemento(memento: Memento<TState>) {
    this._state = deepClone(memento.state);
  }

  createMemento(): Memento<TState> {
    return new Memento<TState>(deepClone(this._state));
  }
}
