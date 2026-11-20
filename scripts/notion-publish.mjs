import { args, isMain, run } from './lib/cli.mjs';
import { configuration, createPublisher } from './lib/notion-core.mjs';
export async function main(argv) {
  const options = args({ database: { type: 'string' }, page: { type: 'string' }, slug: { type: 'string' }, list: { type: 'boolean' }, all: { type: 'boolean' }, force: { type: 'boolean' }, commit: { type: 'boolean' }, 'published-only': { type: 'boolean' } }, argv);
  const publisher = createPublisher({ databaseId: options.database || configuration().database });
  if (options.list) console.log(await publisher.list({ publishedOnly: !!options['published-only'] }));
  else console.log(await publisher.publish({ pageIds: options.page ? [options.page] : undefined, all: !!options.all, overwrite: !!options.force, push: !!options.commit, slugOverride: options.slug }));
}
if (isMain(import.meta.url)) run(main);
