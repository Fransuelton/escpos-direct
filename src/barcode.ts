import { GS } from './commands.js';

export type Symbology =
  | 'upc-a'
  | 'upc-e'
  | 'ean13'
  | 'ean8'
  | 'code39'
  | 'itf'
  | 'codabar'
  | 'code93'
  | 'code128';

/** Where the human-readable digits print, if at all. */
export type HriPosition = 'none' | 'above' | 'below' | 'both';

export interface BarcodeOptions {
  symbology?: Symbology;
  /** Bar height in dots, 1–255. */
  height?: number;
  /** Module width, 2–6. Wider bars scan better but eat paper. */
  width?: number;
  hri?: HriPosition;
  /** Human-readable font: `a` is larger, `b` is denser. */
  hriFont?: 'a' | 'b';
}

const CODE = {
  'upc-a': 65,
  'upc-e': 66,
  ean13: 67,
  ean8: 68,
  code39: 69,
  itf: 70,
  codabar: 71,
  code93: 72,
  code128: 73,
} as const satisfies Record<Symbology, number>;

const HRI = { none: 0, above: 1, below: 2, both: 3 } as const;

const RULES: Record<Symbology, { test: RegExp; expected: string }> = {
  'upc-a': { test: /^\d{11,12}$/, expected: '11 or 12 digits' },
  'upc-e': { test: /^\d{11,12}$/, expected: '11 or 12 digits' },
  ean13: { test: /^\d{12,13}$/, expected: '12 or 13 digits' },
  ean8: { test: /^\d{7,8}$/, expected: '7 or 8 digits' },
  code39: { test: /^[0-9A-Z \-.$/+%*]+$/, expected: 'digits, capitals and - . $ / + % *' },
  itf: { test: /^(\d\d)+$/, expected: 'an even number of digits' },
  codabar: { test: /^[A-Da-d][0-9$+\-./:]*[A-Da-d]$/, expected: 'digits wrapped in A–D start/stop characters' },
  code93: { test: /^[\x00-\x7f]+$/, expected: 'ASCII only' },
  code128: { test: /^[\x00-\x7f]+$/, expected: 'ASCII only' },
};

/**
 * `GS k` — a barcode, with its height, width and HRI settings.
 *
 * Invalid data is rejected here rather than sent, because a printer given a
 * barcode it cannot encode prints nothing at all and reports no error — the
 * receipt just comes out with a gap where the code should be.
 */
export function barcode(data: string, options: BarcodeOptions = {}): Uint8Array {
  const symbology = options.symbology ?? 'code128';
  const payload = symbology === 'code128' ? withCodeSet(data) : data;

  const rule = RULES[symbology];
  if (!rule.test.test(data)) {
    throw new RangeError(`invalid data for ${symbology}: expected ${rule.expected}, got "${data}"`);
  }

  const bytes = new TextEncoder().encode(payload);
  if (bytes.length > 255) {
    throw new RangeError(`barcode data is ${bytes.length} bytes; the maximum is 255`);
  }

  const out: number[] = [];
  if (options.height !== undefined) out.push(GS, 0x68, clamp(options.height, 1, 255));
  if (options.width !== undefined) out.push(GS, 0x77, clamp(options.width, 2, 6));
  out.push(GS, 0x48, HRI[options.hri ?? 'none']);
  if (options.hriFont !== undefined) out.push(GS, 0x66, options.hriFont === 'b' ? 1 : 0);

  // Form B (`GS k m n data`) carries an explicit length, so the data may contain
  // NUL. Form A terminates on NUL and silently truncates.
  out.push(GS, 0x6b, CODE[symbology], bytes.length, ...bytes);
  return Uint8Array.from(out);
}

/**
 * CODE128 data must name its code set, and printers given one without a `{`
 * prefix commonly print nothing. `{B` covers mixed alphanumerics.
 */
function withCodeSet(data: string): string {
  return data.startsWith('{') ? data : `{B${data}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
