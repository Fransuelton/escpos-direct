import { describe, expect, it } from 'vitest';
import { CODE_PAGES, encode, selectCodePage } from '../src/codepage/index.js';

describe('encode', () => {
  it('passes ASCII straight through', () => {
    expect([...encode('TOTAL', 'cp850')]).toEqual([0x54, 0x4f, 0x54, 0x41, 0x4c]);
  });

  it('maps Portuguese accents to their CP850 bytes', () => {
    // Verified against the system iconv when the tables were generated.
    expect([...encode('áéíóú', 'cp850')]).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3]);
    expect([...encode('ãõçÇ', 'cp850')]).toEqual([0xc6, 0xe4, 0x87, 0x80]);
  });

  it('is NOT latin1 — the trap that garbles accents', () => {
    // Buffer.from(s, 'latin1') puts "ç" at 0xE7; CP850 puts it at 0x87.
    // Getting this wrong is the single most common thermal printing bug.
    expect(encode('ç', 'cp850')[0]).toBe(0x87);
    expect(Buffer.from('ç', 'latin1')[0]).toBe(0xe7);
  });

  it('differs between pages for the same character', () => {
    // CP860 is the Portugal page; "ã" sits elsewhere than in CP850.
    expect(encode('ã', 'cp850')[0]).not.toBe(encode('ã', 'cp860')[0]);
  });

  it('falls back to ? for characters the page lacks', () => {
    expect(encode('日', 'cp850')[0]).toBe(0x3f);
  });

  it('handles astral characters without splitting surrogates', () => {
    expect([...encode('𝄞', 'cp850')]).toEqual([0x3f]);
  });

  it('rejects an unknown page loudly', () => {
    expect(() => encode('a', 'cp999' as never)).toThrow(/unknown code page/);
  });
});

describe('selectCodePage', () => {
  it('emits ESC t with the right index', () => {
    expect([...selectCodePage('cp850')]).toEqual([0x1b, 0x74, 2]);
    expect([...selectCodePage('cp437')]).toEqual([0x1b, 0x74, 0]);
    expect([...selectCodePage('cp860')]).toEqual([0x1b, 0x74, 3]);
  });

  it('covers every table that ships', () => {
    for (const p of CODE_PAGES) expect(selectCodePage(p)).toHaveLength(3);
  });
});
