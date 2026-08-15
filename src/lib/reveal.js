/**
 * 逐词 reveal：把标记了 [data-reveal] 的纯文本元素拆成单词，
 * 每个单词带 --i 索引，配合 CSS 的 52ms 级联进入。
 * 只用于纯文本的标题/引语，绝不用于含嵌套标签的正文。
 * reduced-motion 时整段直接可见（CSS 兜底，这里直接跳过拆分）。
 */
export function initReveal(root = document) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const els = root.querySelectorAll('[data-reveal]');
  for (const el of els) {
    if (el.dataset.revealDone) continue;
    el.dataset.revealDone = '1';
    // 仅当元素是纯文本（无子元素）时才拆分，否则保留原样由 CSS 整块进入
    if (el.children.length > 0) continue;

    const words = el.textContent.trim().split(/\s+/);
    if (words.length < 2) continue;

    el.textContent = '';
    const frag = document.createDocumentFragment();
    words.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'rv-word';
      span.style.setProperty('--i', String(i));
      span.textContent = w + ' ';
      frag.appendChild(span);
    });
    el.appendChild(frag);
  }
}

/** 页面加载后触发 */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initReveal());
  } else {
    initReveal();
  }
}
