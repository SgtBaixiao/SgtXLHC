/** Native buttons provide a readable alternative to Canvas hit testing. */
export function mountNodeList(parent, nodes, onSelect) {
  const details = document.createElement('details');
  details.className = 'graph-list';
  const summary = document.createElement('summary');
  summary.textContent = `节点列表（${nodes.length}）`;
  const list = document.createElement('ul');
  for (const node of nodes) {
    const row = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = `${node.label}${node.sub ? ` · ${node.sub}` : ''}`;
    button.addEventListener('click', () => onSelect(node));
    row.append(button); list.append(row);
  }
  details.append(summary, list); parent.append(details);
  return { destroy: () => details.remove() };
}
