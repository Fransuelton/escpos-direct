# escpos-direct

ESC/POS thermal printing for Node and the browser, writing **straight to the USB
endpoint** — no CUPS, no print queue, no spooler mangling your bytes.

> 🇧🇷 [Leia em português](README.pt-BR.md) — including the "why won't my Mac
> print accents" section that started this project.

**Status: early.** The encoder core is done and tested; transports are landing
next. See [Roadmap](#roadmap).

```ts
import { Receipt, mm58 } from 'escpos-direct';

const receipt = new Receipt(mm58)
  .reset()                                   // ESC @, then ESC t — in that order
  .align('center').bold(true).line('MY SHOP').bold(false)
  .align('left').rule()
  .item('2x Coxinha', 'R$ 7,00')             // wraps on words, value right-aligned
  .item('1x Bolo de Pote - Ninho', 'R$ 18,00')
  .rule()
  .total('TOTAL', 'R$ 25,00')                // double size, columns halved for you
  .feed();                                   // clears the tear bar

const bytes = receipt.encode();              // Uint8Array — no hardware needed
```

## Why this exists

Getting a cheap thermal printer working on macOS is a trail of undocumented
traps. This library is the set of answers, learned the hard way running a real
point-of-sale system every day:

- **`ESC t` must come *after* `ESC @`.** The reset clears the code page
  selection, so sending them the other way round does nothing. This is the most
  common cause of garbled accents, and it is silent.
- **Encoding to CP850 is not the same as Latin-1.** `Buffer.from(s, 'latin1')`
  puts `ç` at `0xE7`; CP850 puts it at `0x87`. Node has no built-in CP850, so
  this library ships its own generated tables.
- **Double-width halves your columns.** A `TOTAL` padded to 32 columns while the
  printer is in double width lands off the edge of the paper. The builder tracks
  character size and does the math for you.
- **Most 58mm printers have no cutter.** Without trailing line feeds, the footer
  stops behind the tear bar and gets ripped through the middle.
- **Emoji are not printable.** They come out as `?` and clutter the receipt, so
  they are stripped — while accents are preserved.

## How it compares

| | `escpos-direct` | [`escpos`](https://npmjs.com/package/escpos) | [`node-thermal-printer`](https://npmjs.com/package/node-thermal-printer) | [`esc-pos-encoder`](https://npmjs.com/package/esc-pos-encoder) |
|---|---|---|---|---|
| Maintained | ✅ | ❌ alpha since 2022 | ✅ | ⚠️ 2024 |
| Direct USB endpoint | ✅ | ✅ | ❌ goes through the OS queue | ❌ no transport |
| Runs in the browser | ✅ WebUSB | ❌ | ❌ | ✅ encoder only |
| Reads printer status | ✅ `DLE EOT` | ❌ | ❌ | ❌ |
| Code page tables built in | ✅ 7 pages | ⚠️ | ⚠️ | ✅ |
| TypeScript types | ✅ | ❌ | ⚠️ | ✅ |
| Dependencies (core) | **0** | many | many | 0 |

## Install

```bash
npm install escpos-direct
```

The core has **zero dependencies** and compiles nothing. `usb` is an optional
dependency, pulled in only if you use the USB transport — and it ships
prebuilt binaries, so there is no native build step.

## Does direct USB actually work on macOS?

Yes — verified on macOS 26.5.2 (Apple Silicon), Node 24, against a YiDa YD583:
`claimInterface()` succeeds **without root and with the CUPS queue enabled**.

macOS does not bind an exclusive kernel driver to USB printer-class interfaces
the way Linux's `usblp` does, so there is nothing to detach. You can confirm it
on your own printer:

```bash
ioreg -p IOService -w0 -l -r -n "YOUR_PRINTER" | grep -E '\+-o |bInterfaceClass'
```

An `IOUSBHostInterface` with `bInterfaceClass = 7` and no child driver means the
interface is free to claim.

CUPS keeps working afterwards, as long as the interface is released — which the
transport does for you via `await using`.

## Roadmap

- [x] **M1** — encoder core: columns, wrapping, code pages, profiles
- [ ] **M2** — transports: USB (WebUSB), CUPS fallback, file
- [ ] **M3** — images (raster + dithering), QR codes (PIX), barcodes, `DLE EOT` status
- [ ] **M4** — CLI: `devices`, `doctor`, `test`, `print`, `preview`
- [ ] **M5** — v1.0

`examples/spike.mjs` and `examples/status.mjs` are the raw USB experiments the
design is based on; they run today against a real printer.

## Development

```bash
npm install
npm test              # 38 tests, no printer required
npm run typecheck
npm run build
npm run gen:codepages # regenerate code page tables from the system iconv
```

Layout logic is a pure function of its input, so almost everything is testable
without hardware. That is deliberate.

## License

MIT © Fransuelton
