/**
 * Notion 随笔管道 CLI（09-notion-pipeline）
 *
 * 从 Notion 数据库拉取页面 → block → Markdown（notion-to-md@3.1.9）→
 * 落盘 src/content/essays/YYYY-MM-DD-slug.md（含 Astro frontmatter）。
 * 逻辑见 lib/notion-core.mjs；本文件只是命令行入口。
 *
 * 安全边界（长期记忆，必须遵守）：
 *  - NOTION_TOKEN 只来自环境变量 / gitignored .env.local，绝不入库
 *
 * 用法：
 *   npm run notion:list    -- --database <db_id> [--published-only]
 *   npm run notion:publish -- --database <db_id> --page <page_id> [--slug x --force]
 *   npm run notion:publish -- --database <db_id> --all [--force]
 *   任意命令加 --commit 会 git add+commit+push（触发 CI 构建）
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { listDatabase, writeEssay, ROOT } from './lib/notion-core.mjs';
const CLI = process.argv.slice(2);
const arg = (flag) => { const i = CLI.indexOf(flag); return i >= 0 ? CLI[i + 1] : undefined; };
const has = (flag) => CLI.includes(flag);

const db = arg('--database');
if (!db) {
  console.error('[notion] 需要 --database <db_id>（可在 Notion 数据库页面 URL 中取）');
  process.exit(1);
}

try {
  if (has('--list')) {
    const rows = await listDatabase(db, { publishedOnly: has('--published-only') });
    for (const r of rows) {
      console.log(`${r.id.slice(0, 8)}  ${r.date || '????-??-??'}  ${r.published ? '✓' : '·'}  ${r.title}`);
    }
    console.log(`[notion] ${rows.length} pages`);
  } else if (has('--all')) {
    const rows = await listDatabase(db, { publishedOnly: true });
    let n = 0;
    for (const r of rows) {
      const out = await writeEssay(r.id, { force: has('--force') });
      if (!out.skipped) { console.log(`[notion] wrote ${out.file}`); n += 1; }
    }
    console.log(`[notion] published ${n} essays`);
  } else {
    const page = arg('--page');
    if (!page) { console.error('[notion] 需要 --page <page_id> 或 --all'); process.exit(1); }
    const out = await writeEssay(page, { force: has('--force'), slugOverride: arg('--slug') });
    if (out.skipped) { console.error(`[notion] 已存在：${out.file}（--force 覆盖）`); process.exit(1); }
    console.log(`[notion] wrote ${out.file}`);
  }

  if (has('--commit')) {
    execSync('git add src/content/essays', { cwd: ROOT });
    execSync('git commit -m "essays: publish from Notion"', { cwd: ROOT, stdio: 'pipe' });
    execSync('git push', { cwd: ROOT, stdio: 'pipe' });
    console.log('[notion] committed & pushed（将触发构建）');
  }
} catch (e) {
  console.error(`[notion] 失败：${e.message}`);
  process.exit(1);
}
