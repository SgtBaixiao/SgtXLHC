import { readFileSync, readdirSync, existsSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { ROOT } from './cli.mjs';
import { atomicWrite, withLock } from './files.mjs';
import { createGitPublisher } from './git-publish.mjs';
import { slugify, identifier, text } from '../../src/lib/contracts.js';
export { ROOT, slugify };
export const ESSAYS_DIR = join(ROOT, 'src/content/essays');

export function configuration(root = ROOT) {
  const local = {};
  const file = join(root, '.env.local');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (match) local[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return { token: process.env.NOTION_TOKEN || local.NOTION_TOKEN, database: process.env.NOTION_DATABASE || local.NOTION_DATABASE };
}
export function ensureToken() {
  const token = configuration().token;
  if (!token) throw new Error('Set NOTION_TOKEN in environment or gitignored .env.local');
  return token;
}
export function pageId(value) {
  if (typeof value !== 'string' || !/^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(value)) throw new Error('Invalid Notion id');
  return value.replace(/-/g, '').toLowerCase();
}
/** Bound SDK recursive block traversal without changing its Markdown conversion. */
export function guardedBlockClient(notion) {
  const requests = new Set();
  let blocks = 0;
  return { ...notion, blocks: { ...notion.blocks, children: { ...notion.blocks?.children, async list(options) {
    const key = `${options.block_id}:${options.start_cursor || ''}`;
    if (requests.has(key) || requests.size >= 1000) throw new Error('Repeated or oversized block traversal');
    requests.add(key);
    const result = await notion.blocks.children.list(options);
    if (!Array.isArray(result.results) || result.has_more && !result.next_cursor) throw new Error('Incomplete block pagination');
    blocks += result.results.length;
    if (blocks > 10000) throw new Error('Article block budget exceeded');
    return result;
  } } } };
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) throw new Error('Article requires a valid date');
  const day = value.slice(0, 10), date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Invalid article date');
  return day;
}
function validSlug(value) {
  identifier(value, 'article slug');
  if (value.length > 80 || value !== value.normalize('NFC') || value !== slugify(value)) throw new Error('Article slug must be a normalized lowercase path segment');
  return value;
}
export const COLUMN_MAP = {
  title: 'Name',
  date: '日期',
  tags: 'Tags',
  excerpt: '摘要',
  published: 'Published',
  slug: 'Slug',
};

export function propValue(properties, col) {
  const p = properties[col];
  if (!p) return undefined;
  switch (p.type) {
    case 'title': return p.title.map((t) => t.plain_text).join('');
    case 'rich_text': return p.rich_text.map((t) => t.plain_text).join('');
    case 'multi_select': return p.multi_select.map((o) => o.name);
    case 'select': return p.select?.name;
    case 'checkbox': return p.checkbox;
    case 'date': return p.date?.start || p.date?.end;
    case 'url': return p.url;
    case 'number': return p.number;
    case 'status': return p.status?.name;
    default: return undefined;
  }
}


export function createNotionSource({ notion, n2m }) {
  async function completeProperties(page) {
    const properties = structuredClone(page.properties || {});
    for (const property of Object.values(properties)) {
      if (!['title', 'rich_text'].includes(property.type) || property[property.type].length < 25) continue;
      const values = [], seen = new Set();
      let cursor;
      do {
        const result = await notion.pages.properties.retrieve({ page_id: page.id, property_id: property.id, ...(cursor ? { start_cursor: cursor } : {}) });
        if (result.object !== 'list') throw new Error('Incomplete Notion property response');
        values.push(...result.results.map((item) => item[property.type]));
        cursor = result.has_more ? result.next_cursor : null;
        if (result.has_more && (!cursor || seen.has(cursor)) || values.length > 10000) throw new Error('Invalid property pagination');
        if (cursor) seen.add(cursor);
      } while (cursor);
      property[property.type] = values;
    }
    return { ...page, properties };
  }
  return {
    async list(databaseId, { publishedOnly = false } = {}) {
      pageId(databaseId);
      const pages = [], seen = new Set();
      let cursor;
      do {
        const response = await notion.databases.query({ database_id: databaseId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...(publishedOnly ? { filter: { property: COLUMN_MAP.published, checkbox: { equals: true } } } : {}) });
        if (!Array.isArray(response.results)) throw new Error('Invalid Notion database response');
        for (const page of response.results) pages.push(metadata(await completeProperties(page)));
        cursor = response.has_more ? response.next_cursor : null;
        if (response.has_more && (!cursor || seen.has(cursor)) || pages.length > 10000) throw new Error('Invalid database pagination');
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (new Set(pages.map((page) => page.id)).size !== pages.length) throw new Error('Duplicate Notion page');
      return pages;
    },
    async read(id, databaseId) {
      const page = await completeProperties(await notion.pages.retrieve({ page_id: id }));
      if (page.archived || page.in_trash || page.parent?.type !== 'database_id' || pageId(page.parent.database_id) !== pageId(databaseId) || propValue(page.properties, COLUMN_MAP.published) !== true) throw new Error('Page is outside database or not eligible for publication');
      return { ...metadata(page), revision: page.last_edited_time };
    },
    async markdown(id) {
      const original = n2m.notionClient;
      if (original) n2m.notionClient = guardedBlockClient(notion);
      let value;
      try { value = n2m.toMarkdownString(await n2m.pageToMarkdown(id)); }
      finally { if (original) n2m.notionClient = original; }
      const body = typeof value === 'string' ? value : value?.parent;
      if (typeof body !== 'string' || body.length > 2 * 1024 * 1024 || typeof value === 'object' && Object.keys(value).some((key) => key !== 'parent' && value[key])) throw new Error('Unsupported or oversized Markdown conversion');
      return body.replace(/^\uFEFF/, '');
    },
  };
}
function metadata(page) {
  const properties = page.properties || {};
  return { id: pageId(page.id), title: propValue(properties, COLUMN_MAP.title) || page.id, date: propValue(properties, COLUMN_MAP.date), tags: propValue(properties, COLUMN_MAP.tags) || [], excerpt: propValue(properties, COLUMN_MAP.excerpt), published: propValue(properties, COLUMN_MAP.published) === true, slug: propValue(properties, COLUMN_MAP.slug) || undefined };
}
function defaultSource() {
  const require = createRequire(import.meta.url);
  const { Client } = require('@notionhq/client'), { NotionToMarkdown } = require('notion-to-md');
  const notion = new Client({ auth: ensureToken(), timeoutMs: 30000 });
  return createNotionSource({ notion, n2m: new NotionToMarkdown({ notionClient: notion }) });
}
function catalog(directory) {
  mkdirSync(directory, { recursive: true });
  if (realpathSync(directory) !== resolve(directory)) throw new Error('Essay directory must not use symlinks');
  const rows = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), info = lstatSync(file);
      if (info.isSymbolicLink()) throw new Error('Symlinks are not supported in essays');
      if (info.isDirectory()) { walk(file); continue; }
      if (!name.endsWith('.md')) continue;
      const content = readFileSync(file, 'utf8');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw new Error(`Missing frontmatter: ${name}`);
      const data = parse(match[1]);
      const slug = validSlug(data.slug || basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
      const source = typeof data.source === 'string' && data.source.startsWith('notion:') ? pageId(data.source.slice(7)) : null;
      rows.push({ file, data, slug, source, content });
    }
  }
  walk(directory);
  if (new Set(rows.map((row) => row.slug)).size !== rows.length) throw new Error('Duplicate existing essay URL');
  const owned = rows.filter((row) => row.source);
  if (new Set(owned.map((row) => row.source)).size !== owned.length) throw new Error('Ambiguous Notion ownership; reconcile duplicate source files');
  return rows;
}
export function createPublisher({ databaseId, root = ROOT, source, git }) {
  pageId(databaseId);
  root = realpathSync(root);
  git ||= createGitPublisher(root);
  let adapter = source;
  const getSource = () => adapter ||= defaultSource();
  const directory = join(root, 'src/content/essays');
  return {
    list: (options) => getSource().list(databaseId, options),
    async publish({ pageIds, all = false, overwrite = false, push = false, slugOverride } = {}) {
      if (typeof overwrite !== 'boolean' || typeof push !== 'boolean' || typeof all !== 'boolean') throw new Error('Invalid publication options');
      const operation = async () => {
        const ids = all ? (await getSource().list(databaseId, { publishedOnly: true })).filter((page) => page.published).map((page) => page.id) : pageIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('Select 1 to 100 pages');
        const canonical = ids.map(pageId);
        if (new Set(canonical).size !== canonical.length) throw new Error('Duplicate page selection');
        if (slugOverride !== undefined && canonical.length !== 1) throw new Error('Slug override requires one page');
        const existing = catalog(directory), used = new Map(existing.map((row) => [row.slug, row.source]));
        const plans = [];
        for (const id of canonical) {
          const article = await getSource().read(id, databaseId);
          if (pageId(article.id) !== id || !article.published) throw new Error('Unexpected source identity or eligibility');
          const previous = existing.find((row) => row.source === id);
          const date = validDate(article.date), title = text(article.title, 'title', 500);
          const slug = validSlug(slugOverride ?? previous?.slug ?? article.slug ?? (slugify(title) || id));
          if (used.has(slug) && used.get(slug) !== id) throw new Error(`Essay URL collision: ${slug}`);
          used.set(slug, id);
          if (!Array.isArray(article.tags) || article.tags.length > 50) throw new Error('Invalid tags');
          const tags = article.tags.map((tag) => text(tag, 'tag', 100));
          const body = await getSource().markdown(id);
          const confirmed = await getSource().read(id, databaseId);
          if (JSON.stringify(article) !== JSON.stringify(confirmed)) throw new Error('Article changed during conversion; retry publication');
          const file = previous?.file || join(directory, `${date}-${slug}.md`);
          if (!previous && existsSync(file)) throw new Error('Essay filename collision');
          const frontmatter = { title, date, tags, draft: false, slug, ...(article.excerpt ? { excerpt: text(article.excerpt, 'excerpt', 2000) } : {}), source: `notion:${id}` };
          const content = `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}\n`;
          plans.push({ id, file, title, slug, date, content, skipped: !!previous && previous.content !== content && !overwrite, unchanged: previous?.content === content });
        }
        const targets = plans.filter((plan) => !plan.skipped).map((plan) => plan.file);
        const destination = push ? await git.preflight(targets) : null;
        for (const plan of plans) if (!plan.skipped && !plan.unchanged) atomicWrite(plan.file, plan.content);
        const publication = destination ? await git.publish(targets, destination, 'essays: publish from Notion') : { state: 'local', pushed: false };
        return { results: plans.map(({ content, ...result }) => result), ...publication };
      };
      const serialized = () => withLock(join(root, '.site-publisher.lock'), operation, { timeout: 1000 });
      return push ? git.withTransaction(serialized) : serialized();
    },
  };
}
