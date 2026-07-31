/**
 * M0-b — a YD583 responde DLE EOT (status em tempo real) pelo endpoint IN?
 *
 * Se responder, a lib reporta "sem papel"/"tampa aberta" sem CUPS nenhum —
 * coisa que nem node-thermal-printer nem escpos fazem.
 */
import { WebUSB } from 'usb';

const webusb = new WebUSB({ allowAllDevices: true });
const dev = (await webusb.getDevices()).find((d) => d.vendorId === 0x09c5 && d.productId === 0x583e);
if (!dev) { console.log('❌ YD583 ausente'); process.exit(1); }

await dev.open();
if (!dev.configuration) await dev.selectConfiguration(1);
const alt = dev.configuration.interfaces[0].alternate;
await dev.claimInterface(0);

const OUT = alt.endpoints.find((e) => e.direction === 'out').endpointNumber;
const IN = alt.endpoints.find((e) => e.direction === 'in').endpointNumber;

const CONSULTAS = [
  [1, 'status da impressora', (b) => [[0x08, 'gaveta aberta'], [0x20, 'tampa aberta'], [0x40, 'alimentando papel']]],
  [2, 'status offline',       () => [[0x04, 'tampa aberta'], [0x20, 'SEM PAPEL'], [0x40, 'erro']]],
  [3, 'status de erro',       () => [[0x08, 'erro de guilhotina'], [0x20, 'erro irrecuperável'], [0x40, 'erro auto-recuperável']]],
  [4, 'sensor de papel',      () => [[0x0c, 'papel acabando'], [0x60, 'SEM PAPEL']]],
];

console.log(`\nendpoints: OUT ${OUT} · IN ${IN}\n`);

for (const [n, rotulo, bits] of CONSULTAS) {
  await dev.transferOut(OUT, Buffer.from([0x10, 0x04, n])); // DLE EOT n
  try {
    const r = await Promise.race([
      dev.transferIn(IN, 64),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 1500ms')), 1500)),
    ]);
    const b = new Uint8Array(r.data.buffer)[0];
    const flags = bits().filter(([m]) => (b & m) === m).map(([, t]) => t);
    console.log(`  DLE EOT ${n} (${rotulo}): 0x${b.toString(16).padStart(2, '0')} ${flags.length ? '→ ' + flags.join(', ') : '→ ok'}`);
  } catch (e) {
    console.log(`  DLE EOT ${n} (${rotulo}): sem resposta (${e.message})`);
  }
}

await dev.releaseInterface(0);
await dev.close();
console.log();
