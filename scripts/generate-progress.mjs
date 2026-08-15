/**
 * 进度图数据生成（07-wayfinder-pipeline）
 *
 * 读取 wayfinder 本地 issue tracker（.scratch/<effort>/）：
 *  - map.md      → effort 主节点（title / destination / decisions）
 *  - issues/NN-xxx.md → ticket 子节点（type / status / blocked_by / question / answer）
 * 生成 public/progress.json（提交入库 = 内容变更，随构建发布）。
 *
 * 用法：node scripts/generate-progress.mjs [--scratch <dir>]
 *  默认 SCRATCH_DIR = 环境变量 SCRATCH_DIR || ../../.scratch（相对本脚本）
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = process.argv.slice(2);
const arg = (flag) => {
  const i = CLI.indexOf(flag);
  return i >= 0 ? CLI[i + 1] : undefined;
};
const scratchDir = resolve(arg('--scratch') || process.env.SCRATCH_DIR || join(__dirname, '..', '..', '.scratch'));
const outFile = resolve(join(__dirname, '..', 'public', 'progress.json'));

const isTicketFile = (n) => /^\d{2}-.+\.md$/.test(n);
const slug = (s) => String(s).trim().toLowerCase().replace(/[^\w一-龥-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function sectionFirstLine(text, heading) {
  const m = text.match(new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |\\n\\Z|$)`));
  if (!m) return '';
  const body = m[0].replace(new RegExp(`^## ${heading}\\s*`), '');
  return body.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
}

function parseMap(file) {
  const text = readFileSync(file, 'utf8');
  const titleLine = text.match(/^#\s+(.+)$/m);
  const title = titleLine ? titleLine[1].replace(/\s*·\s*Wayfinding Map.*$/, '').trim() : basename(dirname(file));
  const destination = sectionFirstLine(text, 'Destination');
  const decisions = [];
  const dm = text.match(/## Decisions so far[\s\S]*?(?=\n## |$)/);
  if (dm) {
    for (const line of dm[0].split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*\[(.+?)\]\(issues\/(\d{2}-[^)]+\.md)\)\s*—\s*(.+)$/);
      if (m) decisions.push({ id: m[2].replace(/\.md$/, ''), title: m[1], gist: m[3] });
    }
  }
  return { title, destination, decisions };
}

function parseTicket(file) {
  const text = readFileSync(file, 'utf8');
  const id = file.match(/(\d{2})-[^/\\]+\.md$/)?.[1] || basename(file, '.md');
  const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/^## Question\s*\n\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : basename(file, '.md');
  const type = text.match(/^Type:\s*(.+)$/m)?.[1]?.trim() || '';
  let status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase() || 'open';
  if (!['open', 'claimed', 'resolved', 'closed'].includes(status)) status = 'open';
  const blockedBy = (text.match(/^Blocked by:\s*(.+)$/m)?.[1]?.split(',').map((s) => s.trim()).filter(Boolean) || [])
    .map((b) => b.replace(/^\s*(\d{2})?\s*/, '').trim())
    .filter((b) => /^\d{2}$/.test(b));
  const question = sectionFirstLine(text, 'Question');
  const answer = sectionFirstLine(text, 'Answer');
  return { id, file: `issues/${basename(file)}`, title, type, status, blocked_by: blockedBy, question, answer };
}

// ---- 主流程 ----
if (!existsSync(scratchDir)) {
  console.error(`[progress] SCRATCH_DIR 不存在：${scratchDir}`);
  process.exit(1);
}

const efforts = [];
for (const dir of readdirSync(scratchDir).filter((d) => statSync(join(scratchDir, d)).isDirectory())) {
  const mapFile = join(scratchDir, dir, 'map.md');
  if (!existsSync(mapFile)) continue;
  const map = parseMap(mapFile);
  const issuesDir = join(scratchDir, dir, 'issues');
  const tickets = existsSync(issuesDir)
    ? readdirSync(issuesDir).filter(isTicketFile).sort().map((f) => parseTicket(join(issuesDir, f)))
    : [];
  efforts.push({
    id: slug(dir),
    title: map.title,
    destination: map.destination,
    decisions: map.decisions,
    tickets,
  });
}

const progress = {
  schema: '1.0',
  updated_at: new Date().toISOString(),
  generator: 'generate-progress.mjs',
  note: 'wayfinder 决策图谱；effort/ticket/Blocked by 直读 .scratch 生成',
  efforts,
};

writeFileSync(outFile, JSON.stringify(progress, null, 2) + '\n', 'utf8');
const n = efforts.reduce((a, e) => a + e.tickets.length, 0);
console.log(`[progress] wrote ${outFile}`);
console.log(`[progress] ${efforts.length} efforts · ${n} tickets`);
