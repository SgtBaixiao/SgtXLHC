/**
 * Notion 共享核心（notion-publish.mjs 与 publish-bridge.mjs 共用）
 *
 * 安全边界（长期记忆，必须遵守）：
 *  - NOTION_TOKEN 只来自环境变量 / 本地 .env.local，绝不入库、绝不进 public/
 *  - token 需要最小权限（integration 仅 Read content）
 *
 * 导出：listDatabase / pageToMarkdown / writeEssay / slugify / ensureToken
 * 数据库字段映射见 COLUMN_MAP。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(join(__dirname, '..', '..'));
export const ESSAYS_DIR = join(ROOT, 'src', 'content', 'essays');

// 允许从仓库根的 .env.local 读 token（该文件必须 gitignored，绝不提交）
function loadLocalEnv() {
  const envFile = join(ROOT, '.env.local');
  if (!existsSync(envFile)) return {};
  const out = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const localEnv = loadLocalEnv();

/** 返回 token；无则抛错。仅 env / .env.local，永不写盘入库。 */
export function ensureToken() {
  const token = process.env.NOTION_TOKEN || localEnv.NOTION_TOKEN;
  if (!token) {
    throw new Error(
      '缺少 NOTION_TOKEN：请设环境变量，或写入 gitignored 的 .env.local（NOTION_TOKEN=ntn_...）'
    );
  }
  return token;
}

// ---- 字段映射（按 Notion 数据库实际列名改；语义契约：title/date/tags/excerpt/published/slug） ----
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

export const slugify = (s) => String(s || '')
  .trim()
  .toLowerCase()
  .replace(/[^\w一-龥-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 80);

// ---- lazy：只在真正调用 Notion 时才加载 SDK ----
let notion = null;
let n2m = null;
function client() {
  if (!notion) {
    const token = ensureToken();
    const { Client } = requireSdk('@notionhq/client');
    notion = new Client({ auth: token });
    const { NotionToMarkdown } = requireSdk('notion-to-md');
    n2m = new NotionToMarkdown({ notionClient: notion });
  }
  return { notion, n2m };
}

// node 无 package:exports 时用 createRequire，保证从 scripts/ 子目录也能加载
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
function requireSdk(name) {
  try {
    return req(name);
  } catch {
    throw new Error(`缺少依赖 ${name}：请 npm install @notionhq/client notion-to-md`);
  }
}

export async function listDatabase(dbId, { publishedOnly = false } = {}) {
  const { notion } = client();
  const resp = await notion.databases.query({
    database_id: dbId,
    page_size: 100,
    ...(publishedOnly ? { filter: { property: COLUMN_MAP.published, checkbox: { equals: true } } } : {}),
  });
  return resp.results.map((page) => ({
    id: page.id,
    title: propValue(page.properties, COLUMN_MAP.title) || page.id,
    date: propValue(page.properties, COLUMN_MAP.date),
    tags: propValue(page.properties, COLUMN_MAP.tags) || [],
    excerpt: propValue(page.properties, COLUMN_MAP.excerpt),
    published: propValue(page.properties, COLUMN_MAP.published) ?? false,
    slug: propValue(page.properties, COLUMN_MAP.slug) || undefined,
    url: page.url,
  }));
}

export async function pageToMarkdown(pageId) {
  const { n2m } = client();
  const mdblocks = await n2m.pageToMarkdown(pageId);
  return n2m.toMarkdownString(mdblocks);
}

/** 从 page 属性拼 frontmatter + 正文，写 essays 目录；返回 {file,title,slug,date} */
export async function writeEssay(pageId, { force = false, slugOverride } = {}) {
  const { notion } = client();
  const page = await notion.pages.retrieve({ page_id: pageId });
  const props = page.properties;
  const title = propValue(props, COLUMN_MAP.title) || 'Untitled';
  const date = propValue(props, COLUMN_MAP.date) || new Date().toISOString().slice(0, 10);
  const tags = propValue(props, COLUMN_MAP.tags) || [];
  const excerpt = propValue(props, COLUMN_MAP.excerpt);
  const slug = slugOverride || propValue(props, COLUMN_MAP.slug) || slugify(title);
  const body = await pageToMarkdown(pageId);

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: "${date.slice(0, 10)}"`,
    `tags: ${JSON.stringify(tags)}`,
    `draft: false`,
    `slug: ${JSON.stringify(slug)}`,
    excerpt ? `excerpt: ${JSON.stringify(excerpt)}` : '',
    `source: "notion:${pageId}"`,
    '---',
    '',
  ].filter((l) => l !== '').join('\n');

  const file = join(ESSAYS_DIR, `${date.slice(0, 10)}-${slug}.md`);
  if (existsSync(file) && !force) {
    return { file, title, slug, date, skipped: true };
  }
  mkdirSync(ESSAYS_DIR, { recursive: true });
  writeFileSync(file, `${frontmatter}\n\n${body.replace(/^﻿/, '')}\n`, 'utf8');
  return { file, title, slug, date };
}
