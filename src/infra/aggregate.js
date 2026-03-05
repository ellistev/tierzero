import { deepClone, getTypeName } from './utils/index.js';

class Memento {
  constructor(state) {
    this.state = state;
  }
}

export class Aggregate {
  constructor() {
    this._commandHandlers = new Map();
    this._eventHandlers = new Map();
    this._state = {};
  }

  _registerCommandHandler(TCommand, handler) {
    if (typeof TCommand === 'function') {
      this._commandHandlers.set(TCommand.type, handler);
    } else if (typeof TCommand === 'string') {
      this._commandHandlers.set(TCommand, handler);
    } else {
      throw new TypeError('TCommand must be a command or a string');
    }
  }

  _registerEventHandler(TEvent, handler) {
    if (typeof TEvent === 'function') {
      this._eventHandlers.set(TEvent.type, handler);
    } else if (typeof TEvent === 'string') {
      this._eventHandlers.set(TEvent, handler);
    } else {
      throw new TypeError('TEvent must be an event or a string');
    }
  }

  hydrate(event) {
    const handler = this._eventHandlers.get(getTypeName(event));
    if (handler) this._state = handler(Object.freeze(this._state), event);
  }

  execute(command) {
    const handler = this._commandHandlers.get(getTypeName(command));
    if (handler) return handler(Object.freeze(this._state), command);
    throw new Error('Unknown command   + getTypeName(command) +   for ' + getTypeName(this));
  }

  restoreFromMemento(memento) {
    this._state = deepClone(memento.state);
  }

  createMemento() {
    return new Memento(deepClone(this._state));
  }
}
