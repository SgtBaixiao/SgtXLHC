/**
 * 随笔条目 URL slug 解析
 *
 * Astro 5 Content Layer 的 glob loader 不再给 entry 顶层 slug：
 * - e.id   = 相对 base 的文件名（去扩展名），如 `2026-08-15-hello-workspace`
 * - e.data.slug = frontmatter 里的 slug 字段（Notion 管道写入）
 * URL 用 data.slug 优先（发布桥显式指定的值），回退文件名（去日期前缀）。
 */
import type { CollectionEntry } from 'astro:content';

export function entrySlug(e: CollectionEntry<'essays'>): string {
  if (e.data.slug) {
    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(e.data.slug)) throw new Error(`Invalid essay slug: ${e.id}`);
    return e.data.slug;
  }
  const id = e.id.replace(/\.md$/, '');
  return id.replace(/^\d{4}-\d{2}-\d{2}-/, '') || id;
}

export function assertUniqueEssayUrls(entries: CollectionEntry<'essays'>[]) {
  const urls = new Set<string>();
  for (const entry of entries) {
    const url = entrySlug(entry).normalize('NFC').toLowerCase();
    if (urls.has(url)) throw new Error(`Duplicate essay URL: ${url}`);
    urls.add(url);
  }
}
