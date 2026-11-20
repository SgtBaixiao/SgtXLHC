import { openSync, closeSync, fsyncSync, writeFileSync, renameSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, file);
    const dir = openSync(dirname(file), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }); }
}
export const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
/** Never steal a lock: a crashed owner requires operator inspection and recovery. */
export async function withLock(lock, operation, { timeout = 10000 } = {}) {
  mkdirSync(dirname(lock), { recursive: true });
  const start = Date.now();
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - start >= timeout) throw new Error(`Busy or interrupted operation; inspect ${lock}`);
      await delay(20);
    }
  }
  try {
    atomicWrite(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
