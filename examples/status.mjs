/**
 * Does the printer answer DLE EOT (real-time status) on the IN endpoint?
 *
 *   node status.mjs
 *
 * If it does, the library can report "out of paper" with no CUPS involved —
 * something neither node-thermal-printer nor escpos offers.
 *
 * Measured on a YiDa YD583, macOS, 2026-07-30. Bits 1 and 4 are fixed at 1, so
 * 0x12 is the "everything fine" baseline:
 *
 *   query   closed, paper in   cover open   no paper, closed
 *   n=1     0x12               0x1a         0x1a
 *   n=2     0x12               0x32         0x32
 *   n=3     0x12               0x12         0x12
 *   n=4     0x12               0x72         0x72
 *
 * Note the second and third columns are identical. This printer never raises
 * the cover-open bit (0x04 on query 2) that the spec defines: opening the cover
 * lifts the paper sensor, and that sensor is the only one it has. Do not build
 * a UI that claims to tell the two apart.
 *
 * Requires the optional peer: `npm install usb`.
 */
import { WebUSB } from 'usb';

// Bit meanings from the ESC/POS spec. Bits 0 and 7 are fixed at 0, bits 1 and 4
// at 1 — everything below is what actually varies.
const BITS = {
  1: [
    [0x04, 'drawer kick-out pin 3 high'],
    [0x08, 'OFFLINE'],
    [0x20, 'waiting for online recovery'],
    [0x40, 'feed button pressed'],
  ],
  2: [
    [0x04, 'cover open'],
    [0x08, 'feeding by button'],
    [0x20, 'stopped: OUT OF PAPER'],
    [0x40, 'error'],
  ],
  3: [
    [0x08, 'cutter error'],
    [0x20, 'unrecoverable error'],
    [0x40, 'auto-recoverable error'],
  ],
  4: [
    [0x0c, 'paper near end'],
    [0x60, 'OUT OF PAPER'],
  ],
};

const webusb = new WebUSB({ allowAllDevices: true });
const dev = (await webusb.getDevices()).find(
  (d) => d.vendorId === 0x09c5 && d.productId === 0x583e,
);
if (!dev) {
  console.log('❌ printer not found');
  process.exit(1);
}

await dev.open();
if (!dev.configuration) await dev.selectConfiguration(1);
const alt = dev.configuration.interfaces[0].alternate;
await dev.claimInterface(0);

const OUT = alt.endpoints.find((e) => e.direction === 'out').endpointNumber;
const IN = alt.endpoints.find((e) => e.direction === 'in').endpointNumber;

/**
 * One query, with a retry.
 *
 * The first read came back cancelled once, with the printer offline, and
 * answered on the next attempt. One retry is cheap; a status call that reports
 * a healthy printer as unreachable is not.
 */
async function query(n, attempts = 2) {
  for (let i = 1; i <= attempts; i++) {
    await dev.transferOut(OUT, Buffer.from([0x10, 0x04, n])); // DLE EOT n
    try {
      const r = await Promise.race([
        dev.transferIn(IN, 64),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 1500ms')), 1500)),
      ]);
      return new Uint8Array(r.data.buffer)[0];
    } catch (e) {
      if (i === attempts) throw e;
    }
  }
}

console.log(`\nendpoints: OUT ${OUT} · IN ${IN}\n`);
console.log('  n  byte   baseline?  flags');
console.log('  ─────────────────────────────────────────────────');

for (const n of [1, 2, 3, 4]) {
  try {
    const b = await query(n);
    const flags = BITS[n].filter(([mask]) => (b & mask) === mask).map(([, label]) => label);
    // Mask off the fixed bits before comparing against the 0x12 baseline.
    const baseline = (b & 0x93) === 0x12 ? 'ok      ' : 'UNUSUAL ';
    console.log(
      `  ${n}  0x${b.toString(16).padStart(2, '0')}   ${baseline}   ${flags.join(' · ') || '—'}`,
    );
  } catch (e) {
    console.log(`  ${n}  —      —          no answer (${e.message})`);
  }
}

await dev.releaseInterface(0);
await dev.close();
console.log();
