import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages 项目站点需 base 匹配仓库名，例如仓库为 personal-site → base: '/personal-site/'
// 部署流水线里用 ASTRO_BASE 注入；本地 dev/preview 用根路径。
const base = process.env.ASTRO_BASE || '/';

export default defineConfig({
  site: process.env.SITE_URL || 'https://agent-workspace.example',
  base,
  // Existing Pages links use both directory forms; preview must accept both too.
  trailingSlash: 'ignore',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
    assets: 'assets',
  },
  integrations: [sitemap()],
});
