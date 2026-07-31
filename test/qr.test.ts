import { describe, expect, it } from 'vitest';
import { qr } from '../src/qr.js';
import { Receipt } from '../src/receipt.js';

describe('command sequence', () => {
  it('emits model, size, correction, store and print, in that order', () => {
    const out = [...qr('HI', { size: 6, correction: 'M' })];
    expect(out).toEqual([
      0x1d,
      0x28,
      0x6b,
      4,
      0,
      0x31,
      0x41,
      50,
      0, // model 2
      0x1d,
      0x28,
      0x6b,
      3,
      0,
      0x31,
      0x43,
      6, // module size
      0x1d,
      0x28,
      0x6b,
      3,
      0,
      0x31,
      0x45,
      49, // correction M
      0x1d,
      0x28,
      0x6b,
      5,
      0,
      0x31,
      0x50,
      0x30,
      0x48,
      0x49, // store "HI"
      0x1d,
      0x28,
      0x6b,
      3,
      0,
      0x31,
      0x51,
      0x30, // print
    ]);
  });

  it('splits the store length across pL and pH past 255 bytes', () => {
    // Model, size and correction are fixed at 9 + 8 + 8 bytes, so store starts
    // at 25. 300 bytes of data is 303 with the header: 303 = 0x2f + 0x01 * 256.
    const out = [...qr('A'.repeat(300))];
    expect(out.slice(25, 31)).toEqual([0x1d, 0x28, 0x6b, 0x2f, 0x01, 0x31]);
  });

  it('maps the correction levels', () => {
    for (const [level, byte] of [
      ['L', 48],
      ['M', 49],
      ['Q', 50],
      ['H', 51],
    ] as const) {
      expect([...qr('x', { correction: level })]).toContain(byte);
    }
  });

  it('clamps module size to 1–16', () => {
    expect([...qr('x', { size: 99 })].slice(14, 17)).toEqual([0x31, 0x43, 16]);
    expect([...qr('x', { size: 0 })].slice(14, 17)).toEqual([0x31, 0x43, 1]);
  });
});

describe('payload', () => {
  it('writes bytes raw, without the code page', () => {
    // Through CP850 the ç would be 0x87; a QR carries bytes and the scanner
    // decides, so it stays UTF-8.
    const out = [...qr('ç')];
    expect(out).toContain(0xc3);
    expect(out).toContain(0xa7);
    expect(out).not.toContain(0x87);
  });

  it('takes a PIX BR Code verbatim', () => {
    const pix =
      '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304ABCD';
    const out = qr(pix);
    const stored = String.fromCharCode(...out).slice(-pix.length - 8, -8);
    expect(stored).toBe(pix);
  });

  it('rejects empty data and data past the format limit', () => {
    expect(() => qr('')).toThrow(/empty/);
    expect(() => qr('A'.repeat(7090))).toThrow(/7089/);
  });
});

describe('on the receipt', () => {
  it('chains and stays pure', () => {
    const r = new Receipt().align('center').qr('https://example.com', { size: 8 });
    expect([...r.encode()]).toEqual([...r.encode()]);
  });
});
