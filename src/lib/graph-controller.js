import { createGraph } from './graph.js';
import { bindDrawer } from './drawer.js';
import { mountNodeList } from './node-list.js';
import { startPolling, fetchFirst } from './transport.js';

/** Owns the shared lifetime of both real graph callers. */
export function mountGraph({ canvasSelector, metaSelector, sources, validate, buildGraph, renderDetails, summary, emptyMessage, ariaLabel }) {
  const canvas = document.querySelector(canvasSelector);
  if (!canvas) return;
  const shell = canvas.closest('[data-graph-shell]');
  const aside = shell.querySelector('[data-graph-drawer]');
  const empty = shell.querySelector('[data-graph-empty]');
  const meta = document.querySelector(metaSelector);
  const drawer = bindDrawer(shell, aside);
  let graph = null, nodeList = null;
  function selectNode(node) {
    if (!node) { drawer.close(); return; }
    drawer.render(renderDetails(node)); drawer.open(); graph?.selectNode(node.id);
  }
  function showEmpty(show) { if (empty) { empty.hidden = !show; empty.style.display = show ? 'grid' : 'none'; } }
  function render(value) {
    const data = buildGraph(value);
    graph?.destroy(); graph = null;
    nodeList?.destroy(); drawer.close();
    nodeList = mountNodeList(shell.parentElement, data.nodes, selectNode);
    showEmpty(!data.nodes.length);
    if (data.nodes.length) graph = createGraph(canvas, { data, ariaLabel, onSelect: selectNode });
    if (meta) meta.textContent = data.nodes.length ? summary(value) : emptyMessage;
  }
  const stop = startPolling(
    ({ signal }) => fetchFirst(sources(), { signal, validate }),
    (value, error) => {
      if (error) {
        if (meta) meta.textContent = '数据源暂不可达，保留最后有效数据';
        if (!graph) showEmpty(true);
      } else render(value);
    },
    { immediate: true },
  );
  const destroy = () => { stop(); graph?.destroy(); nodeList?.destroy(); drawer.destroy(); window.removeEventListener('pagehide', destroy); };
  window.addEventListener('pagehide', destroy, { once: true });
  return { destroy };
}
