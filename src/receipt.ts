/**
 * Chainable receipt builder.
 *
 * `encode()` returns bytes and touches no hardware, so a receipt layout is a
 * pure function of its input — which means it can be snapshot-tested, diffed,
 * and previewed in a terminal without a printer in the room.
 *
 * The builder deliberately does not format money, dates, or locales. It knows
 * about columns and bytes; what goes in them is the application's business.
 */
import { barcode, type BarcodeOptions } from './barcode.js';
import * as cmd from './commands.js';
import { encode, selectCodePage, type CodePage } from './codepage/index.js';
import { raster, type Bitmap, type ImageOptions } from './image.js';
import { mm58, type Profile } from './profile.js';
import { qr, type QrOptions } from './qr.js';
import { itemLines, pad, sanitize, truncate, wrap } from './text.js';

export type Align = 'left' | 'center' | 'right';

const ALIGN = {
  left: cmd.ALIGN_LEFT,
  center: cmd.ALIGN_CENTER,
  right: cmd.ALIGN_RIGHT,
} as const;

export class Receipt {
  #chunks: Uint8Array[] = [];
  #profile: Profile;
  #page: CodePage;
  #width = 1;
  #height = 1;

  constructor(profile: Profile = mm58) {
    this.#profile = profile;
    this.#page = profile.codePage;
  }

  /**
   * Columns available at the current character size.
   *
   * At double width a line holds half as many characters, so a `TOTAL` padded
   * against the full column count lands visibly off. Tracking it here means
   * callers cannot get it wrong.
   */
  get columns(): number {
    return Math.max(1, Math.floor(this.#profile.columns / this.#width));
  }

  get profile(): Profile {
    return this.#profile;
  }

  #push(...chunks: Uint8Array[]): this {
    this.#chunks.push(...chunks);
    return this;
  }

  #encode(text: string): Uint8Array {
    return encode(text, this.#page);
  }

  // ── printer state ────────────────────────────────────────────────────────

  /** `ESC @`. Also re-applies the code page, which the reset clears. */
  reset(): this {
    this.#width = 1;
    this.#height = 1;
    return this.#push(cmd.RESET, selectCodePage(this.#page));
  }

  /** Switch code page, emitting `ESC t`. */
  codepage(page: CodePage): this {
    this.#page = page;
    return this.#push(selectCodePage(page));
  }

  align(a: Align): this {
    return this.#push(ALIGN[a]);
  }

  bold(on = true): this {
    return this.#push(on ? cmd.BOLD_ON : cmd.BOLD_OFF);
  }

  underline(on = true): this {
    return this.#push(on ? cmd.UNDERLINE_ON : cmd.UNDERLINE_OFF);
  }

  /** Character size multiplier, 1–8. Updates the column count. */
  size(width: number, height = width): this {
    this.#width = Math.max(1, Math.min(8, Math.round(width)));
    this.#height = Math.max(1, Math.min(8, Math.round(height)));
    return this.#push(cmd.size(this.#width, this.#height));
  }

  // ── content ──────────────────────────────────────────────────────────────

  /** Sanitized text, no line break. */
  text(s: string): this {
    return this.#push(this.#encode(sanitize(s)));
  }

  /** Sanitized text plus a line break. Multi-line input is split and kept. */
  line(s = ''): this {
    for (const l of sanitize(s).split('\n')) {
      this.#push(this.#encode(l), Uint8Array.from([cmd.LF]));
    }
    return this;
  }

  /** Word-wrapped text at the current column count. */
  paragraph(s: string): this {
    for (const l of wrap(s, this.columns)) this.line(l);
    return this;
  }

  /** A horizontal rule spanning the current columns. */
  rule(char = '-'): this {
    return this.line(char.repeat(this.columns));
  }

  /**
   * Label left, value right, on one line.
   *
   * `value` is a preformatted string on purpose: currency belongs to the
   * caller's locale, not to a printer library.
   */
  pair(label: string, value: string): this {
    return this.line(pad(sanitize(label), sanitize(value), this.columns));
  }

  /** Description wrapped on words, value right-aligned. */
  item(description: string, value: string): this {
    for (const l of itemLines(description, sanitize(value), this.columns)) this.line(l);
    return this;
  }

  /**
   * Indented sub-line under an item, carrying no value of its own.
   *
   * For a package sold as one unit whose contents the customer picks — the
   * price belongs to the package and already printed on the line above, so
   * repeating a number here would make the receipt look like it charges per
   * component. Truncates rather than wraps: at 32 columns, wrapping a ten-item
   * breakdown would double the paper it takes.
   */
  sub(text: string, indent = 2): this {
    const prefix = ' '.repeat(indent);
    const body = truncate(sanitize(text), Math.max(1, this.columns - indent));
    return this.#push(this.#encode(prefix + body), Uint8Array.from([cmd.LF]));
  }

  /**
   * An emphasized total line, at double size by default.
   *
   * Column count halves automatically — see `columns`.
   */
  total(label: string, value: string, scale = 2): this {
    this.size(scale).bold(true);
    this.line(pad(sanitize(label), sanitize(value), this.columns));
    return this.bold(false).size(1);
  }

  // ── codes ────────────────────────────────────────────────────────────────

  /**
   * A barcode. Defaults to CODE128, which handles mixed alphanumerics.
   *
   * Throws on data the symbology cannot encode, since a printer handed an
   * invalid barcode prints nothing and says nothing.
   */
  barcode(data: string, options: BarcodeOptions = {}): this {
    return this.#push(barcode(data, options));
  }

  /**
   * A QR code. Takes the payload verbatim — a PIX BR Code goes straight in.
   *
   * Bytes are written raw, bypassing the code page, because the scanner is what
   * decides how to read them.
   */
  qr(data: string, options: QrOptions = {}): this {
    return this.#push(qr(data, options));
  }

  /**
   * A raster image from RGBA pixels, dithered to one bit.
   *
   * Throws when the bitmap is wider than the paper: the printer would silently
   * clip the overflow, and a logo missing its right edge is easy to miss on a
   * proof and impossible to explain later. Scale before calling.
   */
  image(bitmap: Bitmap, options: ImageOptions = {}): this {
    if (bitmap.width > this.#profile.dots) {
      throw new RangeError(
        `bitmap is ${bitmap.width} dots wide; this profile prints ${this.#profile.dots}. Scale it down before printing.`,
      );
    }
    return this.#push(raster(bitmap, options));
  }

  // ── raw / output ─────────────────────────────────────────────────────────

  /** Feed blank lines. Defaults to the profile's tear-bar clearance. */
  feed(lines = this.#profile.feedLines): this {
    return this.#push(new Uint8Array(lines).fill(cmd.LF));
  }

  /** Escape hatch for commands this library does not model. */
  raw(bytes: Uint8Array | number[]): this {
    return this.#push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  }

  /** Pulse the cash drawer. */
  drawer(pin: 0 | 1 = 0): this {
    return this.#push(cmd.drawer(pin));
  }

  /** The complete payload. Pure — safe to call more than once. */
  encode(): Uint8Array {
    return cmd.concat(this.#chunks);
  }
}
