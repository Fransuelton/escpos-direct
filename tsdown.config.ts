import { defineConfig } from 'tsdown';

// Every entry here has a matching subpath in package.json, and nothing is
// declared there that is not built here — otherwise `npm pack` ships an export
// that resolves to nothing.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/usb.ts', 'src/cups.ts', 'src/file.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    treeshake: true,
  },
  // The CLI is an executable, not an import: ESM only, no types, and it may use
  // top-level await, which the CJS format cannot express.
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    treeshake: true,
  },
]);
