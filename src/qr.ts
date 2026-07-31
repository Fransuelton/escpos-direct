import { GS } from './commands.js';

/** L 7%, M 15%, Q 25%, H 30% recovery. Higher costs more modules. */
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  /** Module size in dots, 1–16. Around 6 is readable on 58mm paper. */
  size?: number;
  correction?: ErrorCorrection;
  /** Model 2 is what every current scanner expects. */
  model?: 1 | 2;
}

const CORRECTION = { L: 48, M: 49, Q: 50, H: 51 } as const;

/** `GS ( k` function header, sized for the payload that follows. */
function fn(length: number, ...body: number[]): number[] {
  return [GS, 0x28, 0x6b, length & 0xff, length >> 8, ...body];
}

/**
 * `GS ( k` — a QR code, as the four commands the printer expects: model,
 * module size, error correction, store, print.
 *
 * The data is written as raw bytes and never passes through the receipt's code
 * page. A QR code carries bytes and the scanner decides how to read them, so
 * running it through CP850 would corrupt anything non-ASCII.
 *
 * Handy for PIX: pass the BR Code payload string as-is.
 */
export function qr(data: string, options: QrOptions = {}): Uint8Array {
  const bytes = new TextEncoder().encode(data);
  if (bytes.length === 0) throw new RangeError('QR data is empty');
  if (bytes.length > 7089) {
    throw new RangeError(`QR data is ${bytes.length} bytes; the maximum is 7089`);
  }

  const size = Math.max(1, Math.min(16, Math.round(options.size ?? 6)));

  return Uint8Array.from([
    ...fn(4, 0x31, 0x41, options.model === 1 ? 49 : 50, 0),
    ...fn(3, 0x31, 0x43, size),
    ...fn(3, 0x31, 0x45, CORRECTION[options.correction ?? 'M']),
    // Store: the length covers the two function bytes and the mode byte too.
    ...fn(bytes.length + 3, 0x31, 0x50, 0x30, ...bytes),
    ...fn(3, 0x31, 0x51, 0x30),
  ]);
}
