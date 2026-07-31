/**
 * Every path in `exports` and `bin` must exist in dist/, and every bin must be
 * executable.
 *
 * Declaring either before the build emits it produces a package that installs
 * fine and explodes on use, and npm has no way to take it back — you can only
 * publish another version. Cheap to check, expensive to miss.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const resolve = (target) => new URL(`../${target}`, import.meta.url);

const declared = [];
for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  if (typeof entry === 'string') {
    declared.push(['exports', subpath, entry]);
    continue;
  }
  for (const condition of Object.values(entry)) {
    for (const target of Object.values(condition)) declared.push(['exports', subpath, target]);
  }
}
for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  declared.push(['bin', name, target]);
}

const problems = [];
for (const [kind, name, target] of declared) {
  if (!existsSync(resolve(target))) {
    problems.push([kind, name, target, 'missing from the build']);
    continue;
  }
  // A bin without the execute bit fails only once installed, on someone else's
  // machine, with a permission error that says nothing about the cause.
  if (kind === 'bin' && (statSync(resolve(target)).mode & 0o111) === 0) {
    problems.push([kind, name, target, 'not executable']);
  }
}

for (const [kind, name, target] of declared) {
  const problem = problems.find((p) => p[2] === target && p[1] === name);
  console.log(`${problem ? '✗' : '✓'} ${kind} ${name} → ${target}${problem ? ` (${problem[3]})` : ''}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) with declared entry points.`);
  process.exit(1);
}

console.log(`\n${declared.length} entry points, all present.`);
