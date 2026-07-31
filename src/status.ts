/**
 * Reading `DLE EOT` replies.
 *
 * Kept pure and separate from the transport: the bytes are the hard part, and
 * they can be tested against real measurements without a printer in the room.
 *
 * Measured on a YiDa YD583 on 2026-07-30, three physical states:
 *
 *   query   closed, paper in   cover open   no paper, closed
 *   n=1     0x12               0x1a         0x1a
 *   n=2     0x12               0x32         0x32
 *   n=3     0x12               0x12         0x12
 *   n=4     0x12               0x72         0x72
 *
 * The last two columns are identical, and that is the finding this module is
 * built around — see {@link PrinterStatus.reason}.
 */

/** The four raw replies, exactly as they came off the wire. */
export interface StatusBytes {
  /** `DLE EOT 1` — printer status. */
  printer: number;
  /** `DLE EOT 2` — offline status. */
  offline: number;
  /** `DLE EOT 3` — error status. */
  error: number;
  /** `DLE EOT 4` — paper sensor. */
  paper: number;
}

export type PaperState = 'ok' | 'near-end' | 'out';
export type ErrorState = 'none' | 'recoverable' | 'unrecoverable' | 'cutter';

export interface PrinterStatus {
  /** Safe to print: online, has paper, cover shut, no error. */
  ready: boolean;
  paper: PaperState;
  /**
   * Only ever true when the printer actually raises the cover bit.
   *
   * Cheap thermal printers frequently do not have a cover sensor at all — see
   * {@link PrinterStatus.reason} before building a UI on this.
   */
  coverOpen: boolean;
  /** Cash drawer pin reading high. Meaningless if no drawer is wired up. */
  drawerOpen: boolean;
  error: ErrorState;
  /** One human sentence when `ready` is false. Undefined when it is true. */
  reason?: string;
  /** The bytes themselves, for logging and for `doctor` to print. */
  raw: StatusBytes;
}

// Bits 1 and 4 are fixed at 1, bits 0 and 7 fixed at 0. A reply that does not
// match this is not a status byte — usually the tail of an earlier read.
const FIXED_MASK = 0x93;
const FIXED_VALUE = 0x12;

/** Does this byte carry the DLE EOT signature? */
export function isStatusByte(b: number): boolean {
  return (b & FIXED_MASK) === FIXED_VALUE;
}

const on = (byte: number, mask: number) => (byte & mask) === mask;

/**
 * Interpret the four replies.
 *
 * Pure: same bytes in, same status out, and no hardware involved. That is what
 * lets the real measurements above serve as test fixtures.
 */
export function parseStatus(raw: StatusBytes): PrinterStatus {
  const paper: PaperState = on(raw.paper, 0x60) ? 'out' : on(raw.paper, 0x0c) ? 'near-end' : 'ok';

  const coverOpen = on(raw.offline, 0x04);
  const offline = on(raw.printer, 0x08);

  const error: ErrorState = on(raw.error, 0x08)
    ? 'cutter'
    : on(raw.error, 0x20)
      ? 'unrecoverable'
      : on(raw.error, 0x40)
        ? 'recoverable'
        : 'none';

  const ready = !offline && paper !== 'out' && !coverOpen && error === 'none';

  return {
    ready,
    paper,
    coverOpen,
    drawerOpen: on(raw.printer, 0x04),
    error,
    ...(ready ? {} : { reason: describe({ paper, coverOpen, offline, error }) }),
    raw,
  };
}

/**
 * Why the printer will not print, in one sentence.
 *
 * The out-of-paper wording is deliberate and comes from measurement rather than
 * from the spec: on the printer this library was built against, opening the
 * cover lifts the paper sensor and there is no separate cover sensor, so both
 * states arrive as the exact same bytes. Naming only one of them would send
 * someone hunting for a paper roll that is already loaded.
 */
function describe(s: {
  paper: PaperState;
  coverOpen: boolean;
  offline: boolean;
  error: ErrorState;
}): string {
  if (s.error === 'cutter') return 'cutter jammed';
  if (s.error === 'unrecoverable') return 'unrecoverable error — power cycle the printer';
  if (s.coverOpen) return 'cover is open';
  if (s.paper === 'out') {
    return 'out of paper, or the cover is open — many thermal printers report both identically, because opening the cover lifts the paper sensor';
  }
  if (s.error === 'recoverable') return 'recoverable error — clear it and retry';
  if (s.offline) return 'offline';
  return 'not ready';
}
