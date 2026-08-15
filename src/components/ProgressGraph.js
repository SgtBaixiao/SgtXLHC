/**
 * /progress 进度图（07-wayfinder-pipeline）—— 08-graph-model「对接 wayfinder」：
 *  以 wayfinder 地图（.scratch/<effort>/map.md + issues/NN-<slug>.md）为源，
 *  generate-progress.mjs 生成 progress.json；本组件把 effort 画成主节点、
 *  把每个 ticket 画成子节点；Blocked by 画成虚线 depend 边。
 *
 * progress.json 契约：
 *  { schema, updated_at, generator, note, efforts: [
 *     { id, title, destination, note, decisions: [...], tickets: [
 *        { id, file, title, type, status, blocked_by: [id],
 *          question?, answer? } ] } ] }
 */
import { createGraph } from '../lib/graph';
import { statusColor, slugify, fetchFirst, startPolling } from '../lib/status';
import { bindDrawer } from '../lib/drawer';

const STATUS_LABEL = {
  open: '进行中',
  claimed: '已认领',
  resolved: '已解决',
  closed: '已关闭',
};

function buildGraph(p) {
  const nodes = [];
  const links = [];
  for (const e of p.efforts || []) {
    const eid = `effort:${e.id}`;
    nodes.push({
      id: eid,
      label: e.title,
      kind: 'primary',
      color: statusColor('working'),
      sub: `${(e.tickets || []).length} tickets`,
      detail: { type: 'effort', effort: e },
    });
    for (const t of e.tickets || []) {
      const tid = `ticket:${e.id}:${t.id}`;
      nodes.push({
        id: tid,
        label: t.title,
        kind: 'leaf',
        color: statusColor(t.status === 'resolved' ? 'resolved' : t.status === 'claimed' ? 'working' : 'pending'),
        pulse: t.status === 'claimed',
        detail: { type: 'ticket', ticket: t, effort: e },
      });
      links.push({ source: eid, target: tid, kind: 'contain' });
      for (const b of t.blocked_by || []) {
        links.push({
          source: tid,
          target: `ticket:${e.id}:${b}`,
          kind: 'depend',
          dashed: true,
        });
      }
    }
  }
  return { nodes, links };
}

function renderEffortDrawer(effort) {
  return `
    <p class="mono" style="color:var(--ink-faint);margin:0 0 .25rem">Effort</p>
    <h3 style="margin:0 0 1rem">${effort.title}</h3>
    <p class="drawer__note">${effort.destination || ''}</p>
    <div class="drawer__meta">
      <div><span>进度</span><b>${(effort.tickets || []).filter((t) => t.status === 'resolved').length} / ${(effort.tickets || []).length} resolved</b></div>
    </div>
    ${effort.decisions && effort.decisions.length ? `<div class="drawer__sec"><h4>决策</h4>${effort.decisions.map((d) => `<p>${d}</p>`).join('')}</div>` : ''}
  `;
}

function renderTicketDrawer(ticket) {
  const label = STATUS_LABEL[ticket.status] || ticket.status;
  const cls = ticket.status === 'resolved' ? 'resolved' : ticket.status === 'claimed' ? 'working' : 'pending';
  const blockedBy = (ticket.blocked_by || []).length
    ? ticket.blocked_by.join(' / ')
    : '—';
  return `
    <p class="mono" style="color:var(--ink-faint);margin:0 0 .25rem">Ticket</p>
    <h3 style="margin:0 0 1rem">${ticket.title}</h3>
    <div class="badge badge--${cls}"><i></i>${label}</div>
    <div class="drawer__meta">
      <div><span>类型</span><b class="mono">${ticket.type || '—'}</b></div>
      <div><span>阻塞于</span><b class="mono">${blockedBy}</b></div>
    </div>
    ${ticket.question ? `<div class="drawer__sec"><h4>问题</h4><p>${ticket.question}</p></div>` : ''}
    ${ticket.answer ? `<div class="drawer__sec"><h4>答案</h4><p>${ticket.answer}</p></div>` : ''}
    ${ticket.file ? `<p class="mono drawer__hint">来源：${ticket.file}</p>` : ''}
  `;
}

export function initProgressGraph() {
  let canvas = document.querySelector('[data-progress-graph]');
  const shell = document.querySelector('[data-graph-shell]');
  const aside = document.querySelector('[data-graph-drawer]');
  const metaEl = document.querySelector('[data-progress-meta]');
  const emptyEl = document.querySelector('[data-graph-empty]');

  if (!canvas) return;

  const drawer = bindDrawer(shell, aside);
  let graph = null;

  function render(p) {
    const data = buildGraph(p);
    if (graph) {
      graph.destroy();
      graph = null;
      canvas.replaceWith(canvas.cloneNode(true));
      canvas = document.querySelector('[data-progress-graph]');
    }
    if (emptyEl) emptyEl.style.display = data.nodes.length ? 'none' : 'grid';
    if (!data.nodes.length) {
      if (metaEl) metaEl.textContent = '暂无 wayfinder 数据';
      return;
    }
    graph = createGraph(canvas, {
      data,
      labelSize: 11,
      ariaLabel: 'wayfinder 开发进度图：effort 与 ticket 节点，虚线为阻塞关系',
      onSelect(node) {
        if (!node) { drawer.close(); return; }
        aside.innerHTML = node.detail.type === 'effort'
          ? renderEffortDrawer(node.detail.effort)
          : renderTicketDrawer(node.detail.ticket);
        drawer.open();
      },
    });
    if (metaEl) {
      const efforts = p.efforts.length;
      const tickets = p.efforts.reduce((a, e) => a + (e.tickets || []).length, 0);
      const done = p.efforts.reduce((a, e) => a + (e.tickets || []).filter((t) => t.status === 'resolved').length, 0);
      metaEl.textContent = `${efforts} efforts · ${done}/${tickets} tickets resolved`;
    }
  }

  let first = true;
  async function load() {
    return fetchFirst(['/progress.json']);
  }
  async function refresh() {
    try {
      render(await load());
    } catch {
      if (first && emptyEl) emptyEl.style.display = 'grid';
      if (metaEl) metaEl.textContent = '进度源不可达';
    } finally {
      first = false;
    }
  }

  refresh();
  const stop = startPolling(refresh, null);
  return { destroy: () => { stop(); if (graph) graph.destroy(); } };
}
