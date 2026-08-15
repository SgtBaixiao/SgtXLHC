/** 站点元信息 —— 命名在「站点命名与身份」ticket 中定，此处用工作名 */
export const SITE = {
  title: 'Agent Workspace',
  tagline: 'Claude · pi · Codex — 工作状态与开发进度的实时图谱',
  description:
    '个人网站：agent 工作状态实时图、wayfinder 开发进度图、Notion 随笔归档。GitHub Pages 免费部署，Astro + d3-force。',
  author: 'Workspace',
  // 部署时由流水线注入 SITE_URL（如 https://<owner>.github.io/<repo>）；本地回退占位
  url: (import.meta.env.SITE_URL as string) || 'https://agent-workspace.example',
};

const rawBase = import.meta.env.BASE_URL || '/';
export const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`; // 保证结尾带 '/'
