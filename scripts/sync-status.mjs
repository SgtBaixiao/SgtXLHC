/**
 * Agent 状态上报管道（07-agent-status-pipeline）
 *
 * 各 agent 会话结束/停止时调用本脚本，把状态写进 public/live/status.json
 * 并（可选）提交推送；首页客户端轮询 raw.githubusercontent.com 读到它。
 *
 * 用法：
 *   # 方式 A：整份/单个 agent 状态 JSON
 *   node scripts/sync-status.mjs --json-file <path> [--push]
 *
 *   # 方式 B：命令行字段（Claude Code Stop hook 直接调）
 *   node scripts/sync-status.mjs \
 *     --agent claude --name "Claude" --status working \
 *     --task "Notion 发布桥" --task-status in-progress \
 *     --note "..." --source stop-hook --push
 *
 * 可选：
 *   --prune-hours <N>   清理心跳早于 N 小时的 agent（默认 0=不清理）
 *   --push              提交并推送 public/live/status.json（部署流水线已
 *                       paths-ignore 该路径，不触发重建）
 *
 * 契约：status.json = { schema, updated_at, generator, note, agents: [...] }
 *  agent = { id, name, status(idle|working|blocked|error),
 *            current_task?, task_status?(pending|in-progress|blocked|resolved),
 *            session?, started_at?, heartbeat?, source?, note? }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, '..'));
const STATUS_FILE = join(ROOT, 'public', 'live', 'status.json');

const AGENT_STATUS = ['idle', 'working', 'blocked', 'error'];
const TASK_STATUS = ['pending', 'in-progress', 'blocked', 'resolved'];

const CLI = process.argv.slice(2);
const arg = (flag) => {
  const i = CLI.indexOf(flag);
  return i >= 0 ? CLI[i + 1] : undefined;
};
const has = (flag) => CLI.includes(flag);

const now = () => new Date().toISOString();

// ---- 读当前 ----
function readCurrent() {
  if (!existsSync(STATUS_FILE)) {
    return { schema: '1.0', updated_at: now(), generator: 'sync-status.mjs', note: '', agents: [] };
  }
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    console.error('[status] 现有 status.json 无法解析，以空状态覆盖');
    return { schema: '1.0', updated_at: now(), generator: 'sync-status.mjs', note: '', agents: [] };
  }
}

// ---- 解析输入为 agent 数组 ----
function inputAgents() {
  const jsonFile = arg('--json-file');
  if (jsonFile) {
    const raw = JSON.parse(readFileSync(resolve(jsonFile), 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw.agents && Array.isArray(raw.agents)) return raw.agents;
    if (raw.id) return [raw];
    throw new Error(`--json-file 无法识别为状态对象：需要 {agents:[...]}、agent 对象或数组`);
  }

  const id = arg('--agent');
  if (!id) throw new Error('请提供 --agent <id> 或 --json-file <path>');
  const agent = {
    id,
    name: arg('--name') || id,
    status: arg('--status') || 'idle',
  };
  const task = arg('--task');
  if (task) agent.current_task = task;
  const ts = arg('--task-status');
  if (ts) agent.task_status = ts;
  const session = arg('--session');
  if (session) agent.session = session;
  const note = arg('--note');
  if (note) agent.note = note;
  const source = arg('--source');
  if (source) agent.source = source;
  const started = arg('--started-at');
  if (started) agent.started_at = started;
  agent.heartbeat = now();
  return [agent];
}

// ---- 合并 ----
function normalize(agent, incoming) {
  for (const k of ['id', 'name', 'status', 'current_task', 'task_status', 'session', 'started_at', 'heartbeat', 'source', 'note']) {
    if (incoming[k] !== undefined) agent[k] = incoming[k];
  }
  if (!agent.heartbeat) agent.heartbeat = now();
  if (agent.status && !AGENT_STATUS.includes(agent.status)) {
    console.warn(`[status] 未知 agent 状态 "${agent.status}"，回落 idle`);
    agent.status = 'idle';
  }
  if (agent.task_status && !TASK_STATUS.includes(agent.task_status)) {
    console.warn(`[status] 未知任务状态 "${agent.task_status}"，删除该字段`);
    delete agent.task_status;
  }
  return agent;
}

function mergeAgents(existing, incoming) {
  const map = new Map(existing.map((a) => [a.id, a]));
  for (const inc of incoming) {
    if (!inc || !inc.id) continue;
    const prev = map.get(inc.id) || { id: inc.id, heartbeat: now() };
    map.set(inc.id, normalize(prev, inc));
  }
  return [...map.values()];
}

// ---- 主流程 ----
let current = readCurrent();
current.agents = mergeAgents(current.agents, inputAgents());

const prune = Number(arg('--prune-hours') || 0);
if (prune > 0) {
  const cutoff = Date.now() - prune * 3600 * 1000;
  const before = current.agents.length;
  current.agents = current.agents.filter((a) => new Date(a.heartbeat).getTime() >= cutoff);
  if (current.agents.length !== before) console.log(`[status] 清理 ${before - current.agents.length} 个失联 agent（>${prune}h）`);
}

current.updated_at = now();
current.generator = 'sync-status.mjs';

mkdirSync(dirname(STATUS_FILE), { recursive: true });
const tmp = `${STATUS_FILE}.tmp`;
writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n', 'utf8');
renameSync(tmp, STATUS_FILE);

const line = current.agents.map((a) => `${a.id}=${a.status}${a.current_task ? `(${a.current_task})` : ''}`).join(', ') || 'no agents';
console.log(`[status] wrote ${STATUS_FILE}`);
console.log(`[status] ${current.agents.length} agents · ${line}`);

// ---- 推送（可选） ----
if (has('--push')) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' });
  } catch {
    console.error('[status] 不在 git 仓库内，跳过 push');
    process.exit(1);
  }
  const msg = `status: ${current.agents.map((a) => `${a.id}=${a.status}`).join(', ')}`.slice(0, 120);
  execSync(`git add public/live/status.json`, { cwd: ROOT });
  execSync(`git commit -m "${msg}"`, { cwd: ROOT, stdio: 'pipe' });
  execSync('git push', { cwd: ROOT, stdio: 'pipe' });
  console.log(`[status] pushed: ${msg}`);
}
