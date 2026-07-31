/**
 * Paper and printer characteristics.
 *
 * Column count is not cosmetic: every right-aligned value on the receipt is
 * computed from it, so a wrong profile means a receipt that looks fine in the
 * terminal and comes out ragged on paper.
 */
import type { CodePage } from './codepage/index.js';

export interface Profile {
  /** Usable columns in font A, at 1x width. */
  columns: number;
  /** Usable horizontal dots, for raster images. Must be a multiple of 8. */
  dots: number;
  /** Code page the printer is put into via `ESC t`. */
  codePage: CodePage;
  /**
   * Blank lines fed after the receipt.
   *
   * Most cheap 58mm printers have no cutter, so without this the footer stops
   * behind the tear bar and gets ripped through the text.
   */
  feedLines: number;
  /** Whether the interface can answer `DLE EOT` status queries. */
  bidirectional: boolean;
}

/** 58mm paper — the common cheap thermal printer. */
export const mm58: Profile = {
  columns: 32,
  dots: 384,
  codePage: 'cp850',
  feedLines: 4,
  bidirectional: true,
};

/** 80mm paper — receipt printers with a cutter. */
export const mm80: Profile = {
  columns: 48,
  dots: 576,
  codePage: 'cp850',
  feedLines: 4,
  bidirectional: true,
};

export function profile(base: Profile, overrides: Partial<Profile> = {}): Profile {
  return { ...base, ...overrides };
}
