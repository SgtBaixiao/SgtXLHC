/**
 * 本地发布桥（13-publish-in-page-select）
 *
 * 在用户机器上跑一个小型本地服务：浏览器里浏览 Notion 文章库、勾选要发布的
 * 文章、触发「转 Markdown → 落盘 essays → 提交推送」。同款 AICD 硬朗设计语言。
 *
 * 为什么是本地：公开 GitHub Pages 无法安全持有 Notion token（13 号票否决了
 * 公开站直连），token 只在本进程内存里（env / gitignored .env.local），
 * 绝不写盘、绝不进 public/。
 *
 * 用法：
 *   NOTION_TOKEN=... npm run publish:bridge -- --database <db_id>
 *   然后浏览器打开 http://localhost:4174
 *   可选 --port <N>（默认 4174）
 *
 * 契约：
 *   GET  /            → AICD 风格选择页
 *   GET  /api/pages   → { ok, pages:[{id,title,date,tags,published,slug}] }
 *   POST /api/publish → body { page_ids:[], force?, commit? }
 *                     → { ok, results:[{file|skipped|error}], pushed? }
 */
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDatabase, writeEssay, ROOT } from './lib/notion-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = process.argv.slice(2);
const arg = (flag) => { const i = CLI.indexOf(flag); return i >= 0 ? CLI[i + 1] : undefined; };

const PORT = Number(arg('--port') || process.env.PORT || 4174);
const DB_ID = arg('--database') || process.env.NOTION_DATABASE;
if (!DB_ID) {
  console.error('[bridge] 需要 --database <db_id>（Notion 数据库 URL 中取）或设 NOTION_DATABASE');
  process.exit(1);
}

const isGitRepo = (() => {
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
})();

// ---- 请求工具 ----
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const readBody = (req) => new Promise((resolveBody, rejectBody) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e6) rejectBody(new Error('body 过大')); });
  req.on('end', () => { try { resolveBody(JSON.parse(data || '{}')); } catch { rejectBody(new Error('JSON 解析失败')); } });
  req.on('error', rejectBody);
});

// ---- 页面 ----
const PAGE = (() => {
  const s = String.raw;
  return s`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publish Bridge · AGENT·WORKSPACE</title>
<style>
:root{
  --paper:#f2efe8; --paper-dim:#e8e4da; --ink:#1a1a18; --ink-soft:#5c5a52;
  --ink-faint:#9a968a; --hairline:#c9c4b8; --accent:#c8412b; --ok:#3d6b35;
  --serif:Georgia,'Times New Roman','Songti SC','SimSun',serif;
  --mono:'SFMono-Regular',ui-monospace,'Cascadia Mono',Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html{color-scheme:light}
body{background:var(--paper);color:var(--ink);font-family:var(--serif);
  line-height:1.65;-webkit-font-smoothing:antialiased;padding-bottom:6rem}
.mono{font-family:var(--mono)}
.top{border-bottom:1px solid var(--ink);padding:1.1rem 1.4rem;display:flex;
  justify-content:space-between;align-items:baseline;gap:1rem}
.brand{font-family:var(--mono);font-weight:700;letter-spacing:.04em;font-size:.85rem}
.brand b{color:var(--accent)}
.warn{font-family:var(--mono);font-size:.72rem;color:var(--ink-soft);letter-spacing:.02em}
.wrap{max-width:46rem;margin:0 auto;padding:0 1.4rem}
.head{padding:3.2rem 1.4rem 1.6rem}
.head h1{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:600;letter-spacing:-.01em;line-height:1.1}
.head .kicker{font-family:var(--mono);font-size:.75rem;color:var(--ink-faint);
  letter-spacing:.14em;margin-bottom:.7rem}
.head p.sub{color:var(--ink-soft);max-width:34rem;margin-top:.8rem;font-size:.95rem}
.count{font-family:var(--mono);font-size:.75rem;color:var(--ink-faint);letter-spacing:.08em}
.actions{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:1.4rem 0 1rem}
.actions .spacer{flex:1}
button{font-family:var(--mono);font-size:.76rem;letter-spacing:.05em;border:1px solid var(--ink);
  background:transparent;color:var(--ink);padding:.5rem 1rem;cursor:pointer;transition:
  background .18s var(--ease,linear);border-radius:0}
button:hover{background:var(--ink);color:var(--paper)}
button.primary{background:var(--ink);color:var(--paper)}
button.primary:hover{background:var(--accent);border-color:var(--accent)}
button[disabled]{opacity:.35;cursor:not-allowed}
button[disabled]:hover{background:var(--ink);color:var(--paper)}
.list{border-top:1px solid var(--ink)}
.item{display:grid;grid-template-columns:auto 1fr auto;gap:1rem;align-items:center;
  padding:1.05rem 0;border-bottom:1px solid var(--hairline)}
.item:hover{background:var(--paper-dim)}
.item input[type=checkbox]{width:1.15rem;height:1.15rem;accent-color:var(--accent);cursor:pointer}
.item .t{font-weight:600;font-size:1.02rem;line-height:1.35}
.item .m{font-family:var(--mono);font-size:.7rem;color:var(--ink-faint);letter-spacing:.06em;
  margin-top:.2rem}
.item .tag{font-family:var(--mono);font-size:.68rem;color:var(--accent);border:1px solid
  var(--hairline);padding:.15rem .45rem;margin-left:.35rem}
.item .st{font-family:var(--mono);font-size:.7rem;color:var(--ink-faint);letter-spacing:.06em}
.empty{color:var(--ink-soft);padding:3rem 0;font-family:var(--mono);font-size:.8rem}
.err{color:var(--accent);font-family:var(--mono);font-size:.8rem;margin:.6rem 0;display:none}
.log{font-family:var(--mono);font-size:.72rem;color:var(--ink-soft);white-space:pre-wrap;
  margin-top:1rem;max-height:14rem;overflow:auto;display:none;border-top:1px dashed var(--hairline);
  padding-top:.9rem}
.log b{color:var(--ok)}
.foot{margin-top:3rem;border-top:1px solid var(--hairline);padding-top:1rem;display:flex;
  justify-content:space-between;font-family:var(--mono);font-size:.7rem;color:var(--ink-faint)}
</style>
</head>
<body>
<header class="top">
  <div class="brand">AGENT·WORKSPACE <b>PUBLISH BRIDGE</b></div>
  <div class="warn">本地进程 · token 不离开此机器</div>
</header>
<section class="head">
  <div class="kicker mono">NOTION / IN-PAGE SELECT</div>
  <h1>选择要发布到站点的文章</h1>
  <p class="sub">下方列出 Notion 数据库中的文章。勾选后点「发布」——每篇会被转成
  Markdown，落盘 <span class="mono">src/content/essays/</span>，并（可选）提交推送触发构建。</p>
</section>
<main class="wrap">
  <div class="actions">
    <span class="count mono" id="count">— 篇文章</span>
    <span class="spacer"></span>
    <button data-act="all" id="btn-all" disabled>全选</button>
    <button data-act="none" id="btn-none" disabled>清空</button>
    <button id="btn-publish" class="primary" disabled>发布所选</button>
  </div>
  <div class="err" id="err"></div>
  <div class="list" id="list"><div class="empty mono">读取中…</div></div>
  <div class="log" id="log"></div>
  <footer class="foot">
    <span>publish-bridge.mjs</span><span>schema: 1.0</span>
  </footer>
</main>
<script>
const $ = (id) => document.getElementById(id);
let pages = [];
const log = (s, ok) => {
  const el = $('log'); el.style.display = 'block';
  el.insertAdjacentHTML('beforeend', (ok?'<b>✓ ':'✗ ') + s.replace(/</g,'&lt;') + '<br>');
  el.scrollTop = el.scrollHeight;
};
async function load(){
  try{
    const r = await fetch('/api/pages'); const j = await r.json();
    if(!j.ok) throw new Error(j.error||'加载失败');
    pages = j.pages; render();
  }catch(e){ $('list').innerHTML = '<div class="empty mono">加载失败：'+e.message+'</div>'; }
}
function render(){
  const list = $('list');
  const selected = [...document.querySelectorAll('.item input:checked')].map(i=>i.dataset.id);
  list.innerHTML = pages.length ? pages.map(p=>\`
    <label class="item">
      <input type="checkbox" data-id="\${p.id}" \${selected.includes(p.id)?'checked':''}>
      <div><div class="t">\${p.title}</div>
        <div class="m">\${(p.date||'').slice(0,10)} · \${p.tags.map(t=>'<span class="tag">'+t+'</span>').join('')}</div></div>
      <span class="st">\${p.published?'已勾选发布':'草稿'}</span>
    </label>\`).join('') : '<div class="empty mono">数据库里没有文章</div>';
  syncBtns();
}
function syncBtns(){
  const n = [...document.querySelectorAll('.item input:checked')].length;
  $('count').textContent = pages.length + ' 篇 · 已选 ' + n + ' 篇';
  $('btn-publish').disabled = n === 0;
  $('btn-all').disabled = pages.length === 0;
  $('btn-none').disabled = pages.length === 0;
}
$('list').addEventListener('change', (e)=>{ if(e.target.matches('input[type=checkbox]')) syncBtns(); });
$('btn-all').onclick = ()=> { document.querySelectorAll('.item input').forEach(i=>i.checked=true); syncBtns(); };
$('btn-none').onclick = ()=> { document.querySelectorAll('.item input').forEach(i=>i.checked=false); syncBtns(); };
$('btn-publish').onclick = async ()=>{
  const ids = [...document.querySelectorAll('.item input:checked')].map(i=>i.dataset.id);
  if(!ids.length) return;
  $('btn-publish').disabled = true; $('err').style.display='none'; $('log').innerHTML='';
  try{
    const r = await fetch('/api/publish', { method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ page_ids: ids, commit: true, force: true }) });
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'发布失败');
    for(const res of j.results){
      if(res.error) log(res.title+' → '+res.error);
      else if(res.skipped) log(res.title+' → 已存在，跳过');
      else log(res.title+' → '+res.file);
    }
    if(j.pushed) log('已提交并推送，将触发站点构建', true);
    else log('未推送（非 git 仓库或推送失败）');
  }catch(e){ $('err').textContent = '发布失败：'+e.message; $('err').style.display='block'; }
  finally{ $('btn-publish').disabled = false; load(); }
};
load();
</script>
</body>
</html>`;
})();

const routes = {
  'GET /api/pages': async () => {
    const pages = await listDatabase(DB_ID);
    return { ok: true, pages };
  },
  'POST /api/publish': async (body) => {
    if (!Array.isArray(body.page_ids)) throw new Error('需要 page_ids 数组');
    const results = [];
    for (const id of body.page_ids) {
      try {
        const out = await writeEssay(id, { force: !!body.force, slugOverride: body.slugOverride });
        results.push({ id, title: out.title, file: out.file, skipped: out.skipped || false });
      } catch (e) {
        results.push({ id, error: e.message, title: id });
      }
    }
    let pushed = false;
    if (body.commit !== false && isGitRepo && results.some((r) => !r.skipped && !r.error)) {
      try {
        execSync('git add src/content/essays', { cwd: ROOT });
        execSync('git commit -m "essays: publish via bridge"', { cwd: ROOT, stdio: 'pipe' });
        execSync('git push', { cwd: ROOT, stdio: 'pipe' });
        pushed = true;
      } catch (e) {
        results.push({ error: '提交/推送失败：' + e.message, title: 'git' });
      }
    }
    return { ok: true, results, pushed };
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json(res, 404, { ok: false, error: 'not found' });
    if (req.method === 'POST') req.body = await readBody(req);
    const out = await handler(req.body || {});
    return json(res, 200, out);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[bridge] 发布桥已启动 → http://localhost:${PORT}`);
  console.log(`[bridge] 数据库: ${DB_ID.slice(0, 8)}… · git 仓库: ${isGitRepo ? '是' : '否'}`);
  console.log('[bridge] Ctrl+C 退出');
});
