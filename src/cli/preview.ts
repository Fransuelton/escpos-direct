import type { CliOptions } from '../cli.js';
import type { Profile } from '../profile.js';
import { resolveProfile } from './context.js';
import { fromText, readSource, render } from './document.js';
import { bold, dim, red } from './ui.js';

/**
 * Draw the receipt inside a paper-width frame.
 *
 * The frame is the feature: a line that overflows is obvious here and easy to
 * miss on a terminal that wraps silently.
 */
export function frame(lines: string[], profile: Profile): string[] {
  const width = profile.columns;
  const ruler = Array.from({ length: width }, (_, i) =>
    (i + 1) % 10 === 0 ? '|' : (i + 1) % 5 === 0 ? '+' : '-',
  ).join('');

  const out = [dim(`┌─${ruler}─┐`)];
  for (const line of lines) {
    const over = line.length > width;
    const body = over ? line.slice(0, width) : line.padEnd(width);
    out.push(
      `${dim('│')} ${over ? red(body) : body} ${dim('│')}${over ? red(` ← ${line.length}`) : ''}`,
    );
  }
  out.push(dim(`└─${ruler}─┘`));
  return out;
}

export async function preview(path: string | undefined, values: CliOptions): Promise<number> {
  const profile = resolveProfile(values);
  const bytes = fromText(await readSource(path), profile).encode();
  const lines = render(bytes, profile);

  console.log();
  console.log(
    `${bold('preview')} ${dim(`${profile.columns} columns · ${profile.codePage} · ${bytes.length} bytes`)}`,
  );
  console.log();
  for (const line of frame(lines, profile)) console.log(line);
  console.log();

  const over = lines.filter((l) => l.length > profile.columns).length;
  if (over > 0) {
    console.log(red(`${over} line${over === 1 ? '' : 's'} exceed the paper width.`));
    return 1;
  }
  return 0;
}
