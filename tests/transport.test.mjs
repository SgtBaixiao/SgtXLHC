import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchFirst, startPolling } from '../src/lib/transport.js';
test('fallback continues after malformed successful response and enforces byte budget', async () => {
  const seen = [];
  const result = await fetchFirst(['bad', 'large', 'good'], { maxBytes: 20, validate: (value) => { if (!value.ok) throw new Error('schema'); return value; }, fetcher: async (url) => { seen.push(url); return new Response(url === 'bad' ? '{}' : url === 'large' ? ' '.repeat(21) : '{"ok":true}'); } });
  assert.equal(result.ok, true); assert.deepEqual(seen, ['bad', 'large', 'good']);
});
test('per-source timeout reaches fallback and caller abort cancels all sources', async () => {
  const fetcher = async (url, { signal }) => url === 'good' ? new Response('{"ok":true}') : new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  assert.equal((await fetchFirst(['hang', 'good'], { fetcher, timeout: 5 })).ok, true);
  const controller = new AbortController();
  const pending = fetchFirst(['hang', 'good'], { fetcher, signal: controller.signal }); controller.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
});
test('stopping in-flight polling cancels request and suppresses callbacks and rescheduling', async () => {
  let resolve, calls = 0, callbacks = 0, signal;
  const stop = startPolling((options) => { calls++; signal = options.signal; return new Promise((done) => resolve = done); }, () => callbacks++, { immediate: true, interval: 5 });
  await delay(10); stop(); resolve('late'); await delay(20);
  assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(callbacks, 0);
});
test('polling failure reports error and increases interval', async () => {
  const times = [], errors = [];
  const stop = startPolling(async () => { times.push(Date.now()); throw new Error('unavailable'); }, (_, error) => errors.push(error.message), { interval: 15, maxInterval: 100, immediate: true });
  await delay(115); stop();
  assert.ok(times.length >= 2); assert.ok(times[1] - times[0] >= 25); assert.equal(errors[0], 'unavailable');
});
test('HTTP error bodies are cancelled before continuing fallback', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('still streaming')); }, cancel() { cancelled = true; } });
  const result = await fetchFirst(['error', 'good'], { fetcher: async (url) => url === 'error' ? new Response(stream, { status: 500 }) : new Response('{"ok":true}') });
  assert.equal(result.ok, true); assert.equal(cancelled, true);
});
