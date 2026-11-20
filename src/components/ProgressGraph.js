import { escapeHtml } from '../lib/dom.js';
import { validateProgress } from '../lib/contracts.js';
import { mountGraph } from '../lib/graph-controller.js';
import { statusColor } from '../lib/status';
import { base } from '../lib/site';

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

function renderEffortDrawer(raw) {
  const effort = { ...raw, title: escapeHtml(raw.title), destination: escapeHtml(raw.destination), decisions: raw.decisions.map((d) => escapeHtml(d.gist)) };
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

function renderTicketDrawer(raw) {
  const ticket = { ...raw, ...Object.fromEntries(['title', 'type', 'question', 'answer', 'file'].map((key) => [key, escapeHtml(raw[key])])) };
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
  return mountGraph({
    canvasSelector: '[data-progress-graph]', metaSelector: '[data-progress-meta]',
    sources: () => [`${base}progress.json`], validate: validateProgress, buildGraph,
    renderDetails: (node) => node.detail.type === 'effort' ? renderEffortDrawer(node.detail.effort) : renderTicketDrawer(node.detail.ticket),
    summary(value) {
      const tickets = value.efforts.flatMap((effort) => effort.tickets);
      return `${value.efforts.length} efforts · ${tickets.filter((ticket) => ticket.status === 'resolved').length}/${tickets.length} tickets resolved`;
    },
    emptyMessage: '暂无 wayfinder 数据', ariaLabel: 'wayfinder 开发进度图：effort 与 ticket 节点，虚线为阻塞关系',
  });
}
