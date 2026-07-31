/**
 * M0 — spike de viabilidade: dá para reivindicar a interface da YD583 e
 * escrever ESC/POS direto no endpoint, no macOS, sem root?
 *
 *   node spike.mjs          # só diagnostica, não escreve nada
 *   node spike.mjs --write  # imprime de verdade (gasta papel)
 *
 * node-usb 3.x expõe SÓ a API WebUSB — a legada (getDeviceList/findByIds) saiu.
 */
import { WebUSB } from 'usb';

const VID = 0x09c5, PID = 0x583e;
const ESCREVER = process.argv.includes('--write');

const ok = (m) => console.log(`  ✅ ${m}`);
const nok = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);

console.log(`\nnode ${process.version} · ${process.platform}/${process.arch} · root=${process.getuid() === 0}`);
console.log(`node-usb ${(await import('usb/package.json', { with: { type: 'json' } })).default.version}\n`);

// ── 1. enumerar ────────────────────────────────────────────────────────────
console.log('1) enumerar barramento');
const webusb = new WebUSB({ allowAllDevices: true });
const todos = await webusb.getDevices();
ok(`getDevices() → ${todos.length} dispositivos`);

const dev = todos.find((d) => d.vendorId === VID && d.productId === PID);
if (!dev) {
  nok('YD583 (09c5:583e) não encontrada');
  process.exit(1);
}
ok(`YD583: "${dev.manufacturerName ?? '?'} ${dev.productName ?? '?'}" serial=${dev.serialNumber ?? '?'}`);

// ── 2. abrir ───────────────────────────────────────────────────────────────
console.log('\n2) open() sem root');
try {
  await dev.open();
  ok('open() passou');
} catch (e) {
  nok(`open() falhou: ${e.message}`);
  info('→ USB direto exigiria root/entitlement. Tese do PRD em risco.');
  process.exit(2);
}

if (!dev.configuration) await dev.selectConfiguration(1);
ok(`configuração ${dev.configuration.configurationValue} selecionada`);

// ── 3. interface e endpoints ───────────────────────────────────────────────
console.log('\n3) interface e endpoints');
const iface = dev.configuration.interfaces[0];
const alt = iface.alternate;
info(`interface ${iface.interfaceNumber}: class=${alt.interfaceClass} sub=${alt.interfaceSubclass} proto=${alt.interfaceProtocol}`);
if (alt.interfaceClass === 7) ok('classe 7 = impressora, como o ioreg mostrou');

for (const ep of alt.endpoints) {
  info(`endpoint ${ep.endpointNumber} ${ep.direction} ${ep.type} packetSize=${ep.packetSize}`);
}

// ── 4. claim ───────────────────────────────────────────────────────────────
console.log('\n4) claimInterface() — o teste que decide o projeto');
try {
  await dev.claimInterface(iface.interfaceNumber);
  ok('claim PASSOU sem root, com a fila CUPS habilitada');
} catch (e) {
  nok(`claim falhou: ${e.message}`);
  info('→ testar: cupsdisable YiDa_YD583 → sudo → lpadmin -x');
  await dev.close();
  process.exit(3);
}

// ── 5. escrever ────────────────────────────────────────────────────────────
console.log('\n5) escrita no endpoint bulk OUT');
const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
if (!out) { nok('sem endpoint bulk OUT'); process.exit(4); }
ok(`endpoint OUT ${out.endpointNumber}`);

// CP850 só para o teste — a lib terá tabela de verdade (ADR-02).
const CP850 = { á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, â: 0x83, ê: 0x88, ô: 0x93, ã: 0xc6, õ: 0xe4, ç: 0x87, Ç: 0x80 };
const cp850 = (s) => Buffer.from([...s].map((c) => CP850[c] ?? c.charCodeAt(0)));

const payload = Buffer.concat([
  Buffer.from([0x1b, 0x40]),        // ESC @  reset
  Buffer.from([0x1b, 0x74, 0x02]),  // ESC t 2 = CP850, DEPOIS do reset (A2)
  cp850('ESCPOS-DIRECT / M0\n'),
  cp850('--------------------------------\n'),
  cp850('Acentuação: ção nao é açaí\n'),
  cp850('Coração, pão, ôvo, Ç\n'),
  cp850('--------------------------------\n'),
  cp850('claim sem root: OK\n'),
  cp850('sem CUPS no caminho\n'),
  Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]), // sem guilhotina (A5)
]);

if (!ESCREVER) {
  info(`payload de ${payload.length} bytes pronto — rode com --write para imprimir`);
} else {
  const r = await dev.transferOut(out.endpointNumber, payload);
  ok(`transferOut → status=${r.status}, ${r.bytesWritten}/${payload.length} bytes, direto no endpoint`);
}

// ── 6. liberar ─────────────────────────────────────────────────────────────
console.log('\n6) liberar');
await dev.releaseInterface(iface.interfaceNumber);
await dev.close();
ok('released + closed');
console.log(`\n${ESCREVER ? '🎯' : '🔎'} claim sem root: VIÁVEL no macOS ${process.platform}.\n`);
