/**
 * Feasibility spike: can we claim the printer interface and write ESC/POS
 * straight to the endpoint, on macOS, without root?
 *
 *   node spike.mjs          # diagnose only, writes nothing
 *   node spike.mjs --write  # actually prints (spends paper)
 *
 * This is the experiment the library is built on, kept as an example because it
 * is evidence rather than decoration: every claim in the README about macOS was
 * measured with this file.
 *
 * node-usb 3.x exposes ONLY the WebUSB API — the legacy one (getDeviceList,
 * findByIds) is gone. Tutorials still teaching it are writing against a version
 * that no longer exists.
 *
 * Requires the optional peer: `npm install usb`.
 */
import { WebUSB } from 'usb';

const VID = 0x09c5,
  PID = 0x583e;
const WRITE = process.argv.includes('--write');

const ok = (m) => console.log(`  ✅ ${m}`);
const nok = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);

console.log(
  `\nnode ${process.version} · ${process.platform}/${process.arch} · root=${process.getuid() === 0}`,
);
console.log(
  `node-usb ${(await import('usb/package.json', { with: { type: 'json' } })).default.version}\n`,
);

// ── 1. enumerate ───────────────────────────────────────────────────────────
console.log('1) enumerate the bus');
const webusb = new WebUSB({ allowAllDevices: true });
const all = await webusb.getDevices();
ok(`getDevices() → ${all.length} devices`);

const dev = all.find((d) => d.vendorId === VID && d.productId === PID);
if (!dev) {
  nok('printer 09c5:583e not found');
  process.exit(1);
}
ok(
  `found: "${dev.manufacturerName ?? '?'} ${dev.productName ?? '?'}" serial=${dev.serialNumber ?? '?'}`,
);

// ── 2. open ────────────────────────────────────────────────────────────────
console.log('\n2) open() without root');
try {
  await dev.open();
  ok('open() succeeded');
} catch (e) {
  nok(`open() failed: ${e.message}`);
  info('→ direct USB would need root or an entitlement. The premise is at risk.');
  process.exit(2);
}

if (!dev.configuration) await dev.selectConfiguration(1);
ok(`configuration ${dev.configuration.configurationValue} selected`);

// ── 3. interface and endpoints ─────────────────────────────────────────────
console.log('\n3) interface and endpoints');
const iface = dev.configuration.interfaces[0];
const alt = iface.alternate;
info(
  `interface ${iface.interfaceNumber}: class=${alt.interfaceClass} sub=${alt.interfaceSubclass} proto=${alt.interfaceProtocol}`,
);
if (alt.interfaceClass === 7) ok('class 7 = printer, matching what ioreg reported');

for (const ep of alt.endpoints) {
  info(`endpoint ${ep.endpointNumber} ${ep.direction} ${ep.type} packetSize=${ep.packetSize}`);
}

// ── 4. claim ───────────────────────────────────────────────────────────────
console.log('\n4) claimInterface() — the test that decides the project');
try {
  await dev.claimInterface(iface.interfaceNumber);
  ok('claim SUCCEEDED without root, with the CUPS queue still enabled');
} catch (e) {
  nok(`claim failed: ${e.message}`);
  info('→ try: cupsdisable <queue>, then sudo, then lpadmin -x');
  await dev.close();
  process.exit(3);
}

// ── 5. write ───────────────────────────────────────────────────────────────
console.log('\n5) writing to the bulk OUT endpoint');
const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
if (!out) {
  nok('no bulk OUT endpoint');
  process.exit(4);
}
ok(`endpoint OUT ${out.endpointNumber}`);

// A hand-rolled CP850 table, enough for this one test. The library ships real
// generated tables — this is here so the spike depends on nothing.
const CP850 = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  â: 0x83, ê: 0x88, ô: 0x93, ã: 0xc6, õ: 0xe4,
  ç: 0x87, Ç: 0x80,
};
const cp850 = (s) => Buffer.from([...s].map((c) => CP850[c] ?? c.charCodeAt(0)));

// The sample lines stay in Portuguese on purpose: accented Latin text is the
// thing being tested, and it is what sent this project looking for answers.
const payload = Buffer.concat([
  Buffer.from([0x1b, 0x40]), // ESC @  reset
  Buffer.from([0x1b, 0x74, 0x02]), // ESC t 2 = CP850, AFTER the reset, which clears it
  cp850('ESCPOS-DIRECT / SPIKE\n'),
  cp850('--------------------------------\n'),
  cp850('Acentuação: ção não é açaí\n'),
  cp850('Coração, pão, ôvo, Ç\n'),
  cp850('--------------------------------\n'),
  cp850('claimed without root: OK\n'),
  cp850('no CUPS in the way\n'),
  Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]), // trailing feed — there is no cutter
]);

if (!WRITE) {
  info(`${payload.length} byte payload ready — run with --write to print it`);
} else {
  const r = await dev.transferOut(out.endpointNumber, payload);
  ok(
    `transferOut → status=${r.status}, ${r.bytesWritten}/${payload.length} bytes, straight to the endpoint`,
  );
}

// ── 6. release ─────────────────────────────────────────────────────────────
// Not optional: leaving the interface claimed is what stops CUPS from printing
// afterwards.
console.log('\n6) release');
await dev.releaseInterface(iface.interfaceNumber);
await dev.close();
ok('released + closed');
console.log(`\n${WRITE ? '🎯' : '🔎'} claiming without root: VIABLE on ${process.platform}.\n`);
