import { describe, expect, it } from 'vitest';
import { isStatusByte, parseStatus, type StatusBytes } from '../src/status.js';

/**
 * The three states below are not invented — they were read off a YiDa YD583 on
 * 2026-07-30 by opening the cover and pulling the roll out by hand. Because the
 * parser is pure, a physical measurement can serve as a test fixture forever.
 */
const MEASURED = {
  ready: { printer: 0x12, offline: 0x12, error: 0x12, paper: 0x12 },
  coverOpen: { printer: 0x1a, offline: 0x32, error: 0x12, paper: 0x72 },
  noPaper: { printer: 0x1a, offline: 0x32, error: 0x12, paper: 0x72 },
} satisfies Record<string, StatusBytes>;

describe('measured states', () => {
  it('reads the baseline as ready', () => {
    const s = parseStatus(MEASURED.ready);
    expect(s.ready).toBe(true);
    expect(s.paper).toBe('ok');
    expect(s.coverOpen).toBe(false);
    expect(s.error).toBe('none');
    expect(s.reason).toBeUndefined();
  });

  it('reads cover-open as not ready, out of paper', () => {
    const s = parseStatus(MEASURED.coverOpen);
    expect(s.ready).toBe(false);
    expect(s.paper).toBe('out');
  });

  it('cannot tell cover-open from out-of-paper, and says so instead of guessing', () => {
    // This printer never raises the cover bit: opening the cover lifts the
    // paper sensor, which is the only sensor it has. Naming just one of the two
    // would send someone hunting for a roll that is already loaded.
    expect(MEASURED.coverOpen).toEqual(MEASURED.noPaper);

    const s = parseStatus(MEASURED.noPaper);
    expect(s.coverOpen).toBe(false);
    expect(s.reason).toMatch(/out of paper, or the cover is open/);
  });

  it('keeps the raw bytes, so a bug report can carry them', () => {
    expect(parseStatus(MEASURED.coverOpen).raw).toEqual(MEASURED.coverOpen);
  });
});

describe('states from the spec', () => {
  const base = MEASURED.ready;

  it('reports a real cover-open bit when a printer does raise it', () => {
    const s = parseStatus({ ...base, offline: 0x16 }); // 0x12 | 0x04
    expect(s.coverOpen).toBe(true);
    expect(s.ready).toBe(false);
    expect(s.reason).toBe('cover is open');
  });

  it('distinguishes paper near end from paper out', () => {
    expect(parseStatus({ ...base, paper: 0x1e }).paper).toBe('near-end'); // 0x12 | 0x0c
    expect(parseStatus({ ...base, paper: 0x72 }).paper).toBe('out'); // 0x12 | 0x60
  });

  it('still prints when paper is merely near the end', () => {
    expect(parseStatus({ ...base, paper: 0x1e }).ready).toBe(true);
  });

  it('classifies the error bits', () => {
    expect(parseStatus({ ...base, error: 0x1a }).error).toBe('cutter'); // 0x12 | 0x08
    expect(parseStatus({ ...base, error: 0x32 }).error).toBe('unrecoverable'); // 0x12 | 0x20
    expect(parseStatus({ ...base, error: 0x52 }).error).toBe('recoverable'); // 0x12 | 0x40
  });

  it('puts the unrecoverable error ahead of everything else in the reason', () => {
    const s = parseStatus({ printer: 0x1a, offline: 0x32, error: 0x32, paper: 0x72 });
    expect(s.reason).toMatch(/power cycle/);
  });

  it('reads the drawer pin', () => {
    expect(parseStatus({ ...base, printer: 0x16 }).drawerOpen).toBe(true); // 0x12 | 0x04
    expect(parseStatus(base).drawerOpen).toBe(false);
  });
});

describe('isStatusByte', () => {
  it('accepts every byte actually measured', () => {
    for (const state of Object.values(MEASURED)) {
      for (const byte of Object.values(state)) expect(isStatusByte(byte)).toBe(true);
    }
  });

  it('rejects bytes without the fixed-bit signature', () => {
    // Bits 1 and 4 are always 1, bits 0 and 7 always 0. Anything else is
    // leftover data from an earlier read, not a status.
    expect(isStatusByte(0x00)).toBe(false);
    expect(isStatusByte(0xff)).toBe(false);
    expect(isStatusByte(0x41)).toBe(false); // 'A' — plain text in the buffer
  });
});
