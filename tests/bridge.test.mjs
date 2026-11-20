import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createBridge } from '../scripts/publish-bridge.mjs';
async function fixture(t, publisher = { list: async () => [], publish: async (options) => ({ results: [], options }) }) {
  const server = createBridge({ publisher, token: 'a'.repeat(64) }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const headers = { 'x-site-token': 'a'.repeat(64), 'content-type': 'application/json' };
test('incomplete request body times out without invoking publisher', async (t) => {
  let published = false;
  const server = createBridge({ publisher: { publish: async () => { published = true; } }, token: 'a'.repeat(64), bodyTimeout: 20 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const status = await new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${server.address().port}/api/publish`, { method: 'POST', headers: { ...headers, 'content-length': 100 } }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', reject); req.write('{');
  });
  assert.equal(status, 400); assert.equal(published, false);
});
test('bridge rejects foreign Host/Origin and requests without session capability', async (t) => {
  const url = await fixture(t);
  assert.equal((await fetch(`${url}/api/pages`)).status, 403);
  assert.equal((await fetch(`${url}/api/session`, { headers: { origin: 'https://evil.example' } })).status, 403);
  const status = await new Promise((resolve, reject) => { const req = request(url, { headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }); assert.equal(status, 403);
  assert.equal((await fetch(`${url}/api/pages`, { headers })).status, 200);
});
test('bridge defaults to local non-overwrite, bounds input and refuses unknown fields', async (t) => {
  const url = await fixture(t);
  const post = (body) => fetch(`${url}/api/publish`, { method: 'POST', headers, body: JSON.stringify(body) });
  const result = await (await post({ page_ids: ['id'] })).json(); assert.equal(result.options.overwrite, false); assert.equal(result.options.push, false);
  assert.equal((await post({ page_ids: [], command: 'anything' })).status, 400);
  assert.equal((await post({ page_ids: ['x'.repeat(20000)] })).status, 400);
});
test('bridge rejects overlapping mutation requests and serves a CSP-protected external-script UI', async (t) => {
  let finish; const url = await fixture(t, { list: async () => [], publish: async () => new Promise((resolve) => finish = resolve) });
  const first = fetch(`${url}/api/publish`, { method: 'POST', headers, body: '{"page_ids":["id"]}' });
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await fetch(`${url}/api/publish`, { method: 'POST', headers, body: '{}' })).status, 409);
  finish({ results: [] }); assert.equal((await first).status, 200);
  const page = await fetch(url); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(await page.text(), /src="\/client.js"/);
});
test('bridge includes completed files and failure phase in partial publication errors', async (t) => {
  const error = Object.assign(new Error('write failed'), { phase: 'write', state: 'local-files-retained', results: [{ id: 'id', file: 'saved.md', written: true }] });
  const url = await fixture(t, { publish: async () => { throw error; } });
  const response = await fetch(`${url}/api/publish`, { method: 'POST', headers, body: '{"page_ids":["id"]}' });
  assert.equal(response.status, 400); const data = await response.json();
  assert.equal(data.phase, 'write'); assert.equal(data.results[0].written, true);
});
