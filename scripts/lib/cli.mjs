import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const isMain = (url) => !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
export function args(options, argv = process.argv.slice(2)) { return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values; }
export function run(main) {
  main().catch((error) => {
    console.error(error.message);
    if (error.results) console.error(JSON.stringify({ phase: error.phase, state: error.state, results: error.results, commit: error.commit }, null, 2));
    process.exitCode = 1;
  });
}
