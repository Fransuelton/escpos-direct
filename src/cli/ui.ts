/** Terminal output helpers. No dependencies, and colour only when it is wanted. */

const enabled =
  process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb' && process.stdout.isTTY === true;

const wrap = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = wrap('1');
export const dim = wrap('2');
export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');
export const cyan = wrap('36');

export const ok = (m: string) => console.log(`${green('✓')} ${m}`);
export const bad = (m: string) => console.log(`${red('✗')} ${m}`);
export const warn = (m: string) => console.log(`${yellow('!')} ${m}`);
export const info = (m: string) => console.log(`${dim('·')} ${m}`);
export const heading = (m: string) => console.log(`\n${bold(m)}`);

/** Print a typed error the way it was designed to be read: message, then hint. */
export function reportError(e: unknown): void {
  const error = e as { name?: string; code?: string; message?: string; hint?: string };
  if (error?.name === 'EscposError') {
    console.error(`\n${red('✗')} ${bold(error.code ?? 'ERROR')} — ${error.message}`);
    if (error.hint) console.error(`  ${yellow('hint')} ${error.hint}`);
    return;
  }
  console.error(`\n${red('✗')} ${error?.message ?? String(e)}`);
}
