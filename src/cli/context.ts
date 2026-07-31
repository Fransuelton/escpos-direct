import { mm58, mm80, profile as override, type Profile } from '../profile.js';
import { CODE_PAGES, type CodePage } from '../codepage/index.js';
import { EscposError } from '../errors.js';
import type { Transport } from '../transport.js';
import type { CliOptions } from '../cli.js';

const PROFILES = { mm58, mm80 } as const;

export function resolveProfile(values: CliOptions): Profile {
  const name = (values.profile as string) ?? 'mm58';
  const base = PROFILES[name as keyof typeof PROFILES];
  if (!base) {
    throw new RangeError(
      `unknown profile "${name}"; expected ${Object.keys(PROFILES).join(' or ')}`,
    );
  }

  const codepage = values.codepage as string | undefined;
  if (codepage === undefined) return base;
  if (!CODE_PAGES.includes(codepage as CodePage)) {
    throw new RangeError(`unknown code page "${codepage}"; known: ${CODE_PAGES.join(', ')}`);
  }
  return override(base, { codePage: codepage as CodePage });
}

const hex = (v: unknown): number | undefined =>
  typeof v === 'string' ? Number.parseInt(v.replace(/^0x/i, ''), 16) : undefined;

/** Pick a transport from the flags: `--cups` and `--file` beat USB. */
export async function openTransport(values: CliOptions): Promise<Transport> {
  if (values.file !== undefined) {
    const { FileTransport } = await import('../file.js');
    return FileTransport.open(values.file as string);
  }

  if (values.cups !== undefined) {
    const { CupsTransport } = await import('../cups.js');
    const queue = values.cups === '' ? undefined : (values.cups as string);
    return CupsTransport.open(queue ? { printer: queue } : {});
  }

  const { UsbTransport } = await import('../usb.js');
  const vendorId = hex(values.vendor);
  const productId = hex(values.product);
  return UsbTransport.open({
    ...(vendorId !== undefined ? { vendorId } : {}),
    ...(productId !== undefined ? { productId } : {}),
  });
}

/**
 * node-usb, or a typed error saying how to get it.
 *
 * Without this the first command someone runs after installing reports a bare
 * module-resolution failure, which is precisely the kind of dead end this
 * library exists to remove.
 */
export async function webusb(): Promise<{ getDevices(): Promise<unknown[]> }> {
  const specifier = 'usb';
  try {
    const mod = (await import(specifier)) as {
      WebUSB: new (o: { allowAllDevices: boolean }) => { getDevices(): Promise<unknown[]> };
    };
    return new mod.WebUSB({ allowAllDevices: true });
  } catch (cause) {
    throw new EscposError('UNSUPPORTED', 'the usb package is not installed', {
      cause,
      hint: 'USB needs the optional peer: `npm install usb`. To avoid it entirely, print with --cups <queue> or --file <path>.',
    });
  }
}
