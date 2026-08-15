# Agent Workspace

个人网站：**Agent 工作状态实时图** + **wayfinder 开发进度图** + **Notion 随笔归档**。

- 风格：The AI Coding Dictionary 硬朗「纸面 + 星座」设计语言
- 部署：GitHub Pages 免费部署（`withastro/action` → `actions/deploy-pages`）
- 技术栈：Astro 5 静态输出 · Content Layer glob · 客户端 d3-force 图岛 · @notionhq/client + notion-to-md

```
├─ src/
│  ├─ components/        # AgentGraph / ProgressGraph（Canvas + d3-force）
│  ├─ content/essays/    # 随笔 markdown（Notion 发布桥落盘）
│  ├─ layouts/ pages/    # 页面与布局
│  └─ styles/global.css  # AICD 硬朗设计 token
├─ scripts/              # 三条数据管道
│  ├─ sync-status.mjs      # agent 状态 → public/live/status.json（原子写 + 可选 push）
│  ├─ generate-progress.mjs# wayfinder 决策图 → public/progress.json
│  ├─ notion-publish.mjs   # Notion → markdown → essays
│  ├─ publish-bridge.mjs   # 本地发布桥（网页内勾选 Notion 文章）
│  └─ lib/notion-core.mjs  # Notion 共享核心
└─ public/
   ├─ live/status.json   # 公开状态（无密钥）
   └─ progress.json      # 进度图数据
```

---

## 首次部署（一次性操作清单）

需要你的 GitHub 账号操作，按顺序执行：

1. **创建仓库**
   在 GitHub 新建一个仓库（建议同名 `personal-site`，Public）。不勾选 README/gitignore（本目录已是完整项目）。

2. **关联并推送**
   ```bash
   cd personal-site
   git init
   git add .
   git commit -m "feat: personal site initial"
   git branch -M main
   git remote add origin git@github.com:<你的用户名>/personal-site.git
   git push -u origin main
   ```

3. **开启 Pages → GitHub Actions**
   Settings → Pages → Source 选 **GitHub Actions**。流水线会在下次推送时自动跑（`deploy.yml`）。

4. **配置 Secrets**（Settings → Secrets and variables → Actions）
   - `NOTION_TOKEN`：你的 Notion integration 的 `ntn_` PAT（最小权限「Read content」，**1 年有效——请设续期提醒**）。仅 CI/本地用；公开仓库永不出现。
   - 其余环境（`ASTRO_BASE` / `SITE_URL` / `PUBLIC_GITHUB_REPO`）由流水线自动注入，**不需要手动配置**。

5. **验证部署**
   首次 Actions run 完成后访问 `https://<你的用户名>.github.io/personal-site/`。首页应显示状态图（两节点：Claude 工作中 / pi 待命）与最近随笔。

> 若仓库名不是 `personal-site`：`ASTRO_BASE` 已按仓库名注入，无需改代码。

---

## Agent 状态上报（Stop hook）

Claude Code 会话结束时由 **Stop hook** 调用：

```jsonc
// ~/.claude/settings.json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd /path/to/personal-site && node scripts/sync-status.mjs --agent claude --name Claude --status working --task \"<当前任务>\" --task-status in-progress --push"
          }
        ]
      }
    ]
  }
}
```

- 每次会话结束覆盖写入 `public/live/status.json` 并推送；`deploy.yml` 已 `paths-ignore: public/live/**`，**状态推送不触发重建**，仅刷新 raw 数据源。
- 首页客户端每约 90s 轮询 `raw.githubusercontent.com/<repo>/main/public/live/status.json`（5 分钟缓存地板，匿名限速 ~60/hr，勿加自定义头）。
- pi / Codex 按同一契约接入：任意 CLI 工具调用 `sync-status.mjs` 即可。

## 进度图更新

```bash
npm run progress   # 从 .scratch/<effort>/ 生成 public/progress.json（内容变更，推送触发构建）
```

## Notion 随笔

```bash
# 列出数据库文章
NOTION_TOKEN=ntn_... npm run notion:list -- --database <db_id> [--published-only]

# 发布单篇 / 全部
NOTION_TOKEN=ntn_... npm run notion:publish -- --database <db_id> --page <page_id> [--commit]
NOTION_TOKEN=ntn_... npm run notion:publish -- --database <db_id> --all [--commit]
```

**网页内自选上传**（本地发布桥，AICD 风格 UI）：

```bash
NOTION_TOKEN=ntn_... npm run bridge -- --database <db_id>
# 打开 http://localhost:4174 → 勾选文章 → 发布（自动落盘 + 提交推送）
```

安全边界：token 只在本机（env 或 gitignored `.env.local`），不进仓库、不进 `public/`。

## 本地开发

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # 静态产物 → dist/
npm run preview   # 本地预览构建产物
```
