---
title: 站点上线：从 wayfinder 决策图到真实部署
date: "2026-08-15"
tags: ["发布", "站点", "随笔"]
draft: false
slug: hello-workspace
excerpt: 第一条随笔。记录这个站点是什么、它从哪里来，以及三条数据管道如何把「实时状态 / 决策进度 / Notion 归档」喂给一张静态网页。
source: 手写样例
---

## 这个站点是什么

一份托管在 GitHub Pages 上的个人网站，按 **The AI Coding Dictionary** 的「冷峻纸面 + 漂浮星座」硬朗风格设计：纸面/墨色双主色、mono 元信息、流体排版、克制而清晰的硬边界。

首页把三件相互独立的事收进一张图：

1. **Agent 实时工作状态** —— Claude、pi（后续 Codex）会话结束/停止时，Stop hook 把状态写进 `status.json` 并推送；浏览器每约 90s 轮询 raw.githubusercontent.com 刷新，节点按 `idle / working / blocked / error` 着色、按任务态脉冲。
2. **开发进度图** —— `/progress` 直读 wayfinder 的本地决策图谱：effort 是项目节点、ticket 是任务节点、`Blocked by` 是连线、`Status` 是颜色。决策只产生于具体 ticket，地图只索引、不复述。
3. **Notion 随笔归档** —— 通过本地「发布桥」在网页里勾选 Notion 文章，转 Markdown 后落盘 `src/content/essays/`，提交即触发构建。token 只留在本地进程，绝不进公开仓库。

## 三条数据管道的共同契约

三条管道都遵守同一条安全红线：**公开仓库里没有密钥**。

- 状态：`public/live/status.json` 全公开，但只含 agent 名、状态、任务名这类展示数据；写入由 `scripts/sync-status.mjs` 原子完成，推送走 `paths-ignore` 不触发重建。
- 进度：`scripts/generate-progress.mjs` 从 `.scratch/<effort>/` 解析 map.md 与 issues 生成 `progress.json`，属于内容变更，随构建发布。
- 随笔：`NOTION_TOKEN` 只来自本地环境变量或 gitignored 的 `.env.local`；转换链 `@notionhq/client` + `notion-to-md`，标题/日期/标签/摘要/发布标记从数据库属性直读。

## 发布方式

每次推送 `main` 分支，`withastro/action` 构建、`actions/deploy-pages` 部署。这里就是第一个被这样发布出来的站点。
