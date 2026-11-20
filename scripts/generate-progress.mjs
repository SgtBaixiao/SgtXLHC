import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { args, ROOT, isMain, run } from './lib/cli.mjs';
import { slugify, validateProgress } from '../src/lib/contracts.js';
import { withLock, writeJson } from './lib/files.mjs';

const isTicketFile = (n) => /^\d{2}-.+\.md$/.test(n);


function sectionFirstLine(text, heading) {
  const m = text.match(new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |\\n\\Z|$)`));
  if (!m) return '';
  const body = m[0].replace(new RegExp(`^## ${heading}\\s*`), '');
  return body.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
}

export function parseMap(file) {
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

export function parseTicket(file) {
  const text = readFileSync(file, 'utf8');
  const id = file.match(/(\d{2})-[^/\\]+\.md$/)?.[1] || basename(file, '.md');
  const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/^## Question\s*\n\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : basename(file, '.md');
  const type = text.match(/^Type:\s*(.+)$/m)?.[1]?.trim() || '';
  let status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase() || 'open';
  if (!['open', 'claimed', 'resolved', 'closed'].includes(status)) throw new Error(`Invalid ticket status in ${file}`);
  const dependencyLine = text.match(/^Blocked by:[ \t]*(.*)$/m)?.[1]?.trim() || '';
  const blockedBy = !dependencyLine || /^(none|—|-)$/i.test(dependencyLine) ? [] : dependencyLine.split(',').map((entry) => {
    const id = entry.trim().match(/^(\d{2})(?:\b|$)/)?.[1] || entry.match(/issues\/(\d{2})-/)?.[1];
    if (!id) throw new Error(`Invalid dependency in ${file}: ${entry}`);
    return id;
  });
  const question = sectionFirstLine(text, 'Question');
  const answer = sectionFirstLine(text, 'Answer');
  return { id, file: `issues/${basename(file)}`, title, type, status, blocked_by: blockedBy, question, answer };
}


export function readProgress(scratchDir, now = new Date().toISOString()) {
  if (!existsSync(scratchDir)) throw new Error(`SCRATCH_DIR does not exist: ${scratchDir}`);
  const efforts = [];
  for (const dir of readdirSync(scratchDir).sort().filter((entry) => statSync(join(scratchDir, entry)).isDirectory())) {
    const mapFile = join(scratchDir, dir, 'map.md');
    if (!existsSync(mapFile)) continue;
    const map = parseMap(mapFile);
    const issuesDir = join(scratchDir, dir, 'issues');
    const tickets = existsSync(issuesDir) ? readdirSync(issuesDir).filter(isTicketFile).sort().map((file) => parseTicket(join(issuesDir, file))) : [];
    efforts.push({ id: slugify(dir), ...map, tickets });
  }
  return validateProgress({ schema: '1.0', updated_at: now, generator: 'generate-progress.mjs', note: 'wayfinder effort/ticket dependencies', efforts });
}
export async function main(argv) {
  const options = args({ scratch: { type: 'string' } }, argv);
  const scratch = resolve(options.scratch || process.env.SCRATCH_DIR || join(ROOT, '..', '.scratch'));
  const file = join(ROOT, 'public/progress.json');
  await withLock(`${file}.lock`, () => {
    const progress = readProgress(scratch);
    writeJson(file, progress);
    console.log(`[progress] ${progress.efforts.length} efforts; wrote ${file}`);
  });
}
if (isMain(import.meta.url)) run(main);
