import { describe, expect, it } from 'vitest';
import { raster, toMonochrome, type Bitmap } from '../src/image.js';
import { Receipt } from '../src/receipt.js';
import { mm58 } from '../src/profile.js';

/** Build an RGBA bitmap from a per-pixel grey value. */
function grey(width: number, height: number, value: (x: number, y: number) => number): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = value(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const BLACK = () => 0;
const WHITE = () => 255;

describe('raster command', () => {
  it('writes GS v 0 with width in bytes and height in rows', () => {
    const out = [...raster(grey(16, 3, WHITE))];
    expect(out.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 3, 0]);
    expect(out).toHaveLength(8 + 2 * 3);
  });

  it('packs eight pixels per byte, MSB first', () => {
    // Leftmost pixel black, rest white.
    const out = raster(grey(8, 1, (x) => (x === 0 ? 0 : 255)));
    expect(out[8]).toBe(0x80);
  });

  it('pads a row that is not a multiple of eight', () => {
    const out = [...raster(grey(9, 1, BLACK))];
    expect(out.slice(3, 8)).toEqual([0, 2, 0, 1, 0]); // 2 bytes per row
    expect(out.slice(8)).toEqual([0xff, 0x80]); // 9 dots set, 7 bits padding
  });

  it('fires every dot for black and none for white', () => {
    expect([...raster(grey(8, 1, BLACK))].slice(8)).toEqual([0xff]);
    expect([...raster(grey(8, 1, WHITE))].slice(8)).toEqual([0x00]);
  });

  it('encodes dimensions past 255 across both length bytes', () => {
    const out = raster(grey(8, 300, WHITE));
    expect([out[6], out[7]]).toEqual([300 & 0xff, 300 >> 8]);
  });
});

describe('monochrome conversion', () => {
  it('composites alpha over white, since the paper is white', () => {
    // Fully transparent black must read as white, not as black.
    const data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]);
    const pixels = toMonochrome({ width: 2, height: 1, data }, { dither: 'none' });
    expect(pixels).toEqual([false, true]);
  });

  it('honours the threshold for undithered output', () => {
    const mid = grey(1, 1, () => 100);
    expect(toMonochrome(mid, { dither: 'none', threshold: 50 })).toEqual([false]);
    expect(toMonochrome(mid, { dither: 'none', threshold: 150 })).toEqual([true]);
  });

  it('inverts when asked', () => {
    expect(toMonochrome(grey(1, 1, WHITE), { dither: 'none', invert: true })).toEqual([true]);
  });

  it('rejects a bitmap whose data does not match its dimensions', () => {
    const bad = { width: 4, height: 4, data: new Uint8Array(10) };
    expect(() => toMonochrome(bad)).toThrow(/needs 64/);
  });

  it('is deterministic for every dither', () => {
    const ramp = grey(16, 16, (x) => x * 16);
    for (const dither of ['none', 'bayer', 'atkinson', 'floyd-steinberg'] as const) {
      expect(toMonochrome(ramp, { dither })).toEqual(toMonochrome(ramp, { dither }));
    }
  });

  it('turns a flat mid-grey into a mix of dots, which is the whole point', () => {
    // A 50% grey has no threshold answer: undithered it is all-or-nothing,
    // dithered it should be roughly half the dots.
    const flat = grey(32, 32, () => 128);
    for (const dither of ['bayer', 'atkinson', 'floyd-steinberg'] as const) {
      const on = toMonochrome(flat, { dither }).filter(Boolean).length;
      expect(on).toBeGreaterThan(32 * 32 * 0.2);
      expect(on).toBeLessThan(32 * 32 * 0.8);
    }
  });

  it('keeps error diffusion inside the image', () => {
    // A bug in the neighbour bounds check shows up as a wrapped or dropped
    // edge column, which is invisible in a snapshot but obvious on paper.
    const ramp = grey(8, 8, (x, y) => (x + y) * 16);
    expect(toMonochrome(ramp, { dither: 'atkinson' })).toHaveLength(64);
  });
});

describe('on the receipt', () => {
  it('refuses a bitmap wider than the paper instead of letting it clip', () => {
    const wide = grey(400, 1, BLACK);
    expect(() => new Receipt(mm58).image(wide)).toThrow(/384/);
  });

  it('accepts one exactly the width of the paper', () => {
    expect(() => new Receipt(mm58).image(grey(mm58.dots, 1, WHITE))).not.toThrow();
  });

  it('chains and stays pure', () => {
    const r = new Receipt().image(grey(8, 8, BLACK));
    expect([...r.encode()]).toEqual([...r.encode()]);
  });
});
