import { publicAgent, validateStatus, LIMITS } from '../../src/lib/contracts.js';
import { readJson, withLock, writeJson } from './files.mjs';
export async function updateStatus(file, incoming, { pruneHours = 0, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(incoming) || incoming.length > LIMITS.agents || !Number.isFinite(pruneHours) || pruneHours < 0) throw new Error('Invalid update options');
  const patches = incoming.map((agent) => publicAgent(agent, { partial: true }));
  if (new Set(patches.map((agent) => agent.id)).size !== patches.length) throw new Error('Duplicate incoming agent');
  return withLock(`${file}.lock`, () => {
    const current = validateStatus(readJson(file, { schema: '1.0', updated_at: now, generator: '', note: '', agents: [] }));
    const agents = new Map(current.agents.map((agent) => [agent.id, agent]));
    for (const patch of patches) {
      const previous = agents.get(patch.id), heartbeat = patch.heartbeat || now;
      if (previous && Date.parse(heartbeat) < Date.parse(previous.heartbeat)) continue;
      agents.set(patch.id, publicAgent({ name: patch.id, status: 'idle', ...previous, ...patch, heartbeat }));
    }
    const cutoff = Date.parse(now) - pruneHours * 3600000;
    const output = validateStatus({ ...current, updated_at: now, generator: 'sync-status.mjs', agents: [...agents.values()].filter((agent) => !pruneHours || Date.parse(agent.heartbeat) >= cutoff).sort((a, b) => a.id.localeCompare(b.id, 'en')) });
    writeJson(file, output); return output;
  });
}
