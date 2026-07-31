import type { CliOptions } from '../cli.js';
import type { UsbDeviceLike } from '../usb.js';
import { webusb } from './context.js';
import { bold, cyan, dim, heading, info, warn } from './ui.js';

const PRINTER_CLASS = 7;

export async function devices(_values: CliOptions): Promise<number> {
  const usb = await webusb();
  const all = (await usb.getDevices()) as UsbDeviceLike[];

  if (all.length === 0) {
    warn('No USB devices enumerated.');
    info('On Linux this usually means missing permission — check your udev rules.');
    return 1;
  }

  heading(`${all.length} USB device${all.length === 1 ? '' : 's'}`);

  let printers = 0;
  for (const device of all) {
    const id = `${hex(device.vendorId)}:${hex(device.productId)}`;
    const name = [device.manufacturerName, device.productName].filter(Boolean).join(' ') || 'unknown';
    const configuration = device.configuration ?? device.configurations[0];
    const printer = configuration?.interfaces.find((i) => i.alternate.interfaceClass === PRINTER_CLASS);

    if (printer) {
      printers++;
      const out = printer.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      const bidirectional = printer.alternate.endpoints.some((e) => e.direction === 'in');
      console.log(`\n  ${cyan('▸')} ${bold(name)}  ${dim(id)}`);
      console.log(
        `    printer class, interface ${printer.interfaceNumber}, endpoint OUT ${out?.endpointNumber ?? '?'}${
          bidirectional ? ', reads status' : ''
        }`,
      );
      console.log(`    ${dim(`--vendor 0x${hex(device.vendorId)} --product 0x${hex(device.productId)}`)}`);
    } else {
      console.log(`  ${dim('·')} ${name}  ${dim(id)}`);
    }
  }

  if (printers === 0) {
    console.log();
    warn('No printer-class interface found.');
    info('Some printers report a vendor-specific class. Try `doctor` for a closer look.');
    return 1;
  }
  return 0;
}

const hex = (n: number) => n.toString(16).padStart(4, '0');
