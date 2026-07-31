import { describe, expect, it } from 'vitest';
import { UsbTransport, type UsbDeviceLike, type UsbInterfaceLike } from '../src/usb.js';
import { isEscposError } from '../src/errors.js';
import { Receipt } from '../src/receipt.js';

/**
 * A fake USBDevice.
 *
 * Writing the transport against the standard WebUSB shape (ADR-05) buys more
 * than browser support: the whole thing is testable with an object literal, so
 * claim, write and release are covered without spending paper.
 */
/**
 * Honour byteOffset and byteLength, the way node-usb and the WebUSB spec both
 * do. Reading `data.buffer` alone would hand back the whole payload on every
 * chunk — the fake has to be as correct as the driver, or it tests nothing.
 */
function viewOf(data: Uint8Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function fakeDevice(overrides: Partial<FakeDevice> = {}): FakeDevice {
  const printerInterface: UsbInterfaceLike = {
    interfaceNumber: 0,
    alternate: {
      interfaceClass: 7,
      endpoints: [
        { endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 },
      ],
    },
  };

  const device: FakeDevice = {
    vendorId: 0x09c5,
    productId: 0x583e,
    productName: 'Fake Thermal',
    manufacturerName: 'ACME',
    configuration: { configurationValue: 1, interfaces: [printerInterface] },
    configurations: [{ configurationValue: 1, interfaces: [printerInterface] }],
    log: [],
    written: [],
    async open() {
      this.log.push('open');
    },
    async close() {
      this.log.push('close');
    },
    async selectConfiguration() {
      this.log.push('selectConfiguration');
    },
    async claimInterface(n: number) {
      this.log.push(`claim:${n}`);
    },
    async releaseInterface(n: number) {
      this.log.push(`release:${n}`);
    },
    async transferOut(endpoint: number, data: Uint8Array) {
      const bytes = viewOf(data);
      this.log.push(`out:${endpoint}`);
      this.written.push(bytes.slice());
      return { status: 'ok', bytesWritten: bytes.length };
    },
    ...overrides,
  };
  return device;
}

interface FakeDevice extends UsbDeviceLike {
  log: string[];
  written: Uint8Array[];
}

describe('open', () => {
  it('finds the printer-class interface and its bulk OUT endpoint', async () => {
    const device = fakeDevice();
    const t = await UsbTransport.open({ device });
    expect(t.target).toEqual({ interfaceNumber: 0, endpointNumber: 1 });
    await t.close();
  });

  it('skips interfaces that are not printer class', async () => {
    const vendor: UsbInterfaceLike = {
      interfaceNumber: 0,
      alternate: {
        interfaceClass: 255,
        endpoints: [{ endpointNumber: 3, direction: 'out', type: 'bulk', packetSize: 64 }],
      },
    };
    const printer: UsbInterfaceLike = {
      interfaceNumber: 1,
      alternate: {
        interfaceClass: 7,
        endpoints: [{ endpointNumber: 4, direction: 'out', type: 'bulk', packetSize: 64 }],
      },
    };
    const configuration = { configurationValue: 1, interfaces: [vendor, printer] };
    const t = await UsbTransport.open({
      device: fakeDevice({ configuration, configurations: [configuration] }),
    });
    expect(t.target).toEqual({ interfaceNumber: 1, endpointNumber: 4 });
    await t.close();
  });

  it('reports DEVICE_NOT_FOUND with a browser-specific hint on an empty bus', async () => {
    const error = await UsbTransport.open({ usb: { getDevices: async () => [] } }).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('DEVICE_NOT_FOUND');
    expect(error.hint).toMatch(/requestDevice/);
  });

  it('carries a hint and the original cause when the claim fails', async () => {
    const cause = new Error('LIBUSB_ERROR_ACCESS');
    const device = fakeDevice({
      async claimInterface() {
        throw cause;
      },
    });
    const error = await UsbTransport.open({ device }).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('CLAIM_FAILED');
    expect(error.hint).toBeTruthy();
    expect(error.cause).toBe(cause);
  });

  it('closes the device when anything after open() fails, leaving no dangling handle', async () => {
    const device = fakeDevice({
      async claimInterface() {
        throw new Error('busy');
      },
    });
    await UsbTransport.open({ device }).catch(() => {});
    expect(device.log).toContain('close');
  });

  it('rejects an interface with no bulk OUT endpoint as UNSUPPORTED', async () => {
    const configuration = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternate: {
            interfaceClass: 7,
            endpoints: [{ endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }],
          },
        } satisfies UsbInterfaceLike,
      ],
    };
    const error = await UsbTransport.open({
      device: fakeDevice({ configuration, configurations: [configuration] }),
    }).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('UNSUPPORTED');
  });
});

describe('write', () => {
  it('sends the receipt bytes to the bulk OUT endpoint, untouched', async () => {
    const device = fakeDevice();
    const t = await UsbTransport.open({ device });
    const bytes = new Receipt().reset().line('Total').feed().encode();
    await t.write(bytes);
    await t.close();
    expect([...device.written[0]!]).toEqual([...bytes]);
  });

  it('splits into chunks when asked, and only then', async () => {
    const device = fakeDevice();
    const t = await UsbTransport.open({ device, chunkSize: 8 });
    await t.write(new Uint8Array(20));
    expect(device.written.map((c) => c.length)).toEqual([8, 8, 4]);
    await t.close();
  });

  it('serializes concurrent writes instead of interleaving them', async () => {
    // Two receipts written at once to the same endpoint would come out as one
    // receipt with lines from both.
    const order: number[] = [];
    const device = fakeDevice({
      async transferOut(_endpoint: number, data: Uint8Array) {
        const bytes = viewOf(data);
        await new Promise((r) => setTimeout(r, bytes[0] === 1 ? 20 : 0));
        order.push(bytes[0]!);
        return { status: 'ok', bytesWritten: bytes.length };
      },
    });
    const t = await UsbTransport.open({ device });
    await Promise.all([t.write(Uint8Array.of(1)), t.write(Uint8Array.of(2))]);
    expect(order).toEqual([1, 2]);
    await t.close();
  });

  it('turns a stalled endpoint into WRITE_FAILED with a hint', async () => {
    const device = fakeDevice({
      async transferOut() {
        return { status: 'stall', bytesWritten: 0 };
      },
    });
    const t = await UsbTransport.open({ device });
    const error = await t.write(Uint8Array.of(1)).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('WRITE_FAILED');
    expect(error.hint).toMatch(/paper/i);
    await t.close();
  });

  it('refuses to write after close instead of hanging', async () => {
    const t = await UsbTransport.open({ device: fakeDevice() });
    await t.close();
    const error = await t.write(Uint8Array.of(1)).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('WRITE_FAILED');
  });
});

describe('close', () => {
  it('releases the interface before closing — the condition for CUPS to keep working', async () => {
    const device = fakeDevice();
    const t = await UsbTransport.open({ device });
    await t.close();
    expect(device.log.slice(-2)).toEqual(['release:0', 'close']);
    expect(t.closed).toBe(true);
  });

  it('is idempotent, so a double close is not an error', async () => {
    const device = fakeDevice();
    const t = await UsbTransport.open({ device });
    await t.close();
    await t.close();
    expect(device.log.filter((l) => l === 'close')).toHaveLength(1);
  });

  it('releases through `await using`, even when the block throws', async () => {
    const device = fakeDevice();
    await expect(
      (async () => {
        await using t = await UsbTransport.open({ device });
        await t.write(Uint8Array.of(1));
        throw new Error('receipt blew up');
      })(),
    ).rejects.toThrow('receipt blew up');
    expect(device.log.slice(-2)).toEqual(['release:0', 'close']);
  });
});
