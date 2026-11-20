import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateStatus } from '../scripts/lib/status-store.mjs';
import { readProgress } from '../scripts/generate-progress.mjs';
import { validateStatus, validateProgress } from '../src/lib/contracts.js';
const execute = promisify(execFile);
const now = '2026-11-20T00:00:00.000Z';
function fixture(t) { const dir = mkdtempSync(join(tmpdir(), 'site-data-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('checked-in public data obeys shared contract', () => {
  validateStatus(JSON.parse(readFileSync(new URL('../public/live/status.json', import.meta.url))));
  validateProgress(JSON.parse(readFileSync(new URL('../public/progress.json', import.meta.url))));
});
test('status patches preserve unrelated agents, project public fields and ignore stale heartbeats', async (t) => {
  const file = join(fixture(t), 'status.json');
  await updateStatus(file, [{ id: 'pi', status: 'working', note: '<script>', secret: 'private' }], { now });
  await updateStatus(file, [{ id: 'codex' }], { now });
  const value = await updateStatus(file, [{ id: 'pi', status: 'error', heartbeat: '2026-11-19T00:00:00Z' }], { now });
  assert.equal(value.agents.find((agent) => agent.id === 'pi').status, 'working');
  assert.equal(value.agents.length, 2);
  assert.equal(value.agents[1].secret, undefined);
});
test('malformed current data and invalid incoming data never overwrite file', async (t) => {
  const file = join(fixture(t), 'status.json'); writeFileSync(file, '{broken');
  await assert.rejects(updateStatus(file, [{ id: 'pi' }], { now }));
  assert.equal(readFileSync(file, 'utf8'), '{broken');
  await assert.rejects(updateStatus(file, [{ id: 'pi', status: 'unknown' }], { now }), /status/);
  await assert.rejects(updateStatus(file, [{ id: 'pi' }, { id: 'pi' }], { now }), /Duplicate/);
  await assert.rejects(updateStatus(file, [], { now, pruneHours: NaN }), /options/);
});
test('concurrent processes update without losing agents', async (t) => {
  const file = join(fixture(t), 'status.json');
  const module = new URL('../scripts/lib/status-store.mjs', import.meta.url).href;
  await Promise.all(Array.from({ length: 12 }, (_, index) => execute(process.execPath, ['--input-type=module', '-e', `import {updateStatus} from ${JSON.stringify(module)}; await updateStatus(${JSON.stringify(file)},[{id:'agent-${index}'}]);`])));
  assert.equal(JSON.parse(readFileSync(file)).agents.length, 12);
});
test('pruning and invalid calendar timestamps', async (t) => {
  const file = join(fixture(t), 'status.json');
  await updateStatus(file, [{ id: 'old', heartbeat: '2026-11-18T00:00:00Z' }, { id: 'new' }], { now });
  assert.deepEqual((await updateStatus(file, [], { now, pruneHours: 1 })).agents.map((agent) => agent.id), ['new']);
  await assert.rejects(updateStatus(file, [{ id: 'pi', heartbeat: '2026-02-30T00:00:00Z' }], { now }), /heartbeat/);
});
function effort(dir, name, dependencies = '01') {
  const root = join(dir, name); mkdirSync(join(root, 'issues'), { recursive: true });
  writeFileSync(join(root, 'map.md'), '# Example · Wayfinding Map\n\n## Destination\nShip it\n\n## Decisions so far\n- [Decision](issues/01-first.md) — Choose simplicity\n');
  writeFileSync(join(root, 'issues/01-first.md'), '# First\nType: task\nStatus: resolved\nBlocked by: none\n');
  writeFileSync(join(root, 'issues/02-second.md'), `# Second\nType: task\nStatus: open\nBlocked by: ${dependencies}\n`);
}
test('progress preserves numeric and Markdown dependencies with deterministic order', (t) => {
  const dir = fixture(t); effort(dir, 'z'); effort(dir, 'a', '[First](issues/01-first.md)');
  const value = readProgress(dir, now);
  assert.deepEqual(value.efforts.map((row) => row.id), ['a', 'z']);
  assert.deepEqual(value.efforts[0].tickets[1].blocked_by, ['01']);
  assert.equal(value.efforts[0].decisions[0].gist, 'Choose simplicity');
});
test('progress rejects missing endpoints, cycles, duplicate ticket ids and effort slug collisions', (t) => {
  const dir = fixture(t); effort(dir, 'one', '99');
  assert.throws(() => readProgress(dir, now), /Missing dependency/);
  effort(dir, 'one', '02'); assert.throws(() => readProgress(dir, now), /Cyclic/);
  effort(dir, 'one'); writeFileSync(join(dir, 'one/issues/01-duplicate.md'), '# Duplicate\n');
  assert.throws(() => readProgress(dir, now), /Duplicate ticket/);
  rmSync(join(dir, 'one/issues/01-duplicate.md')); effort(dir, 'One!');
  assert.throws(() => readProgress(dir, now), /Duplicate effort/);
});
