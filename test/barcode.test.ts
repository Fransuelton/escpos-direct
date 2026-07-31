import { describe, expect, it } from 'vitest';
import { barcode } from '../src/barcode.js';
import { Receipt } from '../src/receipt.js';

const bytes = (...args: Parameters<typeof barcode>) => [...barcode(...args)];

describe('command shape', () => {
  it('uses form B, which carries an explicit length', () => {
    // GS k 73 <len> <data> — form A would terminate on NUL and truncate.
    expect(bytes('AB', { symbology: 'code128', hri: 'none' })).toEqual([
      0x1d, 0x48, 0, // HRI off
      0x1d, 0x6b, 73, 4, 0x7b, 0x42, 0x41, 0x42, // {BAB
    ]);
  });

  it('emits height, width and HRI font only when asked', () => {
    expect(bytes('123456789012', { symbology: 'ean13' })).toEqual([
      0x1d, 0x48, 0,
      0x1d, 0x6b, 67, 12, ...[...'123456789012'].map((c) => c.charCodeAt(0)),
    ]);

    const full = bytes('123456789012', {
      symbology: 'ean13',
      height: 80,
      width: 3,
      hri: 'below',
      hriFont: 'b',
    });
    expect(full.slice(0, 12)).toEqual([
      0x1d, 0x68, 80, // GS h
      0x1d, 0x77, 3, // GS w
      0x1d, 0x48, 2, // GS H below
      0x1d, 0x66, 1, // GS f font B
    ]);
  });

  it('clamps height and width to what the command accepts', () => {
    expect(bytes('AB', { height: 999 }).slice(0, 3)).toEqual([0x1d, 0x68, 255]);
    expect(bytes('AB', { width: 99 }).slice(0, 3)).toEqual([0x1d, 0x77, 6]);
    expect(bytes('AB', { width: 1 }).slice(0, 3)).toEqual([0x1d, 0x77, 2]);
  });
});

describe('code128 code set', () => {
  it('prefixes {B, without which many printers print nothing', () => {
    const out = bytes('ABC123');
    expect(out.slice(-8)).toEqual([0x7b, 0x42, 0x41, 0x42, 0x43, 0x31, 0x32, 0x33]);
  });

  it('leaves an explicit code set alone', () => {
    expect(bytes('{C1234')).toEqual(bytes('{C1234'));
    expect(String.fromCharCode(...bytes('{C1234').slice(-6))).toBe('{C1234');
  });
});

describe('validation', () => {
  it('rejects what the symbology cannot encode, instead of printing a gap', () => {
    // The failure this prevents is silent: the printer accepts the command,
    // prints nothing, and reports no error.
    expect(() => barcode('12345', { symbology: 'ean13' })).toThrow(/12 or 13 digits/);
    expect(() => barcode('123', { symbology: 'itf' })).toThrow(/even number/);
    expect(() => barcode('abc', { symbology: 'code39' })).toThrow(/capitals/);
    expect(() => barcode('1234567', { symbology: 'ean8' })).not.toThrow();
  });

  it('names the offending value in the message', () => {
    expect(() => barcode('12', { symbology: 'ean13' })).toThrow(/"12"/);
  });

  it('rejects data past the 255-byte limit of the command', () => {
    expect(() => barcode('A'.repeat(300))).toThrow(/255/);
  });
});

describe('on the receipt', () => {
  it('chains and stays pure', () => {
    const r = new Receipt().barcode('7891234567895', { symbology: 'ean13', hri: 'below' });
    expect([...r.encode()]).toEqual([...r.encode()]);
    expect([...r.encode()]).toContain(67);
  });
});
