import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/cli/context.js';
import { fromText, render } from '../src/cli/document.js';
import { frame } from '../src/cli/preview.js';
import { testPage } from '../src/cli/test-page.js';
import { mm58, mm80 } from '../src/profile.js';

describe('profile resolution', () => {
  it('defaults to 58mm', () => {
    expect(resolveProfile({})).toEqual(mm58);
  });

  it('takes a named profile and a code page override', () => {
    expect(resolveProfile({ profile: 'mm80' })).toEqual(mm80);
    expect(resolveProfile({ codepage: 'cp860' }).codePage).toBe('cp860');
  });

  it('names the valid options when given a bad one', () => {
    expect(() => resolveProfile({ profile: 'mm99' })).toThrow(/mm58 or mm80/);
    expect(() => resolveProfile({ codepage: 'utf8' })).toThrow(/known: /);
  });
});

describe('text to receipt', () => {
  it('wraps each line to the paper width', () => {
    const long = 'palavra '.repeat(20).trim();
    for (const line of render(fromText(long, mm58).encode(), mm58)) {
      expect(line.length).toBeLessThanOrEqual(mm58.columns);
    }
  });

  it('keeps blank lines, which carry layout', () => {
    expect(render(fromText('a\n\nb', mm58).encode(), mm58).slice(0, 3)).toEqual(['a', '', 'b']);
  });

  it('preserves runs of spaces on lines that fit', () => {
    // Someone who aligned a receipt by hand in a text editor expects it back.
    const aligned = '2x Coxinha          R$ 7,00';
    expect(render(fromText(aligned, mm58).encode(), mm58)[0]).toBe(aligned);
  });

  it('renders through the code page, not latin1', () => {
    // Read as latin1 this ê (0x88) would be a control character — the exact bug
    // the library exists to prevent, so the preview must not commit it either.
    expect(render(fromText('três', mm58).encode(), mm58)[0]).toBe('três');
  });
});

describe('preview frame', () => {
  it('draws a ruler as wide as the paper', () => {
    const [top] = frame([], mm58);
    expect(top).toContain('-'.repeat(4) + '+');
    // Border, padding, the paper itself, padding, border.
    // oxlint-disable-next-line no-control-regex -- ESC is what colour codes are
    expect(top!.replace(/\x1b\[\d+m/g, '')).toHaveLength(mm58.columns + 4);
  });

  it('flags a line that overflows, instead of wrapping it quietly', () => {
    const over = 'x'.repeat(mm58.columns + 5);
    const rendered = frame([over], mm58).join('\n');
    expect(rendered).toContain(`← ${over.length}`);
  });
});

describe('test page', () => {
  it('is a pure function of the profile', () => {
    expect([...testPage(mm58)]).toEqual([...testPage(mm58)]);
  });

  it('adapts to the profile it is given', () => {
    expect(testPage(mm80).length).not.toBe(testPage(mm58).length);
    expect(render(testPage(mm58), mm58).some((l) => l.includes('32 columns'))).toBe(true);
  });

  it('includes a ruler exactly as wide as the paper', () => {
    const ruler = render(testPage(mm58), mm58).find((l) => l.startsWith('1234567890'));
    expect(ruler).toHaveLength(mm58.columns);
  });
});
