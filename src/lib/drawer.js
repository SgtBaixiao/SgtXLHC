/** 右侧抽屉：.drawer-shell 加类切换 grid 列（1fr → 1fr auto），非覆盖式让位 */
export function bindDrawer(shell, aside, { onOpen, onClose } = {}) {
  const closeBtn = aside.querySelector('[data-drawer-close]');

  function open() {
    shell.classList.add('drawer-open');
    onOpen && onOpen();
  }
  function close() {
    shell.classList.remove('drawer-open');
    onClose && onClose();
  }
  closeBtn && closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shell.classList.contains('drawer-open')) close();
  });
  return { open, close };
}

/** 空状态：清空抽屉并关闭 */
export function closeDrawer(shell, aside) {
  shell.classList.remove('drawer-open');
  aside.innerHTML = '';
}
