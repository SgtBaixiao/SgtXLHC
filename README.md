# SgtXLHC

[Agent Workspace](https://github.com/SgtBaixiao/SgtXLHC) 是 Astro 静态个人站：展示 Agent 状态、wayfinder 开发进度，并归档 Notion 随笔。页面保留纸墨配色、Canvas 星座图和节点详情抽屉。

## 本地开发与检查

使用 Node 22.12 及以上版本。依赖由 `package-lock.json` 锁定。

```bash
npm ci
npm run dev
npm run validate
npx playwright install chromium
npm run test:browser
```

`validate` 运行 Node 行为测试、Astro 检查和根路径构建。浏览器测试另外构建 `/SgtXLHC` 项目路径，覆盖桌面及移动布局。测试使用本地样本与临时 Git 仓库，无需 Notion 凭据，也不会推送到真实仓库。

```bash
npm run build:project
ASTRO_BASE=/SgtXLHC npm run preview
```

预览与构建需要相同的 base。站点元信息位于 `src/lib/site.ts`。部署时由工作流传入仓库路径、站点地址及公开状态源。

## 更新公开状态

```bash
npm run sync:status -- --agent pi --name pi --status working \
  --task "整理文章" --task-status in-progress --source manual
npm run sync:status -- --json-file /path/to/agent.json
npm run sync:status -- --agent pi --status idle --task "" --prune-hours 48
```

JSON 输入支持单个 Agent、数组和包含 agents 数组的对象。上报按标识合并，未提供的字段保留，较旧心跳不能覆盖较新记录。可选字段传入 `null` 会清除该字段；省略心跳则使用当前时间。公开字段的长度、状态枚举和时间都要通过校验，额外字段不会写入。公开文本仍由维护者负责筛选敏感内容。

状态文件损坏时命令失败并保留原文件。跨进程锁防止并发读改写丢失状态，临时文件经同步后原子替换。客户端有请求超时、大小限制、校验、备用源和失败退避；数据源暂不可达时保留最后有效视图。

`--push` 会提交并推送状态文件。它要求目标文件无本地改动、暂存区为空，且当前分支与远端一致。它会拒绝带入其他文件或未推送提交。纯状态更新继续跳过 Pages 重建。

## 生成进度图

```bash
npm run progress -- --scratch /path/to/.scratch
```

默认读取仓库父目录的 `.scratch`，也可设置 `SCRATCH_DIR`。每个 effort 包含 `map.md` 和 `issues/NN-name.md`。支持数字依赖 `Blocked by: 01, 02`，以及 `Blocked by: [First](issues/01-first.md)`。空依赖可写 `none`。

输出保持 schema 1.0；目录和 ticket 顺序确定。重复标识、无效状态、缺失依赖、循环依赖及超限图都会报错，旧输出保持原状。当前预算为 50 个 effort、每个最多 1000 个 ticket、合计最多 1500 个节点与 5000 条边；这些是输入限制，实际设备性能仍需实测。

## 发布 Notion 随笔

Notion integration 需要能够读取指定数据库及其页面。数据库属性默认映射如下，可在 `scripts/lib/notion-core.mjs` 修改。

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| Name | title | 标题 |
| 日期 | date | 必填有效日期 |
| Tags | multi_select | 标签 |
| 摘要 | rich_text | 摘要 |
| Published | checkbox | 发布资格 |
| Slug | rich_text | 可选 URL 标识 |

把 `NOTION_TOKEN` 与 `NOTION_DATABASE` 放在环境变量或被 Git 忽略的 `.env.local`。凭据只供本地 Node 进程访问 Notion，不能放进 public、文章或浏览器脚本。

```bash
npm run notion:list -- --database <database_id>
npm run notion:publish -- --database <database_id> --page <page_id>
npm run notion:publish -- --database <database_id> --all
npm run notion:publish -- --database <database_id> --page <page_id> --force
npm run bridge -- --database <database_id>
```

本地桥默认地址为 `http://127.0.0.1:4174`，可用 `--port` 修改端口。它校验 Host、Origin 与会话请求令牌，限制请求体和并发发布。草稿显示在列表中，不能选择发布；标题和标签通过文本节点显示。覆盖与提交推送默认关闭。

CLI 与网页共用发布模块。列表在预算内完整读取数据库分页，长标题属性继续分页；数据库与每项属性最多 100 次分页请求，空分页也计数。Markdown 转换使用锁定的 notion-to-md，最多调用 1000 次 block 读取、读取 10000 个 block。表格需要重复读取的分页使用缓存，返回独立副本；游标循环会报错，缓存读取也计入调用预算。每篇文章在转换前后校验数据库归属、Published 资格和页面修订。每批限 100 篇，整批准备与冲突检查完成后才写入文章。

文章以规范化 Notion 页面标识记录源身份。同一文章改标题或日期时继续使用原文件和原 URL；内容变化默认跳过，`--force` 才会覆盖同源文件。显式 `--slug` 可修改单篇 URL。其他来源和手写文章的文件或 URL 冲突始终报错，软链接及重复源文件也会报错。旧文章如已存在重复源身份，需先由维护者确认保留哪一份。

`--commit` 显式提交并推送本次目标文章。Git 参数通过数组传递，已有暂存内容、目标文件的本地编辑以及本地和远端历史差异都会导致操作中止。无关未暂存文件保持原样，不进入提交。内容不变时不创建提交。

## 失败后如何恢复

| 失败 | 保留状态 | 处理 |
| --- | --- | --- |
| 校验或冲突 | 原文章不变 | 修正数据或消除冲突后重试 |
| 文件写入失败 | 错误报告列出已确认写入文件及失败阶段 | 检查文章后重试；同源相同内容会成为无变化结果 |
| Git 提交失败 | 本地文章保留，暂存区可能有本次文件 | 检查 Git 状态，处理后再决定提交 |
| 推送失败或结果未知 | 提交保留 | 先检查远端与本地提交，再自行重试推送 |
| 进程中断遗留锁 | owner.json 记录原进程 | 确认原进程及其工作均已结束，备份产物后清理锁目录 |

发布锁为 `.site-publisher.lock`，状态锁为 `public/live/status.json.lock`，进度锁为 `public/progress.json.lock`，Git 发布锁位于实际 Git 目录中的 `site-publication.lock`。系统不会按时间自动抢占锁。维护者应在恢复期间停止其他写入。

每个文件原子替换，整批文件与 Git 网络操作不能共用一个原子事务。推送失败后不会自动推送，也不会自动覆盖人工改动。

## 部署与维护

PR 检查在 Node 22 和 24 上运行。桌面和移动浏览器检查使用 Chromium，失败保留 trace。主分支部署前运行行为测试和 Astro 检查，Pages 写入权限只给部署任务。此流程保留单次 Pages 产物上传。

模块边界与取舍见 [架构说明](docs/architecture.md)，变更约束见 [验收规格](docs/engineering-spec.md)，贡献流程见 [CONTRIBUTING](CONTRIBUTING.md)。没有真实 Notion 凭据参与自动化测试；首次实际发布前仍应使用一篇测试文章检查 integration 权限及数据库字段映射。

新增维护依赖各有具体用途：`@astrojs/check` 检查 Astro 类型，`@playwright/test` 驱动浏览器回归，`esbuild` 在测试中独立打包图形模块，`yaml` 解析现有文章 frontmatter，`d3-drag` 在销毁活动拖拽时恢复浏览器选择状态。版本均由锁文件固定。
