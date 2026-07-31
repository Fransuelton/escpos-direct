# escpos-direct

ESC/POS thermal printing for Node and the browser, writing **straight to the USB
endpoint** — no CUPS, no print queue, no spooler mangling your bytes.

> 🇧🇷 [Leia em português](README.pt-BR.md) — including the "why won't my Mac
> print accents" section that started this project.

**Status: early.** The encoder core and the transports are done and tested;
images, barcodes and the CLI are next. See [Roadmap](#roadmap).

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

Then send it:

```ts
import { UsbTransport } from 'escpos-direct/usb';

await using printer = await UsbTransport.open();
await printer.write(bytes);
```

## CLI

```bash
npx escpos-direct doctor           # why won't it print on this machine?
npx escpos-direct devices          # list USB devices, flag printer interfaces
npx escpos-direct test             # test page: accents, ruler, styles, codes
npx escpos-direct print nota.txt   # or - for stdin
npx escpos-direct preview nota.txt # render in the terminal, to scale
```

`doctor` is the reason this exists. It walks the environment, the USB backend,
the devices, the claim, the live status and the CUPS queues, and every failure
carries the hint for that platform:

```
Claim
✓ Claimed interface 0 without root

Status
✓ Printer reports ready
· printer=0x12 offline=0x12 error=0x12 paper=0x12
```

`preview` frames the receipt at paper width and marks any line that overflows,
decoding through the code page so a wrong one shows up before it costs paper.
Add `--file out.bin` to any printing command to write bytes instead of paper, or
`--cups <queue>` to go through CUPS.

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
| Reads printer status | ✅ [`DLE EOT`](#printer-status-measured-first) | ❌ | ❌ | ❌ |
| Code page tables built in | ✅ 7 pages | ⚠️ | ⚠️ | ✅ |
| TypeScript types | ✅ | ❌ | ⚠️ | ✅ |
| Dependencies (core) | **0** | many | many | 0 |

## Install

```bash
npm install escpos-direct            # encoder only — nothing else comes with it
npm install escpos-direct usb        # ...plus the USB transport
```

The core has **zero dependencies** and compiles nothing. `usb` is an *optional
peer*: you install it yourself, and only if you print over USB. Nobody
generating bytes in a browser downloads a native module they will never load.

It ships prebuilt binaries, so adding it is still not a build step.

## Transports

The encoder is pure and the delivery is swappable, so choosing a transport
never changes how a receipt is built.

| Import | How it prints | When to use it |
|---|---|---|
| `escpos-direct/usb` | Bulk endpoint via WebUSB | The default. Same file runs in Chrome — pass `{ usb: navigator.usb }` |
| `escpos-direct/cups` | `lp -o raw` | Where claiming the interface fails: Windows, Linux without a udev rule, shared queues |
| `escpos-direct/file` | Writes to a path | `/dev/usb/lp0` on Linux, or capturing a payload to diff |

`await using` is not sugar. It releases the interface when the block ends, and
releasing is the condition for CUPS to keep working afterwards — without it, one
thrown exception leaves the printer claimed until the process dies.

```ts
await using printer = await UsbTransport.open({ vendorId: 0x09c5 });
await printer.write(bytes);
```

### Errors tell you what to do next

Every failure is an `EscposError` with a `code` your program can branch on, a
`cause` for the log, and a **`hint` for the human** — the platform-specific
sentence that would otherwise cost an afternoon:

```ts
import { isEscposError } from 'escpos-direct';

try {
  await using printer = await UsbTransport.open();
  await printer.write(bytes);
} catch (e) {
  if (!isEscposError(e)) throw e;
  console.error(e.code);     // 'CLAIM_FAILED'
  console.error(e.format()); // ...and, on Linux: "The kernel `usblp` driver
                             //    usually holds the interface: sudo modprobe -r usblp"
}
```

Codes: `DEVICE_NOT_FOUND`, `CLAIM_FAILED`, `OUT_OF_PAPER`, `OFFLINE`,
`WRITE_FAILED`, `UNSUPPORTED`.

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

## Images

```ts
receipt.align('center').image(logo, { dither: 'atkinson' });
```

Takes raw RGBA pixels — the same shape as the browser's `ImageData`, so a canvas
goes straight in. Decoding PNG or JPEG is not the core's job: that would cost a
native dependency and the promise that it runs anywhere.

| Dither | Use it for |
|---|---|
| `atkinson` (default) | Logos and line art — highest contrast |
| `floyd-steinberg` | Photographs and smooth gradients |
| `bayer` | Fast, regular crosshatch texture |
| `none` | Already-black-and-white input |

**Atkinson propagates only 6/8 of the error and discards the rest.** That is what
keeps contrast high, and it is also why it drops detail at the extremes: printed
against a full gradient, Atkinson stops placing dots near the pale end while
Floyd-Steinberg carries all the way through. Contrast is the right trade for a
logo; detail is the right trade for a photograph.

An image wider than the paper throws rather than printing, since the printer
would silently clip it and a logo missing its right edge survives a proof read.

## Barcodes and QR codes

```ts
receipt
  .barcode('789123456789', { symbology: 'ean13', hri: 'below', height: 60 })
  .qr(pixPayload, { size: 6, correction: 'M' });
```

Nine symbologies (`code128` by default, plus EAN-13/8, UPC-A/E, CODE39, CODE93,
ITF and Codabar), with control over height, module width and where the
human-readable digits go.

**Invalid data throws instead of printing.** A printer handed a barcode it
cannot encode prints nothing at all and reports no error — the receipt just
comes out with a gap. So `ean13` insists on its 12 or 13 digits, `itf` on an
even count, and CODE128 gets a `{B` code set prefix when you do not supply one,
without which many printers stay silent.

For QR, the payload goes in verbatim — **a PIX BR Code needs nothing special**:

```ts
receipt.align('center').qr(brCode, { size: 6 });
```

QR data is written as raw bytes and deliberately bypasses the code page, since a
QR carries bytes and the scanner decides how to read them.

## Printer status: measured first

```ts
await using printer = await UsbTransport.open();

const status = await printer.status();
if (!status.ready) throw new Error(status.reason);
await printer.write(bytes);
```

Real-time, straight from the firmware — it answers even while the printer is
busy, and no queue is involved. You get `ready`, `paper`
(`ok` / `near-end` / `out`), `coverOpen`, `drawerOpen`, `error`, a one-sentence
`reason`, and the four `raw` bytes for your logs.

This is not a claim borrowed from the spec — it is three states measured on a
YiDa YD583, cover opened and paper pulled by hand:

| Query | Closed, paper in | Cover open | No paper, closed |
|---|---|---|---|
| `n=1` printer | `0x12` | `0x1a` offline | `0x1a` |
| `n=2` offline | `0x12` | `0x32` out of paper | `0x32` |
| `n=3` error | `0x12` | `0x12` | `0x12` |
| `n=4` sensor | `0x12` | `0x72` out of paper | `0x72` |

Bits 1 and 4 are fixed at 1, which is why `0x12` is the "everything fine"
baseline.

**Cover open and out of paper are the same byte.** This printer never raises the
cover-open bit (`0x04` on query 2) that the spec defines — opening the cover
lifts the paper sensor, and that sensor is the only one it has.

So `status()` reports one state and explains it, rather than pretending to tell
two apart:

```
ready: false | paper: out | coverOpen: false
reason: out of paper, or the cover is open — many thermal printers report
        both identically, because opening the cover lifts the paper sensor
```

If your printer does raise `0x04`, `coverOpen` comes back true and the reason
says so plainly. On a write-only interface, `status()` throws `UNSUPPORTED`
rather than hanging — check `canReadStatus` first if you want to branch.

This is the part nobody documents, which is exactly why it is written down here.

## Roadmap

- [x] **M1** — encoder core: columns, wrapping, code pages, profiles
- [x] **M2** — transports: USB (WebUSB), CUPS fallback, file; typed errors with hints
- [x] **M3** — `DLE EOT` status, QR codes (PIX), barcodes, images with dithering
- [x] **M4** — CLI: `devices`, `doctor`, `test`, `print`, `preview`
- [ ] **M5** — v1.0

`examples/spike.mjs` and `examples/status.mjs` are the raw USB experiments the
design is based on; they run today against a real printer.

## Development

```bash
npm install
npm test              # 63 tests, no printer required
npm run typecheck
npm run build
npm run gen:codepages # regenerate code page tables from the system iconv
npm run changeset     # describe a change for the next release
```

Releases go through [changesets](https://github.com/changesets/changesets): add
one describing your change and the version bump and changelog follow from it.
Publishing itself stays manual, because the npm account requires a one-time
password for every publish.

Layout logic is a pure function of its input, so almost everything is testable
without hardware. That is deliberate.

## License

MIT © Fransuelton
