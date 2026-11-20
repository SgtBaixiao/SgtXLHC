import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, isAbsolute, resolve } from 'node:path';
import { withLock } from './files.mjs';
const execute = promisify(execFile);
export function createGitPublisher(root) {
  const git = async (...args) => (await execute('git', args, { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  function paths(files) {
    return files.map((file) => {
      const entry = relative(root, resolve(file));
      if (!entry || entry.startsWith('..') || isAbsolute(entry)) throw new Error('Git path outside repository');
      return entry;
    });
  }
  async function preflight(files = []) {
    if (await git('diff', '--cached', '--name-only')) throw new Error('Git index has staged changes; publish aborted');
    const branch = await git('symbolic-ref', '--short', 'HEAD');
    const upstream = await git('rev-parse', '--abbrev-ref', `${branch}@{upstream}`);
    const slash = upstream.indexOf('/'), remote = upstream.slice(0, slash), target = upstream.slice(slash + 1);
    await git('fetch', remote, target);
    const head = await git('rev-parse', 'HEAD');
    if (head !== await git('rev-parse', 'FETCH_HEAD')) throw new Error('Local and remote history differ; reconcile before publishing');
    if (files.length && await git('status', '--porcelain', '--', ...paths(files))) throw new Error('Publication target has local edits; publish aborted');
    return { remote, target, head };
  }
  return {
    preflight,
    async withTransaction(operation) {
      const gitDir = await git('rev-parse', '--absolute-git-dir');
      return withLock(resolve(gitDir, 'site-publication.lock'), operation);
    },
    async publish(files, destination, message = 'site: update generated content') {
      const entries = paths(files);
      if (!entries.length || !await git('status', '--porcelain', '--', ...entries)) return { state: 'unchanged', pushed: false };
      if (await git('diff', '--cached', '--name-only')) throw new Error('Git index changed during publication; files remain local');
      if (await git('rev-parse', 'HEAD') !== destination.head) throw new Error('Git HEAD changed during publication; files remain local');
      await git('add', '--', ...entries);
      await git('commit', '--only', '-m', message, '--', ...entries);
      const commit = await git('rev-parse', 'HEAD');
      if (await git('rev-parse', 'HEAD^') !== destination.head) throw new Error('Git history changed during commit; inspect local commit before pushing');
      try { await git('push', destination.remote, `${commit}:refs/heads/${destination.target}`); }
      catch {
        const error = new Error(`Files committed as ${commit}; push failed or outcome unknown. Inspect remote before retrying.`);
        error.commit = commit;
        throw error;
      }
      return { state: 'pushed', pushed: true, commit };
    },
  };
}
