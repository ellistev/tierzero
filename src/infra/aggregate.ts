import {deepClone, getTypeName} from "./utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandOrEventClass<T> = { type: string; new (...args: any[]): T };

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

  _registerCommandHandler<TCommand>(TCommand: CommandOrEventClass<TCommand>, handler: (state: TState, cmd: TCommand) => unknown[]) {
    if (typeof TCommand === 'function') {
      this._commandHandlers.set(TCommand.type, handler as (state: TState, cmd: unknown) => unknown[]);
    } else if (typeof TCommand === 'string') {
      this._commandHandlers.set(TCommand, handler as (state: TState, cmd: unknown) => unknown[]);
    } else {
      throw new TypeError('TCommand must be a command or a string');
    }
  }

  _registerEventHandler<TEvent>(TEvent: CommandOrEventClass<TEvent>, handler: (state: TState, event: TEvent) => TState) {
    if (typeof TEvent === 'function') {
      this._eventHandlers.set(TEvent.type, handler as (state: TState, event: unknown) => TState);
    } else if (typeof TEvent === 'string') {
      this._eventHandlers.set(TEvent, handler as (state: TState, event: unknown) => TState);
    } else {
      throw new TypeError('TEvent must be an event or a string');
    }
  }

  /**
   * @param {object} event
   */
  hydrate<TEvent>(event: TEvent) {
    const handler = this._eventHandlers.get(getTypeName(event));
    if (handler) this._state = handler(Object.freeze(this._state), event);
  }

  /**
   * @param {object} command
   * @returns {object[]}
   */
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
