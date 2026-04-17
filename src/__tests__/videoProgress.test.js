import { jest } from '@jest/globals';

// ── Tests for the SSE video progress system ─────────────────────────

describe('VideoProgressEmitter', () => {
  let VideoProgressEmitter;

  beforeAll(async () => {
    ({ VideoProgressEmitter } = await import('../utils/videoProgress.js'));
  });

  it('creates a new progress stream for a jobId', () => {
    const emitter = new VideoProgressEmitter();
    const stream = emitter.create('job-1');
    expect(stream).toBeDefined();
    expect(stream.jobId).toBe('job-1');
    emitter.destroy('job-1');
  });

  it('emits progress events to listeners', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-2');

    const received = [];
    emitter.subscribe('job-2', (data) => received.push(data));

    emitter.emit('job-2', { stage: 'validating', progress: 10 });
    emitter.emit('job-2', { stage: 'extracting_frames', progress: 30 });

    expect(received).toHaveLength(2);
    expect(received[0].stage).toBe('validating');
    expect(received[1].progress).toBe(30);
    emitter.destroy('job-2');
  });

  it('does not emit to subscribers of other jobs', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-a');
    emitter.create('job-b');

    const received = [];
    emitter.subscribe('job-a', (data) => received.push(data));

    emitter.emit('job-b', { stage: 'transcribing', progress: 50 });

    expect(received).toHaveLength(0);
    emitter.destroy('job-a');
    emitter.destroy('job-b');
  });

  it('removes subscribers on unsubscribe', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-3');

    const received = [];
    const unsub = emitter.subscribe('job-3', (data) => received.push(data));

    emitter.emit('job-3', { stage: 'validating', progress: 10 });
    unsub();
    emitter.emit('job-3', { stage: 'analysing', progress: 80 });

    expect(received).toHaveLength(1);
    emitter.destroy('job-3');
  });

  it('cleans up all subscribers on destroy', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-4');

    const received = [];
    emitter.subscribe('job-4', (data) => received.push(data));
    emitter.destroy('job-4');

    // Emitting after destroy should not throw or deliver
    emitter.emit('job-4', { stage: 'done', progress: 100 });
    expect(received).toHaveLength(0);
  });

  it('supports multiple subscribers for the same job', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-5');

    const r1 = [];
    const r2 = [];
    emitter.subscribe('job-5', (data) => r1.push(data));
    emitter.subscribe('job-5', (data) => r2.push(data));

    emitter.emit('job-5', { stage: 'extracting_frames', progress: 25 });

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    emitter.destroy('job-5');
  });

  it('emits "complete" stage on finish', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-6');

    const received = [];
    emitter.subscribe('job-6', (data) => received.push(data));

    emitter.finish('job-6');

    expect(received).toHaveLength(1);
    expect(received[0].stage).toBe('complete');
    expect(received[0].progress).toBe(100);
    emitter.destroy('job-6');
  });

  it('emits "error" stage on failure', () => {
    const emitter = new VideoProgressEmitter();
    emitter.create('job-7');

    const received = [];
    emitter.subscribe('job-7', (data) => received.push(data));

    emitter.error('job-7', 'Video too long');

    expect(received).toHaveLength(1);
    expect(received[0].stage).toBe('error');
    expect(received[0].error).toBe('Video too long');
    emitter.destroy('job-7');
  });
});

describe('SSE video progress route (source validation)', () => {
  let serverSource;

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    serverSource = readFileSync(join(__dirname, '..', '..', 'server.js'), 'utf8');
  });

  it('has a GET endpoint for video progress SSE', () => {
    expect(serverSource).toMatch(/app\.get\(.*video.*progress/);
  });

  it('sets Content-Type to text/event-stream', () => {
    expect(serverSource).toMatch(/text\/event-stream/);
  });

  it('sets Cache-Control to no-cache', () => {
    expect(serverSource).toMatch(/no-cache/);
  });

  it('requires auth on the progress endpoint', () => {
    expect(serverSource).toMatch(/progress.*requireAuth|requireAuth[\s\S]{0,50}progress/);
  });

  it('sends progress events in SSE format', () => {
    // SSE format: data: {...}\n\n
    expect(serverSource).toMatch(/data:\s*\$\{|res\.write\(/);
  });

  it('cleans up on client disconnect', () => {
    expect(serverSource).toMatch(/req\.on\(['"]close['"]/);
  });

  it('emits progress from the video processing route', () => {
    expect(serverSource).toMatch(/videoProgress\.emit|progressEmitter\.emit/);
  });
});
