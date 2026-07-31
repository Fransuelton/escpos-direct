import { describe, expect, it } from 'vitest';
import { Receipt } from '../src/receipt.js';
import { mm58, mm80 } from '../src/profile.js';
import { decode } from '../src/codepage/index.js';

/**
 * Strip ESC/POS control sequences and decode the rest, so a test can read the
 * text that actually prints.
 *
 * Decoding through the code page matters: reading the bytes as latin1 turns
 * CP850's "ê" (0x88) into a control character. That is the very bug this
 * library exists to prevent, so the test helper must not commit it.
 */
function plain(bytes: Uint8Array, page = mm58.codePage): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      // ESC @ is two bytes; ESC x n is three.
      i += bytes[i + 1] === 0x40 ? 1 : 2;
    } else if (b === 0x1d) {
      i += 2;
    } else {
      out.push(b);
    }
  }
  return decode(Uint8Array.from(out), page);
}

describe('reset and code page ordering', () => {
  it('sends ESC t AFTER ESC @, never before', () => {
    const bytes = new Receipt(mm58).reset().encode();
    expect([...bytes]).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
  });

  it('re-selects the page on every reset, because the reset clears it', () => {
    const bytes = new Receipt(mm58).reset().reset().encode();
    const escT = [...bytes].filter((_, i) => bytes[i] === 0x1b && bytes[i + 1] === 0x74);
    expect(escT).toHaveLength(2);
  });

  it('keeps a switched page across a later reset', () => {
    const bytes = new Receipt(mm58).codepage('cp860').reset().encode();
    expect([...bytes].slice(-3)).toEqual([0x1b, 0x74, 3]);
  });
});

describe('column tracking', () => {
  it('halves the columns at double width', () => {
    const r = new Receipt(mm58);
    expect(r.columns).toBe(32);
    r.size(2);
    expect(r.columns).toBe(16);
    r.size(1);
    expect(r.columns).toBe(32);
  });

  it('aligns TOTAL against the halved width, not the full one', () => {
    // The classic bug: padding "TOTAL" to 32 columns while the printer is in
    // double width pushes the value off the right edge of the paper.
    const text = plain(new Receipt(mm58).total('TOTAL', 'R$ 29,00').encode()).trim();
    expect(text).toHaveLength(16);
    expect(text).toBe('TOTAL   R$ 29,00');
  });

  it('follows the profile for 80mm paper', () => {
    expect(new Receipt(mm80).columns).toBe(48);
    expect(plain(new Receipt(mm80).rule().encode()).trim()).toHaveLength(48);
  });
});

describe('content', () => {
  it('wraps a long item and keeps every line within the paper', () => {
    const out = plain(
      new Receipt(mm58).item('1x Bolo de Pote - Ninho com Nutella', 'R$ 22,00').encode(),
    );
    for (const l of out.split('\n').filter(Boolean)) {
      expect(l.length).toBeLessThanOrEqual(32);
    }
  });

  it('indents sub-lines and prints no value on them', () => {
    const out = plain(new Receipt(mm58).sub('30x Coxinha').encode());
    expect(out).toBe('  30x Coxinha\n');
  });

  it('keeps sub-line indentation, which a naive trim would eat', () => {
    expect(plain(new Receipt(mm58).sub('Kibe', 4).encode())).toBe('    Kibe\n');
  });

  it('splits multi-line input into real lines', () => {
    const out = plain(new Receipt(mm58).line('Obrigada pela\npreferência!').encode());
    expect(out).toBe('Obrigada pela\npreferência!\n');
  });

  it('feeds the profile default, since there is no cutter', () => {
    const bytes = new Receipt(mm58).feed().encode();
    expect([...bytes]).toEqual([0x0a, 0x0a, 0x0a, 0x0a]);
  });
});

describe('encode()', () => {
  it('is pure — calling twice gives the same bytes', () => {
    const r = new Receipt(mm58).reset().line('Recibo').feed();
    expect([...r.encode()]).toEqual([...r.encode()]);
  });

  it('produces a stable payload for a full receipt', () => {
    const r = new Receipt(mm58)
      .reset()
      .align('center')
      .bold(true)
      .line('DOCES & SALGADOS')
      .bold(false)
      .align('left')
      .rule()
      .item('2x Coxinha', 'R$ 7,00')
      .item('1x Cento de Salgados', 'R$ 90,00')
      .sub('30x Coxinha')
      .sub('70x Risole')
      .rule()
      .total('TOTAL', 'R$ 97,00')
      .feed();

    expect(plain(r.encode())).toMatchInlineSnapshot(`
      "DOCES & SALGADOS
      --------------------------------
      2x Coxinha               R$ 7,00
      1x Cento de Salgados    R$ 90,00
        30x Coxinha
        70x Risole
      --------------------------------
      TOTAL   R$ 97,00




      "
    `);
  });
});
