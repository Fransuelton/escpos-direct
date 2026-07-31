import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliOptions } from '../cli.js';
import { isEscposError } from '../errors.js';
import type { UsbDeviceLike } from '../usb.js';
import { webusb } from './context.js';
import { bad, bold, cyan, dim, heading, info, ok, warn, yellow } from './ui.js';

const run = promisify(execFile);
const PRINTER_CLASS = 7;

/**
 * Answers "why won't it print on my machine" without the person needing to
 * know anything about libusb.
 *
 * Every step reports what it found and what to do about it, and a failure early
 * on does not stop the later checks — a full picture is worth more than a fast
 * exit when someone is pasting this into an issue.
 */
export async function doctor(values: CliOptions): Promise<number> {
  let problems = 0;

  heading('Environment');
  info(`node ${process.version} · ${process.platform}/${process.arch}`);
  if (process.getuid?.() === 0) warn('Running as root. It should not be necessary — see below.');

  heading('USB backend');
  let usb;
  try {
    usb = await webusb();
    ok('node-usb loaded');
  } catch {
    bad('node-usb is not installed');
    info(`Install the optional peer: ${cyan('npm install usb')}`);
    return 1;
  }

  heading('Devices');
  const all = (await usb.getDevices()) as UsbDeviceLike[];
  info(`${all.length} USB device${all.length === 1 ? '' : 's'} enumerated`);

  const printers = all.filter((d) =>
    (d.configuration ?? d.configurations[0])?.interfaces.some(
      (i) => i.alternate.interfaceClass === PRINTER_CLASS,
    ),
  );

  if (printers.length === 0) {
    bad('No printer-class interface found');
    info('Some printers report a vendor-specific class; pass --vendor and --product to force one.');
    if (process.platform === 'darwin') {
      info(`Check yours: ${dim('ioreg -p IOService -w0 -l -r -n "NAME" | grep bInterfaceClass')}`);
    }
    problems++;
  } else {
    for (const d of printers) {
      const name = [d.manufacturerName, d.productName].filter(Boolean).join(' ') || 'unknown';
      ok(`${bold(name)} ${dim(`${hex(d.vendorId)}:${hex(d.productId)}`)}`);
    }
  }

  heading('Claim');
  if (printers.length > 0) {
    const { UsbTransport } = await import('../usb.js');
    try {
      await using transport = await UsbTransport.open({ device: printers[0]! });
      ok(`Claimed interface ${transport.target.interfaceNumber} without root`);

      if (!transport.canReadStatus) {
        warn('Write-only interface: this printer cannot report status');
      } else {
        heading('Status');
        try {
          const status = await transport.status();
          if (status.ready) {
            ok('Printer reports ready');
          } else {
            warn(`Not ready: ${status.reason}`);
            problems++;
          }
          info(
            dim(
              Object.entries(status.raw)
                .map(([k, v]) => `${k}=0x${v.toString(16)}`)
                .join(' '),
            ),
          );
        } catch (e) {
          warn('Status query failed');
          if (isEscposError(e) && e.hint) info(dim(e.hint));
        }
      }
    } catch (e) {
      bad('Could not claim the interface');
      if (isEscposError(e) && e.hint) info(`${yellow('hint')} ${e.hint}`);
      problems++;
    }
  }

  heading('CUPS');
  await cups(values);

  console.log();
  if (problems === 0) {
    ok(bold('No problems found. Direct USB printing should work.'));
    return 0;
  }
  bad(bold(`${problems} problem${problems === 1 ? '' : 's'} found — see the hints above.`));
  return 1;
}

/** CUPS matters twice over: as a fallback, and because a stuck queue confuses people. */
async function cups(values: CliOptions): Promise<void> {
  if (process.platform === 'win32') {
    info('Not applicable on Windows.');
    return;
  }
  try {
    const { stdout } = await run('lpstat', ['-p']);
    const queues = stdout.trim().split('\n').filter(Boolean);
    if (queues.length === 0) {
      info('No CUPS queues configured. That is fine — this library does not need one.');
      return;
    }
    for (const line of queues) {
      const disabled = /disabled/i.test(line);
      (disabled ? warn : ok)(line.trim());
    }
    info(
      dim(
        `Claiming the interface does not disturb these, as long as it is released. Use ${
          values.cups !== undefined ? 'this queue' : '--cups <queue>'
        } to print through CUPS instead.`,
      ),
    );
  } catch {
    info('`lpstat` not available. CUPS fallback would not work here.');
  }
}

const hex = (n: number) => n.toString(16).padStart(4, '0');
