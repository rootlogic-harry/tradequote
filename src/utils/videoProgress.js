/**
 * In-memory progress emitter for video processing SSE.
 * Each jobId maps to a set of listener callbacks.
 * The server creates one global instance and shares it
 * between the SSE endpoint and the video processing route.
 */
export class VideoProgressEmitter {
  constructor() {
    /** @type {Map<string, { jobId: string, listeners: Set<Function> }>} */
    this._streams = new Map();
  }

  create(jobId) {
    const stream = { jobId, listeners: new Set() };
    this._streams.set(jobId, stream);
    return stream;
  }

  subscribe(jobId, callback) {
    const stream = this._streams.get(jobId);
    if (!stream) return () => {};
    stream.listeners.add(callback);
    return () => stream.listeners.delete(callback);
  }

  emit(jobId, data) {
    const stream = this._streams.get(jobId);
    if (!stream) return;
    for (const listener of stream.listeners) {
      listener(data);
    }
  }

  finish(jobId) {
    this.emit(jobId, { stage: 'complete', progress: 100 });
  }

  error(jobId, message) {
    this.emit(jobId, { stage: 'error', progress: 0, error: message });
  }

  destroy(jobId) {
    this._streams.delete(jobId);
  }
}
