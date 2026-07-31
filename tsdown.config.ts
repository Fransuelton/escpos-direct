import { defineConfig } from 'tsdown';

// Every entry here has a matching subpath in package.json, and nothing is
// declared there that is not built here — otherwise `npm pack` ships an export
// that resolves to nothing. ./image and ./cli join the list with M3 and M4.
export default defineConfig({
  entry: ['src/index.ts', 'src/usb.ts', 'src/cups.ts', 'src/file.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
});
