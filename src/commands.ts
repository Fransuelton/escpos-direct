/**
 * Raw ESC/POS byte sequences.
 *
 * Kept separate from the builder so that anything this library does not model
 * yet can still be reached through `receipt.raw(...)` without patching it.
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const DLE = 0x10;
export const EOT = 0x04;
export const LF = 0x0a;

/** `ESC @` — reset. Clears the code page, so `ESC t` must come after it. */
export const RESET = Uint8Array.from([ESC, 0x40]);

export const ALIGN_LEFT = Uint8Array.from([ESC, 0x61, 0]);
export const ALIGN_CENTER = Uint8Array.from([ESC, 0x61, 1]);
export const ALIGN_RIGHT = Uint8Array.from([ESC, 0x61, 2]);

export const BOLD_ON = Uint8Array.from([ESC, 0x45, 1]);
export const BOLD_OFF = Uint8Array.from([ESC, 0x45, 0]);

export const UNDERLINE_ON = Uint8Array.from([ESC, 0x2d, 1]);
export const UNDERLINE_OFF = Uint8Array.from([ESC, 0x2d, 0]);

/**
 * `GS !` — character size. Low nibble is height, high nibble is width, each a
 * 0-based multiplier. Doubling the width halves the usable columns, which is
 * why the builder tracks this rather than leaving it to the caller.
 */
export function size(width: number, height: number): Uint8Array {
  const w = Math.max(1, Math.min(8, width)) - 1;
  const h = Math.max(1, Math.min(8, height)) - 1;
  return Uint8Array.from([GS, 0x21, (w << 4) | h]);
}

/** `ESC d n` — feed n lines. */
export function feed(lines: number): Uint8Array {
  return Uint8Array.from([ESC, 0x64, Math.max(0, Math.min(255, lines))]);
}

/**
 * `DLE EOT n` — real-time status.
 *
 * Only works on bidirectional interfaces (`bInterfaceProtocol = 2`), which
 * covers most USB thermal printers. Reply is a single byte.
 */
export function statusQuery(n: 1 | 2 | 3 | 4): Uint8Array {
  return Uint8Array.from([DLE, EOT, n]);
}

/** `ESC p` — pulse the cash drawer on pin 2 or 5. */
export function drawer(pin: 0 | 1 = 0, onMs = 25, offMs = 250): Uint8Array {
  const t = (ms: number) => Math.max(0, Math.min(255, Math.round(ms / 2)));
  return Uint8Array.from([ESC, 0x70, pin, t(onMs), t(offMs)]);
}

/** Concatenate byte chunks. */
export function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
