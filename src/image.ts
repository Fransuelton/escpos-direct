import { GS } from './commands.js';

/**
 * Raw RGBA pixels, four bytes each, row by row.
 *
 * Deliberately the same shape as the browser's `ImageData`, so a canvas goes
 * straight in. Decoding PNG or JPEG is not this library's job — that would cost
 * a native dependency and the promise that the core runs anywhere.
 */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type Dither = 'none' | 'atkinson' | 'floyd-steinberg' | 'bayer';

export interface ImageOptions {
  /** Defaults to `atkinson`, which stays clean on thermal paper. */
  dither?: Dither;
  /** Cut-off for `none`, 0–255. */
  threshold?: number;
  invert?: boolean;
}

/** Rec. 709 luma, alpha composited over white because the paper is white. */
function luminance(data: Uint8Array | Uint8ClampedArray, at: number): number {
  const a = data[at + 3]! / 255;
  const v = 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
  return v * a + 255 * (1 - a);
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Error diffusion kernels: [dx, dy, weight] over a shared divisor. */
const KERNELS = {
  'floyd-steinberg': {
    divisor: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  atkinson: {
    // Only 6/8 of the error is propagated, which is why Atkinson keeps
    // contrast instead of smearing mid-tones into grey mush.
    divisor: 8,
    taps: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  },
} as const;

/**
 * Bitmap to one bit per pixel, `true` meaning a fired dot.
 *
 * Exposed because a terminal preview wants the same pixels the printer gets.
 */
export function toMonochrome(bitmap: Bitmap, options: ImageOptions = {}): boolean[] {
  const { width, height } = bitmap;
  const expected = width * height * 4;
  if (bitmap.data.length !== expected) {
    throw new RangeError(
      `bitmap is ${bitmap.data.length} bytes; ${width}×${height} RGBA needs ${expected}`,
    );
  }

  const dither = options.dither ?? 'atkinson';
  const threshold = options.threshold ?? 128;
  const out: boolean[] = Array.from({ length: width * height });

  if (dither === 'none' || dither === 'bayer') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = luminance(bitmap.data, (y * width + x) * 4);
        const cut = dither === 'bayer' ? ((BAYER_4X4[y & 3]![x & 3]! + 0.5) / 16) * 255 : threshold;
        out[y * width + x] = value < cut;
      }
    }
    return options.invert ? out.map((on) => !on) : out;
  }

  // Error diffusion needs a mutable copy: each decision changes its neighbours.
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) grey[i] = luminance(bitmap.data, i * 4);

  const { divisor, taps } = KERNELS[dither];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = grey[i]!;
      const on = old < 128;
      out[i] = on;
      const error = old - (on ? 0 : 255);
      for (const [dx, dy, weight] of taps) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        grey[ny * width + nx]! += (error * weight) / divisor;
      }
    }
  }

  return options.invert ? out.map((on) => !on) : out;
}

/**
 * `GS v 0` — a raster bit image.
 *
 * Rows are padded to whole bytes, MSB first, because the command addresses
 * pixels eight at a time.
 */
export function raster(bitmap: Bitmap, options: ImageOptions = {}): Uint8Array {
  const { width, height } = bitmap;
  if (width < 1 || height < 1) throw new RangeError('bitmap has no pixels');

  const pixels = toMonochrome(bitmap, options);
  const bytesPerRow = Math.ceil(width / 8);
  const body = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[y * width + x]) continue;
      body[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }

  return Uint8Array.from([
    GS,
    0x76,
    0x30,
    0,
    bytesPerRow & 0xff,
    bytesPerRow >> 8,
    height & 0xff,
    height >> 8,
    ...body,
  ]);
}
