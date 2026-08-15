import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const essays = defineCollection({
  // Content Layer：glob 读取本地 markdown，随笔落地 src/content/essays/
  loader: glob({ pattern: '**/*.md', base: './src/content/essays' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    slug: z.string().optional(),
    excerpt: z.string().optional(),
    source: z.string().optional(), // notion | 手写 | 其他
  }),
});

export const collections = { essays };
