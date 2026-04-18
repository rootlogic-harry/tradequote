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
    const existing = this._streams.get(jobId);
    if (existing) return existing;
    const stream = { jobId, listeners: new Set() };
    this._streams.set(jobId, stream);
    return stream;
  }

  subscribe(jobId, callback) {
    // Lazy-create: SSE client may subscribe before the POST handler calls create()
    let stream = this._streams.get(jobId);
    if (!stream) {
      stream = this.create(jobId);
    }
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
