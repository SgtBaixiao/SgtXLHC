const $ = (id) => document.getElementById(id);
let token = '', busy = false;
const selected = () => [...document.querySelectorAll('#list input:checked')].map((input) => input.value);
function sync() { $('publish').disabled = busy || !selected().length; }
function log(message) { $('log').style.display = 'block'; $('log').textContent += `${message}\n`; }
async function load() {
  try {
    const response = await fetch('/api/pages', { headers: { 'x-site-token': token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $('list').replaceChildren();
    for (const page of data.pages) {
      const label = document.createElement('label'); label.className = 'item';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = page.id; input.disabled = !page.published;
      const title = document.createElement('div'); title.className = 't'; title.textContent = page.title;
      const info = document.createElement('div'); info.className = 'm'; info.textContent = `${(page.date || '').slice(0, 10)} · ${page.tags.join(' / ')}`;
      const description = document.createElement('div'); description.append(title, info);
      const state = document.createElement('span'); state.textContent = page.published ? '可发布' : '草稿';
      label.append(input, description, state); $('list').append(label);
    }
    $('count').textContent = `${data.pages.length} 篇文章`;
    sync();
  } catch (error) { $('list').textContent = `加载失败：${error.message}`; }
}
$('list').addEventListener('change', sync);
$('all').onclick = () => { document.querySelectorAll('#list input:not(:disabled)').forEach((input) => input.checked = true); sync(); };
$('none').onclick = () => { document.querySelectorAll('#list input').forEach((input) => input.checked = false); sync(); };
$('publish').onclick = async () => {
  busy = true; sync(); $('log').textContent = '';
  try {
    const response = await fetch('/api/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-token': token }, body: JSON.stringify({ page_ids: selected(), force: $('overwrite').checked, commit: $('push').checked }) });
    const data = await response.json();
    if (!response.ok) {
      for (const result of data.results || []) if (result.written) log(`${result.title}：已保留本地文件 ${result.file}`);
      if (data.phase) log(`失败阶段：${data.phase}`);
      throw new Error(data.error);
    }
    for (const result of data.results) log(`${result.title}：${result.skipped ? '已存在，跳过' : result.unchanged ? '内容未变' : '已写入本地'}`);
    log(data.pushed ? `已推送：${data.commit}` : '本次保存完成');
  } catch (error) { log(`发布失败：${error.message}`); }
  finally { busy = false; sync(); }
};
try {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('会话不可用');
  token = (await response.json()).token;
  await load();
} catch (error) { log(error.message); }
