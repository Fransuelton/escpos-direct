/**
 * Column math and text fitting for fixed-width thermal paper.
 *
 * No I/O, no printer, no encoding decisions — just strings in, strings out, so
 * every layout rule can be tested without burning paper.
 *
 * Ported from a POS system that has been printing receipts daily since 2025;
 * each rule here exists because of a real bug on real paper.
 */

/**
 * Drop emoji and control characters, keeping accents.
 *
 * Emoji have no glyph in any ESC/POS code page, so they print as `?` and
 * clutter the receipt — better that they vanish. Accents stay: that is what
 * the code page is for.
 *
 * `So` = other symbol (most emoji), `Cs` = surrogate, `Cf` = format
 * (ZWJ, variation selectors), `Cc` = control — except `\n`, handled downstream.
 */
export function sanitize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\p{So}\p{Cs}\p{Cf}]/gu, '')
    .replace(/[^\n\P{Cc}]/gu, '')
    .trim();
}

/**
 * Cut with an ellipsis, using ASCII `...` rather than `…`.
 *
 * CP850 has no `…` and it would print as `?`. CP1252 does have it, but the
 * default is CP850, so ASCII is the safe choice everywhere.
 */
export function truncate(text: string, limit: number): string {
  const t = text.trim();
  if (limit <= 0) return '';
  if (t.length <= limit) return t;
  if (limit <= 3) return t.slice(0, limit);
  return t.slice(0, limit - 3).trimEnd() + '...';
}

/**
 * Wrap on word boundaries, force-breaking words longer than the line.
 *
 * The force-break is not an edge case: without it, an over-long word gets
 * pushed to a fresh line that also overflows, and the loop makes no progress.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const lines: string[] = [];
  let current = '';

  for (let word of sanitize(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (current.length + word.length + (current ? 1 : 0) <= width) {
      current = current ? `${current} ${word}` : word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Label left, value right, on one line. Always keeps at least one space
 * between them, even when that overflows — a joined `Total12,00` is worse to
 * read than a wrapped line.
 */
export function pad(label: string, value: string, width: number): string {
  const gap = Math.max(1, width - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}

/**
 * Description wrapped on words, with the value right-aligned on the last line
 * when it fits there, or on a line of its own when it does not.
 *
 * With product variants the description got long ("2x Bolo de Pote - Doce de
 * Leite" is 31 chars), so wrapping is the normal path here, not the exception.
 */
export function itemLines(description: string, value: string, width: number): string[] {
  const lines = wrap(description, width);
  const last = lines[lines.length - 1]!;

  if (last.length + 1 + value.length <= width) {
    lines[lines.length - 1] = last + ' '.repeat(width - last.length - value.length) + value;
  } else {
    lines.push(' '.repeat(Math.max(0, width - value.length)) + value);
  }
  return lines;
}
