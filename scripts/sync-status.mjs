import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { args, ROOT, isMain, run } from './lib/cli.mjs';
import { updateStatus } from './lib/status-store.mjs';
import { createGitPublisher } from './lib/git-publish.mjs';

export async function main(argv) {
  const options = args(Object.fromEntries(['json-file', 'agent', 'name', 'status', 'task', 'task-status', 'note', 'source', 'session', 'started-at', 'prune-hours'].map((key) => [key, { type: 'string' }]).concat([['push', { type: 'boolean' }]])), argv);
  let incoming;
  if (options['json-file']) {
    const raw = JSON.parse(readFileSync(resolve(options['json-file']), 'utf8'));
    incoming = Array.isArray(raw) ? raw : raw.agents || [raw];
  } else {
    incoming = [{ id: options.agent, name: options.name, status: options.status, current_task: options.task, task_status: options['task-status'], note: options.note, source: options.source, session: options.session, started_at: options['started-at'] }];
  }
  const file = resolve(ROOT, 'public/live/status.json');
  const git = createGitPublisher(ROOT);
  const update = async () => {
    const destination = options.push ? await git.preflight([file]) : null;
    const result = await updateStatus(file, incoming, { pruneHours: Number(options['prune-hours'] || 0) });
    console.log(`[status] ${result.agents.length} agents; wrote ${file}`);
    if (destination) console.log(await git.publish([file], destination, 'status: update agents'));
  };
  if (options.push) await git.withTransaction(update); else await update();
}
if (isMain(import.meta.url)) run(main);
