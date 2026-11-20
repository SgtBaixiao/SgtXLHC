/** Shared public data contract. No DOM, network or Node dependencies. */
export const AGENT_STATUS = ['idle', 'working', 'blocked', 'error'];
export const TASK_STATUS = ['pending', 'in-progress', 'blocked', 'resolved'];
export const LIMITS = Object.freeze({ agents: 250, efforts: 50, tickets: 1000, nodes: 1500, links: 5000 });
export function text(value, label, max = 2000) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function identifier(value, label = 'id') {
  text(value, label, 100);
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function timestamp(value, label) {
  text(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}`);
  const date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Invalid ${label}`);
  return value;
}
export function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function boundedArray(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
function unique(rows, label) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(`Duplicate ${label}`);
}
export function publicAgent(value, { partial = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid agent');
  const out = { id: identifier(value.id, 'agent id') };
  for (const key of ['name', 'current_task', 'session', 'source', 'note']) {
    if (value[key] === null && key !== 'name') { if (partial) out[key] = null; }
    else if (value[key] !== undefined) out[key] = text(value[key], key, key === 'note' ? 2000 : 300);
  }
  for (const [key, choices] of [['status', AGENT_STATUS], ['task_status', TASK_STATUS]]) {
    if (value[key] !== undefined) {
      if (value[key] === null && key === 'task_status') { if (partial) out[key] = null; continue; }
      if (!choices.includes(value[key])) throw new Error(`Invalid ${key}`);
      out[key] = value[key];
    }
  }
  for (const key of ['heartbeat', 'started_at']) {
    if (value[key] === null && key === 'started_at') { if (partial) out[key] = null; }
    else if (value[key] !== undefined) out[key] = timestamp(value[key], key);
  }
  if (!partial && (!out.name || !out.status || !out.heartbeat)) throw new Error('Agent needs name, status and heartbeat');
  return out;
}
function envelope(value) {
  if (!value || value.schema !== '1.0') throw new Error('Unsupported data schema');
  timestamp(value.updated_at, 'updated_at');
  return { schema: '1.0', updated_at: value.updated_at, generator: text(value.generator || '', 'generator', 100), note: text(value.note || '', 'note', 2000) };
}
export function validateStatus(value) {
  const agents = boundedArray(value?.agents, 'agents', LIMITS.agents).map((agent) => publicAgent(agent));
  unique(agents, 'agent');
  return { ...envelope(value), agents };
}
export function validateProgress(value) {
  let total = 0, edgeTotal = 0;
  const efforts = boundedArray(value?.efforts, 'efforts', LIMITS.efforts).map((effort) => {
    const tickets = boundedArray(effort.tickets, 'tickets', LIMITS.tickets).map((ticket) => {
      if (!['open', 'claimed', 'resolved', 'closed'].includes(ticket.status)) throw new Error('Invalid ticket status');
      const blocked_by = boundedArray(ticket.blocked_by, 'dependencies', LIMITS.tickets).map((id) => identifier(id));
      if (new Set(blocked_by).size !== blocked_by.length) throw new Error('Duplicate dependency');
      edgeTotal += blocked_by.length + 1;
      const out = { id: identifier(ticket.id), title: text(ticket.title, 'ticket title'), status: ticket.status, blocked_by };
      for (const key of ['file', 'type', 'question', 'answer']) if (ticket[key] !== undefined) out[key] = text(ticket[key], key, 8000);
      return out;
    });
    unique(tickets, 'ticket'); total += tickets.length + 1;
    const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    const done = new Set(), visiting = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error('Cyclic dependency');
      if (done.has(id)) return;
      const ticket = byId.get(id);
      if (!ticket) throw new Error(`Missing dependency ${id}`);
      visiting.add(id); ticket.blocked_by.forEach(visit); visiting.delete(id); done.add(id);
    }
    tickets.forEach((ticket) => visit(ticket.id));
    const decisions = boundedArray(effort.decisions || [], 'decisions', 1000).map((decision) => ({ id: identifier(decision.id), title: text(decision.title, 'decision title'), gist: text(decision.gist, 'decision gist', 8000) }));
    return { id: identifier(effort.id), title: text(effort.title, 'effort title'), destination: text(effort.destination || '', 'destination', 8000), decisions, tickets };
  });
  unique(efforts, 'effort');
  if (total > LIMITS.nodes || edgeTotal > LIMITS.links) throw new Error('Progress graph exceeds budget');
  return { ...envelope(value), efforts };
}
