/**
 * USB transport — straight to the bulk endpoint, no print queue in between.
 *
 * Written against the standard WebUSB interface rather than any Node-specific
 * API, which is not a compromise: node-usb 3.x only exposes WebUSB anyway, and
 * writing to the standard shape means this same file runs in Chrome. A browser
 * point-of-sale can print to the thermal printer with no agent, no local
 * server, and nothing installed.
 *
 * Every ESC/POS tutorial for Node still on the web teaches `findByIds()` and
 * `getDeviceList()`. Those were removed in node-usb 3.0 — do not copy them.
 *
 * Verified on macOS 26.5 (Apple Silicon), Node 24, node-usb 3.0.1, against a
 * YiDa YD583: `claimInterface()` succeeds without root and with the CUPS queue
 * still enabled. macOS does not bind an exclusive kernel driver to
 * printer-class interfaces the way Linux's `usblp` does, so there is nothing to
 * detach. CUPS keeps working afterwards **as long as the interface is
 * released** — which is why `close()` is not optional here, and why this class
 * implements async dispose so `await using` can guarantee it.
 */
import * as cmd from './commands.js';
import { EscposError } from './errors.js';
import { isStatusByte, parseStatus, type PrinterStatus } from './status.js';
import { ASYNC_DISPOSE, assertOpen, serialQueue, type Transport } from './transport.js';

/** USB class code for printers, from the USB device class spec. */
const PRINTER_CLASS = 7;

// ── the slice of WebUSB this transport needs ───────────────────────────────
//
// Declared structurally instead of pulled from a types package, so the core
// stays dependency-free and both `navigator.usb` and node-usb's `WebUSB` fit
// without a cast.

export interface UsbEndpointLike {
  readonly endpointNumber: number;
  readonly direction: 'in' | 'out';
  readonly type: 'bulk' | 'interrupt' | 'isochronous';
  readonly packetSize: number;
}

export interface UsbAlternateLike {
  readonly interfaceClass: number;
  readonly endpoints: readonly UsbEndpointLike[];
}

export interface UsbInterfaceLike {
  readonly interfaceNumber: number;
  readonly alternate: UsbAlternateLike;
}

export interface UsbConfigurationLike {
  readonly configurationValue: number;
  readonly interfaces: readonly UsbInterfaceLike[];
}

export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string | undefined;
  readonly manufacturerName?: string | undefined;
  readonly serialNumber?: string | undefined;
  readonly configuration: UsbConfigurationLike | null;
  readonly configurations: readonly UsbConfigurationLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  // `Uint8Array` rather than the wider `BufferSource`: it is all this transport
  // ever sends, and a real implementation accepting more still satisfies it.
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
  ): Promise<{ readonly status?: string; readonly bytesWritten?: number }>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<{ readonly status?: string; readonly data?: { buffer: ArrayBufferLike } | undefined }>;
}

export interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
}

export interface UsbOpenOptions {
  /** `navigator.usb` in the browser. Omitted in Node, where `usb` is loaded on demand. */
  usb?: UsbLike;
  /** An already-chosen device — what `navigator.usb.requestDevice()` returns. */
  device?: UsbDeviceLike;
  /** Narrow the search when more than one printer is plugged in. */
  vendorId?: number;
  productId?: number;
  /** Override interface/endpoint discovery for a printer that reports oddly. */
  interfaceNumber?: number;
  endpointNumber?: number;
  /** Bulk IN endpoint, used only by `status()`. Discovered automatically. */
  inEndpointNumber?: number;
  /** How long to wait for a `DLE EOT` reply, per attempt. */
  statusTimeout?: number;
  /**
   * Split writes into chunks of this many bytes.
   *
   * The M0 measurements sent a whole receipt in a single transfer and it worked,
   * so that stays the default. Printers with small input buffers can choke on
   * large payloads — raster images, mostly — and this is the knob for them.
   */
  chunkSize?: number;
}

/** True when the interface exposes a bulk OUT endpoint — i.e. we can print to it. */
function printable(iface: UsbInterfaceLike): boolean {
  return (
    iface.alternate.interfaceClass === PRINTER_CLASS &&
    iface.alternate.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk')
  );
}

function describe(device: UsbDeviceLike): string {
  const name = [device.manufacturerName, device.productName].filter(Boolean).join(' ').trim();
  const id = `${device.vendorId.toString(16).padStart(4, '0')}:${device.productId
    .toString(16)
    .padStart(4, '0')}`;
  return name ? `${name} (${id})` : id;
}

/** `process.platform` where it exists — undefined in a browser, and that is fine. */
function platform(): string | undefined {
  return (globalThis as { process?: { platform?: string } }).process?.platform;
}

/** Platform-specific advice for a claim that failed, which is the error that stops people. */
function claimHint(): string {
  switch (platform()) {
    case 'linux':
      return 'The kernel `usblp` driver usually holds the interface: `sudo modprobe -r usblp`, or add a udev rule granting your user access to the device.';
    case 'darwin':
      return 'On macOS this normally succeeds even with CUPS enabled. If it does not, another process holds the interface — try `cupsdisable <queue>`, or close whatever else is talking to the printer.';
    case 'win32':
      return 'Windows binds its own printer driver to the interface. Replace it with WinUSB using Zadig, or use the CUPS/file transport instead.';
    default:
      return 'Another process is holding the interface, or this user lacks permission to claim it.';
  }
}

export class UsbTransport implements Transport {
  readonly device: UsbDeviceLike;
  readonly #interfaceNumber: number;
  readonly #endpointNumber: number;
  readonly #inEndpointNumber: number | undefined;
  readonly #chunkSize: number | undefined;
  readonly #statusTimeout: number;
  readonly #enqueue = serialQueue();
  #closed = false;

  private constructor(
    device: UsbDeviceLike,
    interfaceNumber: number,
    endpointNumber: number,
    inEndpointNumber: number | undefined,
    options: UsbOpenOptions,
  ) {
    this.device = device;
    this.#interfaceNumber = interfaceNumber;
    this.#endpointNumber = endpointNumber;
    this.#inEndpointNumber = inEndpointNumber;
    this.#chunkSize = options.chunkSize;
    this.#statusTimeout = options.statusTimeout ?? 1500;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** The claimed interface and endpoints, for a `doctor` command to report. */
  get target(): {
    interfaceNumber: number;
    endpointNumber: number;
    inEndpointNumber: number | undefined;
  } {
    return {
      interfaceNumber: this.#interfaceNumber,
      endpointNumber: this.#endpointNumber,
      inEndpointNumber: this.#inEndpointNumber,
    };
  }

  /** Whether this interface can answer `DLE EOT` at all. */
  get canReadStatus(): boolean {
    return this.#inEndpointNumber !== undefined;
  }

  /**
   * Find a printer, claim it, and get ready to write.
   *
   * Pair it with `await using` so the interface is released even when the
   * receipt throws — a claimed interface that is never released is what makes
   * CUPS stop working afterwards.
   */
  static async open(options: UsbOpenOptions = {}): Promise<UsbTransport> {
    const device = options.device ?? (await find(options));

    try {
      await device.open();
    } catch (cause) {
      throw new EscposError('CLAIM_FAILED', `cannot open ${describe(device)}`, {
        cause,
        hint: claimHint(),
      });
    }

    try {
      if (!device.configuration) {
        await device.selectConfiguration(device.configurations[0]?.configurationValue ?? 1);
      }
      const configuration = device.configuration ?? device.configurations[0];
      if (!configuration) {
        throw new EscposError('UNSUPPORTED', `${describe(device)} exposes no USB configuration`, {
          hint: 'The device answered enumeration but reported no configuration. Replug it, or try another port.',
        });
      }

      const iface =
        options.interfaceNumber === undefined
          ? configuration.interfaces.find(printable)
          : configuration.interfaces.find((i) => i.interfaceNumber === options.interfaceNumber);

      if (!iface) {
        throw new EscposError(
          'UNSUPPORTED',
          `${describe(device)} has no printer-class interface with a bulk OUT endpoint`,
          {
            hint: 'Check the interface with `ioreg` (macOS) or `lsusb -v` (Linux): you are looking for bInterfaceClass = 7. Some printers hide behind a vendor-specific class — pass { interfaceNumber, endpointNumber } to override discovery.',
          },
        );
      }

      const endpointNumber =
        options.endpointNumber ??
        iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
          ?.endpointNumber;

      if (endpointNumber === undefined) {
        throw new EscposError(
          'UNSUPPORTED',
          `interface ${iface.interfaceNumber} of ${describe(device)} has no bulk OUT endpoint`,
          { hint: 'Pass { endpointNumber } if you know which endpoint the printer listens on.' },
        );
      }

      try {
        await device.claimInterface(iface.interfaceNumber);
      } catch (cause) {
        throw new EscposError(
          'CLAIM_FAILED',
          `cannot claim interface ${iface.interfaceNumber} of ${describe(device)}`,
          { cause, hint: claimHint() },
        );
      }

      // Optional: plenty of printers are write-only, and that is not an error
      // until someone actually asks for status.
      const inEndpointNumber =
        options.inEndpointNumber ??
        iface.alternate.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk')
          ?.endpointNumber;

      return new UsbTransport(
        device,
        iface.interfaceNumber,
        endpointNumber,
        inEndpointNumber,
        options,
      );
    } catch (e) {
      // Anything that fails after open() leaves the handle dangling, and on
      // some platforms that is enough to keep the next process out.
      await device.close().catch(() => {});
      throw e;
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    assertOpen(this.#closed, 'USB transport');
    return this.#enqueue(async () => {
      assertOpen(this.#closed, 'USB transport');
      const size = this.#chunkSize;
      if (size === undefined || bytes.length <= size) {
        await this.#transfer(bytes);
        return;
      }
      // `subarray` and not `slice`: node-usb passes byteOffset and byteLength
      // through to libusb, and the WebUSB spec requires the same, so there is
      // no copy to pay for here.
      for (let at = 0; at < bytes.length; at += size) {
        await this.#transfer(bytes.subarray(at, at + size));
      }
    });
  }

  /**
   * Ask the printer how it is doing, over `DLE EOT`.
   *
   * Real-time: the printer answers from its firmware rather than from a queue,
   * so this reports the state of the hardware right now — including while it is
   * busy printing something else.
   *
   * Goes through the same queue as `write`, because a status reply arriving in
   * the middle of a receipt is a reply nobody can match to a question.
   */
  async status(): Promise<PrinterStatus> {
    assertOpen(this.#closed, 'USB transport');
    const inEndpoint = this.#inEndpointNumber;
    if (inEndpoint === undefined) {
      throw new EscposError('UNSUPPORTED', `${describe(this.device)} has no bulk IN endpoint`, {
        hint: 'This interface is write-only, so it cannot answer DLE EOT. Bidirectional printers report bInterfaceProtocol = 2. Pass { inEndpointNumber } to override discovery.',
      });
    }

    return this.#enqueue(async () => {
      assertOpen(this.#closed, 'USB transport');
      // One endpoint, one reply at a time — these cannot overlap.
      return parseStatus({
        printer: await this.#query(1, inEndpoint),
        offline: await this.#query(2, inEndpoint),
        error: await this.#query(3, inEndpoint),
        paper: await this.#query(4, inEndpoint),
      });
    });
  }

  /**
   * One query, retried once.
   *
   * A read came back cancelled exactly once during the physical test, with the
   * printer offline, and answered on the next attempt. A retry costs
   * milliseconds; reporting a healthy printer as unreachable costs a support
   * conversation. A reply without the DLE EOT signature is discarded the same
   * way — it is leftover data, not a status.
   */
  async #query(n: 1 | 2 | 3 | 4, inEndpoint: number, attempts = 2): Promise<number> {
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.#transfer(cmd.statusQuery(n));
        const reply = await this.#read(inEndpoint);
        if (isStatusByte(reply)) return reply;
        last = new Error(`reply 0x${reply.toString(16)} is not a status byte`);
      } catch (e) {
        last = e;
      }
    }
    throw new EscposError('OFFLINE', `printer did not answer DLE EOT ${n}`, {
      cause: last,
      hint: 'The printer accepted the query but sent nothing back. Some models only answer when bidirectional mode is enabled in their DIP switches or vendor tool.',
    });
  }

  /** First byte of the next IN transfer, or a timeout. */
  async #read(inEndpoint: number): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.device.transferIn(inEndpoint, 64),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no reply within ${this.#statusTimeout}ms`)),
            this.#statusTimeout,
          );
        }),
      ]);
      const buffer = result.data?.buffer;
      if (!buffer || buffer.byteLength === 0) throw new Error('empty reply');
      return new Uint8Array(buffer)[0]!;
    } finally {
      // Without this the process keeps a live timer and refuses to exit.
      clearTimeout(timer);
    }
  }

  async #transfer(chunk: Uint8Array): Promise<void> {
    let result: { status?: string; bytesWritten?: number };
    try {
      result = await this.device.transferOut(this.#endpointNumber, chunk);
    } catch (cause) {
      throw new EscposError('WRITE_FAILED', `write to ${describe(this.device)} failed`, {
        cause,
        hint: 'The printer was claimed but stopped accepting data. It is usually unplugged, powered off, or out of paper with the buffer full.',
      });
    }

    if (result.status !== undefined && result.status !== 'ok') {
      throw new EscposError(
        'WRITE_FAILED',
        `printer stalled the endpoint (status: ${result.status})`,
        {
          hint: 'A stall on a bulk OUT endpoint usually means the printer rejected the data or its buffer is full. Check paper and cover, then retry.',
        },
      );
    }

    if (result.bytesWritten !== undefined && result.bytesWritten < chunk.length) {
      throw new EscposError(
        'WRITE_FAILED',
        `short write: ${result.bytesWritten} of ${chunk.length} bytes`,
        {
          hint: 'Set { chunkSize: 4096 } when opening — some printers drop the tail of a large transfer.',
        },
      );
    }
  }

  /**
   * Release and close. Idempotent.
   *
   * This is the condition for CUPS to keep printing afterwards, so it swallows
   * nothing quietly on the release path but never throws on a double close.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.device.releaseInterface(this.#interfaceNumber);
    } finally {
      await this.device.close();
    }
  }

  async [ASYNC_DISPOSE](): Promise<void> {
    await this.close();
  }
}

/** Enumerate and pick a printer, with the WebUSB implementation resolved lazily. */
async function find(options: UsbOpenOptions): Promise<UsbDeviceLike> {
  const usb = options.usb ?? (await defaultUsb());
  const devices = await usb.getDevices();

  const matches = devices.filter((d) => {
    if (options.vendorId !== undefined && d.vendorId !== options.vendorId) return false;
    if (options.productId !== undefined && d.productId !== options.productId) return false;
    return true;
  });

  const device =
    matches.find((d) => (d.configuration ?? d.configurations[0])?.interfaces.some(printable)) ??
    (options.vendorId !== undefined || options.productId !== undefined ? matches[0] : undefined);

  if (!device) {
    throw new EscposError('DEVICE_NOT_FOUND', 'no USB printer found', {
      hint:
        devices.length === 0
          ? 'The bus came back empty. In the browser, getDevices() only returns devices the user already authorized — call navigator.usb.requestDevice() from a click first.'
          : `${devices.length} USB device(s) enumerated, none with a printer-class interface. Pass { vendorId, productId } if your printer reports a vendor-specific class.`,
    });
  }
  return device;
}

/**
 * `navigator.usb` in a browser, node-usb in Node.
 *
 * The specifier goes through a variable on purpose: a bare `import('usb')` makes
 * browser bundlers try to resolve a native module that this path never reaches.
 */
async function defaultUsb(): Promise<UsbLike> {
  const nav = (globalThis as { navigator?: { usb?: UsbLike } }).navigator;
  if (nav?.usb) return nav.usb;

  const specifier = 'usb';
  try {
    const mod = (await import(specifier)) as {
      WebUSB: new (options: { allowAllDevices: boolean }) => UsbLike;
    };
    return new mod.WebUSB({ allowAllDevices: true });
  } catch (cause) {
    throw new EscposError('UNSUPPORTED', 'no WebUSB implementation available', {
      cause,
      hint: 'Install the optional peer: `npm install usb`. In a browser, pass { usb: navigator.usb } instead.',
    });
  }
}
