/**
 * 状态管道契约 & 拉取（07-agent-status-pipeline / 08-graph-model 对齐）
 *
 * 契约：status.json = { schema, updated_at, generator, note, agents: [...] }
 *  agent = { id, name, status(idle|working|blocked|error),
 *            current_task?, task_status?(pending|in-progress|blocked|resolved),
 *            session?, started_at?, heartbeat?, source?, note? }
 *
 * 拉取策略（01-free-hosting-realtime-research）：
 *  - 部署后首选 raw.githubusercontent（PUBLIC_GITHUB_REPO 注入），约 5 分钟缓存地板
 *  - 本地 dev/preview 回退同源 <base>live/status.json（构建时打包的最近一次状态）
 *  - fetch 一律 { cache:'no-store' }，不加自定义头（防预检 403）
 *  - 轮询 90s 起 + 指数退避封顶 10min；匿名限速 ~60/hr
 */
import { cssVar } from './graph';
import { base } from './site';

export const AGENT_STATUS = ['idle', 'working', 'blocked', 'error'];
export const TASK_STATUS = ['pending', 'in-progress', 'blocked', 'resolved'];

export const AGENT_STATUS_LABEL = {
  idle: '待命',
  working: '工作中',
  blocked: '阻塞',
  error: '错误',
};
export const TASK_STATUS_LABEL = {
  pending: '待办',
  'in-progress': '进行中',
  blocked: '阻塞',
  resolved: '已解决',
};

/** 部署后可用的状态数据源（优先 raw，回退同源） */
export function statusSources() {
  const repo = import.meta.env.PUBLIC_GITHUB_REPO; // "owner/repo"
  const branch = import.meta.env.PUBLIC_GITHUB_BRANCH || 'main';
  const srcs = [];
  if (repo) srcs.push(`https://raw.githubusercontent.com/${repo}/${branch}/public/live/status.json`);
  srcs.push(`${base}live/status.json`);
  return srcs;
}

/** 依次尝试所有源，返回第一个成功 JSON；全失败则抛错 */
export async function fetchFirst(urls, opts = {}) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store', ...opts });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(lastErr ? `所有状态源都不可达：${lastErr.message}` : '无状态源');
}

/** 状态 → 颜色（读 CSS token） */
export function statusColor(status) {
  const map = {
    idle: cssVar('--st-idle', '#8b8b87'),
    working: cssVar('--st-working', '#b07a33'),
    blocked: cssVar('--st-blocked', '#a3442f'),
    error: cssVar('--st-error', '#7d2d23'),
    resolved: cssVar('--st-resolved', '#5e7a54'),
    pending: cssVar('--ink-faint', '#999'),
    'in-progress': cssVar('--st-in-progress', '#b07a33'),
  };
  return map[status] || cssVar('--ink-ghost', '#ccc');
}

/** 相对时间 */
export function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 轮询：interval 起 + 指数退避封顶 maxInterval；返回 stop() */
export function startPolling(load, cb, { interval = 90000, maxInterval = 600000 } = {}) {
  let fail = 0;
  let timer = 0;
  async function tick() {
    try {
      const d = await load();
      fail = 0;
      cb(d, null);
    } catch (e) {
      fail += 1;
      cb(null, e);
    }
    timer = setTimeout(tick, Math.min(interval * 2 ** Math.min(fail, 3), maxInterval));
  }
  timer = setTimeout(tick, interval);
  return () => clearTimeout(timer);
}

export function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\w一-龥-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
