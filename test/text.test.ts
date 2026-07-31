import { describe, expect, it } from 'vitest';
import { itemLines, pad, sanitize, truncate, wrap } from '../src/text.js';

describe('sanitize', () => {
  it('keeps accents, which the code page can represent', () => {
    expect(sanitize('Coração, pão, açaí')).toBe('Coração, pão, açaí');
  });

  it('drops emoji rather than letting them print as ?', () => {
    expect(sanitize('Bolo 🎂 de Pote')).toBe('Bolo  de Pote');
    expect(sanitize('👨‍👩‍👧 familia')).toBe('familia');
  });

  it('drops control characters but keeps newlines', () => {
    expect(sanitize('a\x07b\nc')).toBe('ab\nc');
  });

  it('normalizes to NFC so combining marks do not eat a column', () => {
    // "á" as a + combining acute -> single code point
    expect(sanitize('água')).toBe('água');
    expect(sanitize('água')).toHaveLength(4);
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Coxinha', 32)).toBe('Coxinha');
  });

  it('uses ASCII dots, because CP850 has no ellipsis character', () => {
    const out = truncate('Bolo de Pote com Doce de Leite', 20);
    // 19, not 20: the trailing space before the dots is trimmed, which reads
    // better than "Bolo de Pote com ...".
    expect(out).toBe('Bolo de Pote com...');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).not.toContain('…');
  });

  it('never exceeds the limit', () => {
    for (const n of [1, 2, 3, 4, 5, 10]) {
      expect(truncate('abcdefghijklmnop', n).length).toBeLessThanOrEqual(n);
    }
  });
});

describe('wrap', () => {
  it('breaks on word boundaries', () => {
    expect(wrap('Bolo de Pote - Doce de Leite', 16)).toEqual([
      'Bolo de Pote -',
      'Doce de Leite',
    ]);
  });

  it('force-breaks a word longer than the line', () => {
    // Without the force-break the loop pushes the long word to a fresh line
    // that also overflows, and never makes progress.
    const lines = wrap('supercalifragilistic', 8);
    expect(lines.every((l) => l.length <= 8)).toBe(true);
    expect(lines.join('')).toBe('supercalifragilistic');
  });

  it('never returns an empty array', () => {
    expect(wrap('', 32)).toEqual(['']);
    expect(wrap('   ', 32)).toEqual(['']);
  });
});

describe('pad', () => {
  it('pushes the value to the right margin', () => {
    expect(pad('Troco', 'R$ 5,00', 32)).toBe('Troco                    R$ 5,00');
    expect(pad('Troco', 'R$ 5,00', 32)).toHaveLength(32);
  });

  it('keeps one space when the pair overflows', () => {
    const out = pad('A'.repeat(30), 'R$ 1.234,56', 32);
    expect(out).toContain(' R$ 1.234,56');
  });
});

describe('itemLines', () => {
  it('right-aligns the value on the last line when it fits', () => {
    expect(itemLines('2x Coxinha', 'R$ 7,00', 32)).toEqual([
      '2x Coxinha               R$ 7,00',
    ]);
  });

  it('wraps a long description and keeps the value aligned', () => {
    const lines = itemLines('1x Bolo de Pote - Ninho com Nutella', 'R$ 22,00', 32);
    expect(lines.every((l) => l.length <= 32)).toBe(true);
    expect(lines[lines.length - 1]!.endsWith('R$ 22,00')).toBe(true);
  });

  it('puts the value on its own line when the last line leaves no room', () => {
    // 40 chars with no spaces at width 20 force-breaks into two full lines,
    // so the value cannot share the last one.
    const lines = itemLines('A'.repeat(40), 'R$ 1.234,56', 20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.trim()).toBe('R$ 1.234,56');
  });

  it('keeps the value on the last line when it does fit there', () => {
    const lines = itemLines('Superlongoitemsemespaco', 'R$ 1.234,56', 20);
    expect(lines).toEqual(['Superlongoitemsemesp', 'aco      R$ 1.234,56']);
  });
});
