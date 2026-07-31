import { defineConfig } from 'tsdown';

// Subpath entries (./usb, ./cups, ./image, ./cli) land here as they are built —
// see the roadmap in the PRD. Keeping the list honest means `npm pack` never
// ships an export that resolves to nothing.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
});
