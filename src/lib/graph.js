/**
 * 2D Canvas + d3-force 图谱渲染器 —— 首页 Agent 图与 /progress 进度图共用。
 *
 * 特性（来自 03-graph-viz-research）：
 *  - d3-force 力导向布局（charge + link + collide + 主轴 forceX/Y）
 *  - 2D Canvas 渲染，fillText 标签 + 缩放 LOD 阈值
 *  - hover 邻接高亮、其余变暗
 *  - 点击 → onSelect(node) 回调，页面开右侧抽屉（grid 让位，非覆盖）
 *  - 彗星尾迹：正弦浮动 + 20 帧环形缓冲
 *  - reduced-motion：关闭浮动/尾迹/脉冲，静态布局
 *  - d3-zoom 缩放平移 + reset 复位
 *
 * 节点 shape：
 *   { id, label, sub?, kind: 'primary'|'leaf', color, url?, detail?, pulse? }
 * 边 shape：
 *   { source, target, kind: 'contain'|'depend', dashed? }
 */
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import { dragEnable } from 'd3-drag';
import { LIMITS } from './contracts.js';
import { cssVar } from './dom.js';
export { cssVar } from './dom.js';

const MONO_FONT = `"JetBrains Mono", "SFMono-Regular", ui-monospace, "Cascadia Mono", Consolas, monospace`;
const TRAIL_FRAMES = 20;
const TRAIL_EVERY = 2; // 每 2 帧采一个点

export function createGraph(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const {
    data,                 // { nodes, links }
    onSelect = null,
    onHover = null,
    getSub = (n) => n.sub || '',
    labelSize = 11,
    primaryRadius = 26,
    leafRadius = 7,
    ariaLabel = '图谱',
  } = opts;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = motion.matches, destroyed = false, visible = true;
  if (data.nodes.length > LIMITS.nodes || data.links.length > LIMITS.links) throw new Error('Graph exceeds budget');
  const simNodes = data.nodes.map((n) => ({ ...n }));
  const simLinks = data.links.map((l) => ({ ...l }));
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  if (byId.size !== simNodes.length) throw new Error('Duplicate graph node');
  const adjacency = new Map(simNodes.map((node) => [node.id, new Set()]));
  for (const link of simLinks) {
    if (!byId.has(link.source) || !byId.has(link.target)) throw new Error('Missing graph endpoint');
    adjacency.get(link.source).add(link.target); adjacency.get(link.target).add(link.source);
  }
  const events = new AbortController();
  const listen = (name, handler) => canvas.addEventListener(name, handler, { signal: events.signal });
  const idOf = (d) => d.id;

  // ---- 尺寸 / DPR ----
  let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  let transform = zoomIdentity;
  let raf = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width || 1;
    H = rect.height || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const xs = primaryXs();
    const ys = primaryYs();
    for (const n of simNodes) {
      if (n.kind === 'primary') {
        n.baseX = xs.get(n.id) ?? W / 2;
        n.baseY = ys.get(n.id) ?? H / 2;
      }
    }
    // d3 caches target coordinates when the force is initialized.
    sim.force('x').x((n) => n.baseX ?? W / 2);
    sim.force('y').y((n) => n.baseY ?? H / 2);
    reheat(0.35);
  }

  function primaryXs() {
    const ps = simNodes.filter((n) => n.kind === 'primary');
    const m = new Map();
    ps.forEach((n, i) => {
      m.set(n.id, ps.length === 1 ? W / 2 : W * (0.16 + (0.68 * i) / (ps.length - 1)));
    });
    return m;
  }
  function primaryYs() {
    const m = new Map();
    simNodes.filter((n) => n.kind === 'primary').forEach((n) => m.set(n.id, H * 0.44));
    return m;
  }
  const radiusOf = (n) => (n.kind === 'primary' ? primaryRadius : leafRadius);
  const pos = (n) => (n.rx !== undefined ? { x: n.rx, y: n.ry } : { x: n.x, y: n.y });

  // ---- 力导向 ----
  const sim = forceSimulation(simNodes)
    .force(
      'link',
      forceLink(simLinks)
        .id(idOf)
        .distance((l) => (l.kind === 'contain' ? 92 : 76)),
    )
    .force('charge', forceManyBody().strength((n) => (n.kind === 'primary' ? -260 : -120)))
    .force('x', forceX().x((n) => n.baseX ?? W / 2).strength((n) => (n.kind === 'primary' ? 0.9 : 0.06)))
    .force('y', forceY().y((n) => n.baseY ?? H / 2).strength((n) => (n.kind === 'primary' ? 0.9 : 0.09)))
    .force('collide', forceCollide().radius((n) => radiusOf(n) + 8));

  // ---- 状态 ----
  let hoverId = null;
  let neighborIds = new Set();
  let selectedId = null;
  const trail = new Map();   // id -> {x,y}[]
  const phase = new Map();
  simNodes.forEach((n, i) => phase.set(n.id, (i * 1.7) % (Math.PI * 2)));

  const frameState = {
    t: 0,
    floatAmp: reduce ? 0 : 4.5,
    trailOn: !reduce,
    pulseOn: !reduce,
  };

  function neighborsOf(id) {
    return adjacency.get(id) || new Set();
  }

  // ---- 交互 ----
  let gestureView = null;
  const zoomBeh = d3zoom()
    .scaleExtent([0.35, 4])
    .duration(0)
    .filter((ev) => !ev.button || ev.button === 0)
    .on('start.lifecycle', (ev) => { if (ev.sourceEvent?.type === 'mousedown') gestureView = ev.sourceEvent.view; })
    .on('end.lifecycle', () => { gestureView = null; })
    .on('zoom', (ev) => { if (!destroyed) { transform = ev.transform; draw(); } });
  select(canvas).call(zoomBeh);

  const toSim = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - transform.x) / transform.k,
      y: (e.clientY - r.top - transform.y) / transform.k,
    };
  };

  let downX = null, downY = null, dragging = false;

  listen('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; dragging = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });
  listen('pointermove', (e) => {
    if (downX !== null && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) dragging = true;
    const p = toSim(e);
    const hit = hitTest(p.x, p.y);
    if ((hit ? hit.id : null) !== hoverId) {
      hoverId = hit ? hit.id : null;
      neighborIds = hit ? new Set([hit.id, ...hit.neighbors]) : new Set();
      if (onHover) onHover(hit ? hit.node : null);
      draw();
    }
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });
  listen('pointerup', (e) => {
    if (!dragging) {
      const p = toSim(e);
      const hit = hitTest(p.x, p.y);
      selectedId = hit ? hit.id : null;
      if (onSelect) onSelect(hit ? hit.node : null);
      draw();
    }
    downX = null;
  });
  listen('pointerleave', () => {
    hoverId = null; neighborIds = new Set();
    if (onHover) onHover(null);
    draw();
  });

  // 键盘可达：方向键切换焦点，Enter/空格打开抽屉
  const focussables = simNodes.map((n) => n.id);
  let focusIdx = -1;
  listen('keydown', (e) => {
    if (!focussables.length) return;
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) {
      focusIdx = (focusIdx + 1) % focussables.length;
    } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
      focusIdx = (focusIdx - 1 + focussables.length) % focussables.length;
    } else if (e.key === 'Enter' || e.key === ' ') {
      const n = simNodes.find((x) => x.id === focussables[focusIdx]);
      if (n && onSelect) { selectedId = n.id; onSelect(n); }
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    hoverId = focussables[focusIdx];
    neighborIds = new Set([hoverId, ...neighborsOf(hoverId)]);
    draw();
  });
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', ariaLabel);

  function hitTest(x, y) {
    let best = null, bestD = Infinity;
    for (const n of simNodes) {
      const p = pos(n);
      const nr = radiusOf(n) + 4;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < nr + 10 / transform.k && d < bestD) { bestD = d; best = n; }
    }
    if (!best) return null;
    return { id: best.id, node: best, neighbors: [...neighborsOf(best.id)] };
  }

  // ---- 渲染 ----
  const ink = () => cssVar('--ink', '#1a1a19');

  function hoverDim(...ids) {
    if (!hoverId) return 1;
    return ids.some((i) => neighborIds.has(i)) ? 1 : 0.16;
  }

  function draw() {
    if (destroyed) return;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    drawLinks();

    for (const n of simNodes) drawNode(n);

    const lodLeaf = transform.k >= 0.85;
    for (const n of simNodes) {
      if (n.kind === 'primary') drawLabel(n, 1);
      else if (lodLeaf) drawLabel(n, 0.85);
    }

    ctx.restore();
  }

  function drawLinks() {
    const inkCol = ink();
    for (const l of simLinks) {
      const s = typeof l.source === 'object' ? l.source : byId.get(l.source);
      const t = typeof l.target === 'object' ? l.target : byId.get(l.target);
      if (!s || !t) continue;
      const ps = pos(s), pt = pos(t);
      const dim = hoverDim(s.id, t.id);
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = inkCol;
      ctx.globalAlpha = (l.kind === 'depend' ? 0.34 : 0.15) * dim;
      ctx.lineWidth = l.kind === 'depend' ? 1 : 0.7;
      if (l.dashed) ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function drawNode(n) {
    const { x, y } = pos(n);
    const r = radiusOf(n);
    const color = n.color || ink();
    const dim = hoverDim(n.id);
    const selected = n.id === selectedId;

    // 彗星尾迹
    if (frameState.trailOn) {
      const hist = trail.get(n.id);
      if (hist && hist.length > 2) {
        for (let i = 0; i < hist.length; i++) {
          const p = hist[i];
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (0.3 + (0.7 * i) / hist.length), 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = (i / hist.length) * 0.16 * dim;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    ctx.globalAlpha = dim;
    if (n.kind === 'primary') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = dim * 0.5;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (frameState.pulseOn && n.pulse) {
        const t = (frameState.t % 2) / 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 6 + t * 16, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = dim * (1 - t) * 0.6;
        ctx.stroke();
      }
    } else {
      const s = r * 0.9;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();
      if (frameState.pulseOn && n.pulse) {
        const t = (frameState.t % 2) / 2;
        const g = r + t * 10;
        ctx.strokeStyle = color;
        ctx.globalAlpha = dim * (1 - t) * 0.6;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - g, y - g, g * 2, g * 2);
      }
    }

    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 10, 0, Math.PI * 2);
      ctx.strokeStyle = ink();
      ctx.globalAlpha = dim;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawLabel(n, alpha) {
    const { x, y } = pos(n);
    const dim = hoverDim(n.id);
    const r = radiusOf(n);
    const size = labelSize * (n.kind === 'primary' ? 1.15 : 1);
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = ink();
    ctx.globalAlpha = (n.kind === 'primary' ? 0.92 : 0.66) * alpha * dim;
    const sub = getSub(n);
    if (n.kind === 'primary') {
      ctx.fillText(String(n.label).toUpperCase(), x, y + r + 9);
      if (sub) {
        ctx.font = `500 ${size - 2.5}px ${MONO_FONT}`;
        ctx.globalAlpha = 0.5 * alpha * dim;
        ctx.fillText(sub, x, y + r + 9 + size + 4);
      }
    } else {
      ctx.fillText(String(n.label), x, y + r + 6);
    }
    ctx.globalAlpha = 1;
  }

  // ---- 浮动 + 尾迹（RAF 驱动） ----
  function tickFloat() {
    frameState.t += 0.016;
    if (frameState.floatAmp > 0) {
      for (const n of simNodes) {
        const ph = phase.get(n.id) ?? 0;
        n.rx = n.x + Math.sin(frameState.t * 0.8 + ph) * frameState.floatAmp;
        n.ry = n.y + Math.cos(frameState.t * 0.6 + ph * 1.3) * frameState.floatAmp;
      }
    } else {
      for (const n of simNodes) { n.rx = n.x; n.ry = n.y; }
    }
    if (frameState.trailOn && ++frame % TRAIL_EVERY === 0) {
      for (const n of simNodes) {
        let hist = trail.get(n.id);
        if (!hist) { hist = []; trail.set(n.id, hist); }
        hist.push({ x: n.rx, y: n.ry });
        if (hist.length > TRAIL_FRAMES) hist.shift();
      }
    }
  }

  let frame = 0;
  function loop() {
    if (destroyed || !visible || document.hidden || reduce) { raf = 0; return; }
    tickFloat();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function reheat(a = 1) {
    if (destroyed) return;
    sim.alpha(Math.max(sim.alpha(), a));
    if (reduce) {
      sim.stop();
      for (let step = 0; step < 160; step++) sim.tick();
      simNodes.forEach((node) => { node.rx = node.x; node.ry = node.y; });
      draw();
    } else if (visible && !document.hidden) sim.restart();
  }

  function activity() {
    if (destroyed) return;
    cancelAnimationFrame(raf); raf = 0; sim.stop();
    if (visible && !document.hidden) {
      if (reduce) reheat(0.1);
      else { sim.restart(); raf = requestAnimationFrame(loop); }
    }
  }
  function motionChanged() {
    reduce = motion.matches;
    frameState.floatAmp = reduce ? 0 : 4.5;
    frameState.trailOn = frameState.pulseOn = !reduce;
    trail.clear(); activity();
  }
  motion.addEventListener('change', motionChanged);
  document.addEventListener('visibilitychange', activity);
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; activity(); });
  io.observe(canvas);
  const themes = new MutationObserver(() => draw());
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  resize();
  activity();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (gestureView) {
        select(gestureView).on('mousemove.zoom mouseup.zoom', null);
        dragEnable(gestureView, false); gestureView = null;
      }
      const gesture = canvas.__zooming;
      if (gesture?.wheel) clearTimeout(gesture.wheel);
      delete canvas.__zooming;
      events.abort();
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect(); themes.disconnect();
      motion.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', activity);
      sim.stop();
      select(canvas).on('.zoom', null);
      zoomBeh.on('.lifecycle', null).on('zoom', null);
    },
    resetView() {
      transform = zoomIdentity;
      select(canvas).call(zoomBeh.transform, zoomIdentity);
    },
    reheat,
    selectNode(id) {
      if (destroyed || !byId.has(id)) return;
      selectedId = id;
      hoverId = id;
      neighborIds = new Set([id, ...neighborsOf(id)]);
      draw();
    },
    refresh() { draw(); },
  };
}
