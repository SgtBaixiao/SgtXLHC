import { escapeHtml } from '../lib/dom.js';
import { validateStatus } from '../lib/contracts.js';
import { mountGraph } from '../lib/graph-controller.js';
import { statusSources, statusColor, AGENT_STATUS_LABEL, TASK_STATUS_LABEL, timeAgo, formatDateTime, slugify } from '../lib/status';

function buildGraph(statusData) {
  const nodes = [];
  const links = [];
  for (const a of statusData.agents || []) {
    const color = statusColor(a.status);
    nodes.push({
      id: `agent:${a.id}`,
      label: a.name,
      kind: 'primary',
      color,
      pulse: a.status === 'working' || a.status === 'blocked',
      sub: AGENT_STATUS_LABEL[a.status] || a.status,
      detail: { type: 'agent', agent: a },
    });
    if (a.current_task) {
      const taskId = `task:${a.id}:${slugify(a.current_task)}`;
      nodes.push({
        id: taskId,
        label: a.current_task,
        kind: 'leaf',
        color: statusColor(a.task_status || 'pending'),
        pulse: a.task_status === 'in-progress',
        detail: { type: 'task', agent: a },
      });
      links.push({ source: `agent:${a.id}`, target: taskId, kind: 'contain' });
    }
  }
  return { nodes, links };
}

function renderAgentDrawer(raw) {
  const agent = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, escapeHtml(value)]));
  const st = AGENT_STATUS_LABEL[agent.status] || agent.status;
  const ts = TASK_STATUS_LABEL[agent.task_status] || '—';
  return `
    <p class="mono" style="color:var(--ink-faint);margin:0 0 .25rem">Agent</p>
    <h3 style="margin:0 0 1rem">${agent.name}</h3>
    <div class="badge badge--${agent.status}"><i></i>${st}</div>
    <div class="drawer__meta">
      ${agent.current_task ? `<div><span>当前任务</span><b>${agent.current_task}</b></div>` : '<div><span>当前任务</span><b class="muted">待命中</b></div>'}
      ${agent.current_task ? `<div><span>任务状态</span><b>${ts}</b></div>` : ''}
      ${agent.started_at ? `<div><span>开始</span><b>${formatDateTime(agent.started_at)}</b></div>` : ''}
      ${agent.heartbeat ? `<div><span>心跳</span><b>${timeAgo(agent.heartbeat)}</b></div>` : ''}
      ${agent.session ? `<div><span>会话</span><b class="mono">${agent.session.slice(0, 8)}…</b></div>` : ''}
      ${agent.source ? `<div><span>来源</span><b class="mono">${agent.source}</b></div>` : ''}
    </div>
    ${agent.note ? `<p class="drawer__note">${agent.note}</p>` : ''}
    <p class="drawer__hint">状态每约 90s 轮询一次；raw 边缘缓存约 5 分钟。</p>
  `;
}

function renderTaskDrawer(raw) {
  const agent = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, escapeHtml(value)]));
  const ts = TASK_STATUS_LABEL[agent.task_status] || '—';
  return `
    <p class="mono" style="color:var(--ink-faint);margin:0 0 .25rem">当前任务</p>
    <h3 style="margin:0 0 1rem">${agent.current_task}</h3>
    <div class="badge badge--${agent.task_status || 'pending'}"><i></i>${ts}</div>
    <div class="drawer__meta">
      <div><span>所属 agent</span><b>${agent.name}</b></div>
      ${agent.heartbeat ? `<div><span>心跳</span><b>${timeAgo(agent.heartbeat)}</b></div>` : ''}
    </div>
  `;
}

export function initAgentGraph() {
  return mountGraph({
    canvasSelector: '[data-agent-graph]', metaSelector: '[data-status-meta]',
    sources: statusSources, validate: validateStatus, buildGraph,
    renderDetails: (node) => node.detail.type === 'agent' ? renderAgentDrawer(node.detail.agent) : renderTaskDrawer(node.detail.agent),
    summary: (value) => `${value.agents.length} agents · ${value.agents.filter((agent) => agent.status === 'working').length} working · ${timeAgo(value.updated_at)} 更新`,
    emptyMessage: '尚无 agent 状态上报', ariaLabel: 'Agent 工作状态图谱：节点为 agent 与当前任务',
  });
}
