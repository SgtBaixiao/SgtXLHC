import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublisher, createNotionSource, guardedBlockClient } from '../scripts/lib/notion-core.mjs';
import { createGitPublisher } from '../scripts/lib/git-publish.mjs';
import { setTimeout as delay } from 'node:timers/promises';
const execute = promisify(execFile);
const db = '1'.repeat(32), one = '2'.repeat(32), two = '3'.repeat(32);
function root(t) { const value = mkdtempSync(join(tmpdir(), 'site-publish-')); t.after(() => rmSync(value, { recursive: true, force: true })); return value; }
const essayDir = (dir) => join(dir, 'src/content/essays');
function source(overrides = {}) {
  const articles = new Map([one, two].map((id) => [id, { id, title: `Article ${id[0]}`, date: '2026-11-20', tags: ['tag'], published: true }]));
  return { articles, async list() { return [...articles.values()]; }, async read(id) { return structuredClone(articles.get(id)); }, async markdown(id) { return `Body ${id}`; }, ...overrides };
}
function rawPage(id, props = {}) {
  return { id, parent: { type: 'database_id', database_id: db }, properties: { Name: { type: 'title', title: [{ plain_text: 'Title' }] }, Published: { type: 'checkbox', checkbox: true }, ...props } };
}
test('Notion adapter paginates database and handles parent Markdown result', async () => {
  const cursors = [];
  const notion = { databases: { async query(options) { cursors.push(options.start_cursor); return { results: [rawPage(options.start_cursor ? two : one)], has_more: !options.start_cursor, next_cursor: 'next' }; } }, pages: { retrieve: async () => rawPage(one) } };
  const adapter = createNotionSource({ notion, n2m: { pageToMarkdown: async () => [], toMarkdownString: () => ({ parent: 'Full body' }) } });
  assert.equal((await adapter.list(db)).length, 2); assert.deepEqual(cursors, [undefined, 'next']); assert.equal(await adapter.markdown(one), 'Full body');
});
test('Notion rejects cursor cycles, foreign database, drafts and unsupported multi-file conversion', async () => {
  const notion = { databases: { query: async () => ({ results: [], has_more: true, next_cursor: 'same' }) }, pages: { retrieve: async () => ({ ...rawPage(one), parent: { type: 'database_id', database_id: two } }) } };
  const adapter = createNotionSource({ notion, n2m: { pageToMarkdown: async () => [], toMarkdownString: () => ({ parent: '', child: 'lost' }) } });
  await assert.rejects(adapter.list(db), /pagination/); await assert.rejects(adapter.read(one, db), /eligible/); await assert.rejects(adapter.markdown(one), /Unsupported/);
  notion.pages.retrieve = async () => rawPage(one, { Published: { type: 'checkbox', checkbox: false } }); await assert.rejects(adapter.read(one, db), /eligible/);
});
test('Notion long title properties are paginated', async () => {
  const page = rawPage(one, { Name: { id: 'title', type: 'title', title: Array.from({ length: 25 }, () => ({ plain_text: 'partial' })) } });
  const adapter = createNotionSource({ notion: { databases: { query: async () => ({ results: [page] }) }, pages: { properties: { retrieve: async () => ({ object: 'list', results: [{ title: { plain_text: 'Complete title' } }], has_more: false }) } } }, n2m: {} });
  assert.equal((await adapter.list(db))[0].title, 'Complete title');
});
test('block traversal rejects repeated cursors and incomplete pagination', async () => {
  const client = guardedBlockClient({ blocks: { children: { list: async () => ({ results: [], has_more: true, next_cursor: 'same' }) } } });
  await client.blocks.children.list({ block_id: one });
  await client.blocks.children.list({ block_id: one, start_cursor: 'same' });
  await assert.rejects(client.blocks.children.list({ block_id: one, start_cursor: 'same' }), /Repeated/);
  const incomplete = guardedBlockClient({ blocks: { children: { list: async () => ({ results: [], has_more: true }) } } });
  await assert.rejects(incomplete.blocks.children.list({ block_id: one }), /Incomplete/);
});
test('publishing is idempotent and source rename preserves file and URL', async (t) => {
  const dir = root(t), adapter = source(), publisher = createPublisher({ root: dir, databaseId: db, source: adapter });
  const first = await publisher.publish({ pageIds: [one] });
  assert.equal((await publisher.publish({ pageIds: [one] })).results[0].unchanged, true);
  adapter.articles.get(one).title = 'Renamed'; adapter.articles.get(one).date = '2026-11-21';
  assert.equal((await publisher.publish({ pageIds: [one] })).results[0].skipped, true);
  const updated = await publisher.publish({ pageIds: [one], overwrite: true });
  assert.equal(updated.results[0].file, first.results[0].file); assert.equal(updated.results[0].slug, first.results[0].slug);
  assert.equal(readdirSync(essayDir(dir)).length, 1); assert.match(readFileSync(first.results[0].file, 'utf8'), /Renamed/);
});
test('invalid paths, dates, duplicates and batch URL conflicts write no article', async (t) => {
  const dir = root(t), adapter = source(), publisher = createPublisher({ root: dir, databaseId: db, source: adapter });
  await assert.rejects(publisher.publish({ pageIds: [one], slugOverride: '../../escape' }), /slug/);
  await assert.rejects(publisher.publish({ pageIds: [one, one] }), /Duplicate/);
  adapter.articles.get(two).slug = 'article-2';
  await assert.rejects(publisher.publish({ pageIds: [one, two] }), /collision/);
  assert.deepEqual(readdirSync(essayDir(dir)), []);
  adapter.articles.get(one).date = '2026-02-30'; await assert.rejects(publisher.publish({ pageIds: [one] }), /date/);
});
test('force never overwrites handwritten ownership and symlink directories are refused', async (t) => {
  const dir = root(t), adapter = source(), directory = essayDir(dir); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'manual.md'), '---\ntitle: Handwritten\ndate: 2026-11-20\nslug: article-2\n---\nOriginal');
  const publisher = createPublisher({ root: dir, databaseId: db, source: adapter });
  await assert.rejects(publisher.publish({ pageIds: [one], overwrite: true }), /collision/);
  assert.match(readFileSync(join(directory, 'manual.md'), 'utf8'), /Original/);
  const other = root(t); symlinkSync(other, join(directory, 'link')); await assert.rejects(publisher.publish({ pageIds: [two] }), /Symlinks/);
});
test('source change during conversion aborts before write and concurrent publication serializes', async (t) => {
  const dir = root(t), adapter = source();
  adapter.markdown = async () => { adapter.articles.get(one).title = 'Changed'; return 'body'; };
  const publisher = createPublisher({ root: dir, databaseId: db, source: adapter });
  await assert.rejects(publisher.publish({ pageIds: [one] }), /changed during/);
  let active = 0, peak = 0;
  adapter.markdown = async () => { active++; peak = Math.max(peak, active); await delay(30); active--; return 'body'; };
  await Promise.all([publisher.publish({ pageIds: [one] }), publisher.publish({ pageIds: [two] })]); assert.equal(peak, 1);
});
test('Git publisher commits exact generated paths and refuses staged work or unpushed history', async (t) => {
  const dir = root(t), remote = join(dir, 'remote.git'), work = join(dir, 'work');
  const git = async (cwd, ...args) => (await execute('git', args, { cwd })).stdout.trim();
  await git(dir, 'init', '--bare', remote); await git(dir, 'clone', remote, work);
  await git(work, 'config', 'user.email', 'tests@example.invalid'); await git(work, 'config', 'user.name', 'Tests');
  writeFileSync(join(work, 'keep.txt'), 'original'); await git(work, 'add', '.'); await git(work, 'commit', '-m', 'initial'); await git(work, 'push', '-u', 'origin', 'HEAD');
  const publisher = createGitPublisher(work), file = join(work, 'generated.txt');
  const destination = await publisher.preflight([file]);
  writeFileSync(join(work, 'keep.txt'), 'unrelated'); writeFileSync(file, 'generated');
  const result = await publisher.publish([file], destination, 'generated $(unsafe)'); assert.equal(result.pushed, true);
  assert.equal(await git(work, 'show', '--format=', '--name-only', 'HEAD'), 'generated.txt');
  assert.equal(await git(work, 'show', 'HEAD:keep.txt'), 'original');
  await git(work, 'add', 'keep.txt'); await assert.rejects(publisher.preflight([file]), /staged changes/);
  await git(work, 'commit', '-m', 'local'); await assert.rejects(publisher.preflight([file]), /history differ/);
});
