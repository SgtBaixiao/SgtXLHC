/** Each fallback has its own deadline; stopping the caller aborts the whole operation. */
export async function fetchFirst(urls, { signal, timeout = 8000, validate = (value) => value, fetcher = fetch, maxBytes = 4 * 1024 * 1024 } = {}) {
  let lastError;
  for (const url of urls) {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Source timed out')), timeout);
    try {
      const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        controller.abort();
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader(), chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error('Source exceeds byte budget');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return validate(JSON.parse(new TextDecoder().decode(body)));
    } catch (error) { lastError = error; if (signal?.aborted) throw signal.reason; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw new Error(lastError?.message || 'No data sources');
}
export function startPolling(load, callback, { interval = 90000, maxInterval = 600000, immediate = false } = {}) {
  let stopped = false, failures = 0, timer, controller;
  async function tick() {
    if (stopped) return;
    controller = new AbortController();
    try {
      const value = await load({ signal: controller.signal });
      if (stopped) return;
      failures = 0;
      callback?.(value, null);
    } catch (error) { if (stopped) return; failures++; callback?.(null, error); }
    if (!stopped) timer = setTimeout(tick, Math.min(interval * 2 ** Math.min(failures, 20), maxInterval));
  }
  timer = setTimeout(tick, immediate ? 0 : interval);
  return () => { stopped = true; clearTimeout(timer); controller?.abort(new Error('Polling stopped')); };
}
