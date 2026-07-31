#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { bold, cyan, dim, reportError } from './cli/ui.js';

const HELP = `
${bold('escpos-direct')} — thermal printing straight to the USB endpoint

  ${cyan('devices')}              list USB devices, flagging printer-class interfaces
  ${cyan('doctor')}               diagnose why printing is not working
  ${cyan('test')}                 print a test page: accents, columns, dithers
  ${cyan('print')} <file>         print a text file, or - for stdin
  ${cyan('preview')} <file>       render a text file in the terminal, to scale

${bold('Options')}
  --profile <mm58|mm80>  paper profile (default: mm58)
  --codepage <name>      code page (default: from profile)
  --vendor <hex>         narrow to a vendor id, e.g. 0x09c5
  --product <hex>        narrow to a product id
  --cups [queue]         print through CUPS instead of USB
  --file <path>          write to a file or device node instead of USB
  --no-status            skip the readiness check before printing
  -h, --help             this text
  -v, --version          package version

${dim('Every command runs without a printer except test and print.')}
`;

const OPTIONS = {
  profile: { type: 'string' },
  codepage: { type: 'string' },
  vendor: { type: 'string' },
  product: { type: 'string' },
  cups: { type: 'string' },
  file: { type: 'string' },
  status: { type: 'boolean', default: true },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

export type CliOptions = {
  [K in keyof typeof OPTIONS]?: string | boolean;
};

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    reportError(e);
    console.error(`\nRun ${cyan('escpos-direct --help')} for usage.`);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.version) {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    console.log(pkg.default.version);
    return 0;
  }

  if (values.help || command === undefined || command === 'help') {
    console.log(HELP);
    return command === undefined && !values.help ? 1 : 0;
  }

  try {
    switch (command) {
      case 'devices':
        return await (await import('./cli/devices.js')).devices(values);
      case 'doctor':
        return await (await import('./cli/doctor.js')).doctor(values);
      case 'test':
        return await (await import('./cli/test-page.js')).testPageCommand(values);
      case 'print':
        return await (await import('./cli/print.js')).print(rest[0], values);
      case 'preview':
        return await (await import('./cli/preview.js')).preview(rest[0], values);
      default:
        console.error(`Unknown command: ${command}`);
        console.error(`Run ${cyan('escpos-direct --help')} for usage.`);
        return 2;
    }
  } catch (e) {
    reportError(e);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
