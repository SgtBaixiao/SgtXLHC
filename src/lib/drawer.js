/** 右侧抽屉：.drawer-shell 加类切换 grid 列（1fr → 1fr auto），非覆盖式让位 */
export function bindDrawer(shell, aside, { onOpen, onClose } = {}) {
  const closeBtn = aside.querySelector('[data-drawer-close]');
  const body = aside.querySelector('.drawer__body');

  function open() {
    shell.classList.add('drawer-open');
    aside.inert = false;
    onOpen && onOpen();
  }
  function close() {
    shell.classList.remove('drawer-open');
    aside.inert = true;
    onClose && onClose();
  }
  closeBtn && closeBtn.addEventListener('click', close);
  const keydown = (e) => {
    if (e.key === 'Escape' && shell.classList.contains('drawer-open')) close();
  };
  document.addEventListener('keydown', keydown);
  aside.inert = true;
  return { open, close, render(html) { body.innerHTML = html; }, destroy() { close(); closeBtn?.removeEventListener('click', close); document.removeEventListener('keydown', keydown); } };
}

/** 空状态：清空抽屉并关闭 */
export function closeDrawer(shell, aside) {
  shell.classList.remove('drawer-open');
  aside.innerHTML = '';
}
