import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
if (!files.length) throw new Error('No tests found.');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status || (result.error ? 1 : 0));
