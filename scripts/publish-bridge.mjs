import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { args, isMain, run } from './lib/cli.mjs';
import { createPublisher, configuration } from './lib/notion-core.mjs';

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('JSON content-type required');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Error('Request body exceeds 16 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createBridge({ publisher, token = randomBytes(32).toString('hex') }) {
  let busy = false;
  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = req.headers.host;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!allowedHosts.includes(host) || req.headers.origin && req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Local same-origin access required' });
    try {
      const pathname = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && ['/', '/style.css', '/client.js'].includes(pathname)) {
        const file = { '/': 'index.html', '/style.css': 'style.css', '/client.js': 'client.js' }[pathname];
        res.setHeader('content-type', { '/': 'text/html; charset=utf-8', '/style.css': 'text/css', '/client.js': 'text/javascript; charset=utf-8' }[pathname]);
        return res.end(readFileSync(new URL(`./bridge/${file}`, import.meta.url)));
      }
      if (req.method === 'GET' && pathname === '/api/session') return json(res, 200, { token });
      const supplied = req.headers['x-site-token'];
      if (typeof supplied !== 'string' || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(res, 403, { error: 'Invalid session capability' });
      if (req.method === 'GET' && pathname === '/api/pages') return json(res, 200, { pages: await publisher.list() });
      if (req.method !== 'POST' || pathname !== '/api/publish') return json(res, 404, { error: 'Not found' });
      if (busy) return json(res, 409, { error: 'Publication in progress' });
      busy = true;
      try {
        const body = await readBody(req);
        if (!body || Object.keys(body).some((key) => !['page_ids', 'force', 'commit'].includes(key))) throw new Error('Invalid publication request');
        const output = await publisher.publish({ pageIds: body.page_ids, overwrite: body.force ?? false, push: body.commit ?? false });
        return json(res, 200, output);
      } finally { busy = false; }
    } catch (error) { if (!res.destroyed) json(res, 400, { error: error.message }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.on('connection', (socket) => socket.setTimeout(15000, () => socket.destroy()));
  return server;
}
export async function main(argv) {
  const options = args({ database: { type: 'string' }, port: { type: 'string' } }, argv);
  const port = Number(options.port || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = createBridge({ publisher: createPublisher({ databaseId: options.database || configuration().database }) });
  server.listen(port, '127.0.0.1', () => console.log(`[bridge] http://127.0.0.1:${port}`));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
}
if (isMain(import.meta.url)) run(main);
