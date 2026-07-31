/**
 * escpos-direct — ESC/POS thermal printing that talks straight to the printer.
 *
 * This entry point is pure: no native modules, no I/O, no dependencies. It
 * turns text into printer bytes and runs anywhere JavaScript does, including
 * the browser. Transports live behind subpath imports so that generating a
 * receipt never costs you a native build.
 *
 *   import { Receipt } from 'escpos-direct';
 *   import { UsbTransport } from 'escpos-direct/usb';
 */
export { Receipt, type Align } from './receipt.js';
export { mm58, mm80, profile, type Profile } from './profile.js';
export {
  encode,
  decode,
  selectCodePage,
  CODE_PAGES,
  ESC_T,
  type CodePage,
} from './codepage/index.js';
export { sanitize, truncate, wrap, pad, itemLines } from './text.js';
export * as commands from './commands.js';
export {
  EscposError,
  isEscposError,
  type EscposErrorCode,
  type EscposErrorOptions,
} from './errors.js';
// The transport contract is pure — the implementations behind it are not, and
// stay in their own subpaths.
export { ASYNC_DISPOSE, serialQueue, type Transport } from './transport.js';
// Reading DLE EOT replies is byte maths, so it belongs here with the rest of it.
export {
  parseStatus,
  isStatusByte,
  type PrinterStatus,
  type StatusBytes,
  type PaperState,
  type ErrorState,
} from './status.js';
