/**
 * Every path in `exports` must exist in dist/.
 *
 * Declaring a subpath before the build emits it produces a package that
 * installs fine and explodes on import, and npm has no way to take it back —
 * you can only publish another version. Cheap to check, expensive to miss.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const declared = [];
for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  if (typeof entry === 'string') {
    declared.push([subpath, entry]);
    continue;
  }
  for (const condition of Object.values(entry)) {
    for (const target of Object.values(condition)) declared.push([subpath, target]);
  }
}

const missing = declared.filter(([, target]) => !existsSync(new URL(`../${target}`, import.meta.url)));

for (const [subpath, target] of declared) {
  console.log(`${missing.some(([, t]) => t === target) ? '✗' : '✓'} ${subpath} → ${target}`);
}

if (missing.length > 0) {
  console.error(`\n${missing.length} export target(s) missing from the build.`);
  process.exit(1);
}

console.log(`\n${declared.length} export targets, all present.`);
