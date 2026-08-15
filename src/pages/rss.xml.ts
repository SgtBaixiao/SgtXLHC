import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../lib/site';
import { base } from '../lib/site';
import { entrySlug } from '../lib/essays';

export async function GET(context: APIContext) {
  const essays = (await getCollection('essays'))
    .filter((e) => !e.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const items = essays.map((e) => {
    const link = new URL(`${base}essays/${entrySlug(e)}/`, SITE.url).toString();
    return {
      title: e.data.title,
      pubDate: e.data.date,
      description: e.data.excerpt || '',
      link,
      customData: e.data.tags?.length ? e.data.tags.map((t) => `<category>${t}</category>`).join('') : '',
    };
  });

  return rss({
    title: `${SITE.title} — 随笔`,
    description: SITE.description,
    site: context.site || SITE.url,
    items,
    customData: `<language>zh-CN</language>`,
  });
}
