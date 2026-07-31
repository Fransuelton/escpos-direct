import { readFile } from 'node:fs/promises';
import { Receipt } from '../receipt.js';
import type { Profile } from '../profile.js';
import { decode } from '../codepage/index.js';

/** Read a path, or stdin when it is `-`. */
export async function readSource(path: string | undefined): Promise<string> {
  if (path === undefined) throw new RangeError('missing file argument; pass a path or - for stdin');
  if (path !== '-') return readFile(path, 'utf8');

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Plain text to a receipt, one line per line.
 *
 * Deliberately not a layout language: the library is the API for that, and a
 * half-invented markup would be a worse one.
 */
export function fromText(text: string, profile: Profile): Receipt {
  const receipt = new Receipt(profile).reset();
  for (const line of text.replace(/\n$/, '').split('\n')) receipt.paragraph(line);
  return receipt.feed();
}

/**
 * Render a payload as the printer would lay it out.
 *
 * Decoding through the code page rather than latin1 is the point: it shows the
 * bytes actually going out, so a wrong page is visible before it reaches paper.
 */
export function render(bytes: Uint8Array, profile: Profile): string[] {
  const text: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      i += bytes[i + 1] === 0x40 ? 1 : 2;
    } else if (b === 0x1d) {
      // GS commands carry payloads of their own; skipping them properly needs
      // the command table, and for a text preview the three-byte forms cover it.
      i += 2;
    } else {
      text.push(b);
    }
  }
  return decode(Uint8Array.from(text), profile.codePage).split('\n');
}
