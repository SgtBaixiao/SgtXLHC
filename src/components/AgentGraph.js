/**
 * 首页 Agent 状态图（双子星座）—— 08-graph-model：
 *  agent + 当前任务两级节点；中心 agent 节点（Claude / pi），子节点挂当前任务；
 *  状态着色 + 脉冲；点击 agent 看状态，点击任务看细节；抽屉摘要+详情混合。
 */
import { createGraph, cssVar } from '../lib/graph';
import {
  statusSources,
  fetchFirst,
  statusColor,
  AGENT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  timeAgo,
  formatDateTime,
  slugify,
  startPolling,
} from '../lib/status';
import { bindDrawer } from '../lib/drawer';

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

function renderAgentDrawer(agent) {
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

function renderTaskDrawer(agent) {
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

export function initAgentGraph(opts = {}) {
  let canvas = document.querySelector('[data-agent-graph]');
  const shell = document.querySelector('[data-graph-shell]');
  const aside = document.querySelector('[data-graph-drawer]');
  const metaEl = document.querySelector('[data-status-meta]');
  const countEl = document.querySelector('[data-agent-count]');
  const workingEl = document.querySelector('[data-working-count]');
  const emptyEl = document.querySelector('[data-graph-empty]');

  if (!canvas) return;

  const drawer = bindDrawer(shell, aside);
  let graph = null;

  function render(statusData) {
    const data = buildGraph(statusData);

    if (graph) {
      graph.destroy();
      graph = null;
      // 用克隆节点替换旧 canvas，清掉旧图上的 zoom 回调与指针监听
      canvas.replaceWith(canvas.cloneNode(true));
      canvas = document.querySelector('[data-agent-graph]');
    }

    if (emptyEl) emptyEl.style.display = data.nodes.length ? 'none' : 'grid';
    if (!data.nodes.length) {
      if (metaEl) metaEl.textContent = '尚无 agent 状态上报';
      return;
    }

    graph = createGraph(canvas, {
      data,
      ariaLabel: 'Agent 工作状态图谱：节点为 agent 与当前任务',
      onSelect(node) {
        if (!node) { drawer.close(); return; }
        aside.innerHTML = node.detail.type === 'agent'
          ? renderAgentDrawer(node.detail.agent)
          : renderTaskDrawer(node.detail.agent);
        drawer.open();
      },
    });

    // 元信息
    if (metaEl) {
      const n = statusData.agents.length;
      const w = statusData.agents.filter((a) => a.status === 'working').length;
      metaEl.textContent = `${n} agents · ${w} working · ${timeAgo(statusData.updated_at)} 更新`;
    }
    if (countEl) countEl.textContent = String(statusData.agents.length);
    if (workingEl) workingEl.textContent = String(statusData.agents.filter((a) => a.status === 'working').length);
  }

  let first = true;
  async function load() {
    return fetchFirst(statusSources());
  }

  async function refresh() {
    try {
      const d = await load();
      render(d);
    } catch {
      if (first && emptyEl) emptyEl.style.display = 'grid';
      if (metaEl) metaEl.textContent = '状态源暂不可达，显示最近一次构建数据';
    } finally {
      first = false;
    }
  }

  refresh();
  const stop = startPolling(refresh, null);
  return { destroy: () => { stop(); if (graph) graph.destroy(); } };
}
