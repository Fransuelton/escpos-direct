/**
 * Text -> printer bytes.
 *
 * Node cannot do this on its own: `TextEncoder` is UTF-8 only, and
 * `Buffer.from(s, 'latin1')` is Latin-1, *not* CP850 — the accented characters
 * sit at different code points. That mismatch is the single most common cause
 * of garbled accents on thermal printers, so this library carries its own
 * tables rather than depending on an encoding package.
 */
import { ESC_T, TABLES } from './tables.js';

export type CodePage = keyof typeof ESC_T;
export { ESC_T, TABLES };

export const CODE_PAGES = Object.keys(ESC_T) as CodePage[];

/** Replacement byte for characters the page cannot represent. */
const UNKNOWN = 0x3f; // '?'

/**
 * Encode a string into a single-byte code page.
 *
 * Characters below 0x80 are ASCII and pass straight through; the rest are
 * looked up in the generated table.
 */
export function encode(text: string, page: CodePage): Uint8Array {
  const table = TABLES[page];
  if (!table) throw new RangeError(`unknown code page: ${page}`);

  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
    } else {
      out.push(table[ch] ?? UNKNOWN);
    }
  }
  return Uint8Array.from(out);
}

/** Reverse tables, built on first use — only the `preview` path needs them. */
const REVERSE = new Map<CodePage, Map<number, string>>();

function reverse(page: CodePage): Map<number, string> {
  let m = REVERSE.get(page);
  if (!m) {
    const table = TABLES[page];
    if (!table) throw new RangeError(`unknown code page: ${page}`);
    m = new Map(Object.entries(table).map(([ch, b]) => [b, ch]));
    REVERSE.set(page, m);
  }
  return m;
}

/**
 * Printer bytes -> text. The inverse of {@link encode}.
 *
 * This is what makes a terminal preview honest: rendering the payload the
 * printer will actually receive, rather than the string that went in, catches
 * a wrong code page before it reaches paper.
 */
export function decode(bytes: Uint8Array, page: CodePage): string {
  const table = reverse(page);
  let out = '';
  for (const b of bytes) {
    out += b < 0x80 ? String.fromCharCode(b) : (table.get(b) ?? '?');
  }
  return out;
}

/**
 * `ESC t n` — select the printer's code page.
 *
 * Must be sent *after* `ESC @`, which resets the selection. Encoding the text
 * correctly is not enough on its own: without this command the printer stays
 * on whatever page it booted with, and every accent is a lottery.
 */
export function selectCodePage(page: CodePage): Uint8Array {
  const n = ESC_T[page];
  if (n === undefined) throw new RangeError(`unknown code page: ${page}`);
  return Uint8Array.from([0x1b, 0x74, n]);
}
