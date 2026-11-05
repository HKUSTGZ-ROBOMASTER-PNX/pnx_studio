export class Emitter {
  #handlers = new Map();
  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event)?.delete(handler);
  }
  once(event, handler) {
    const off = this.on(event, payload => { off(); handler(payload); });
    return off;
  }
  emit(event, payload) {
    for (const handler of [...(this.#handlers.get(event) || [])]) {
      try { handler(payload); } catch (error) { console.error(`listener for ${event} failed`, error); }
    }
  }
}

/** Application-wide event bus for loosely coupled views. */
export const bus = new Emitter();
