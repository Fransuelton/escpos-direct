/**
 * Typed errors.
 *
 * `code` is for the program, `message` is for the human, `cause` is for the
 * log, and `hint` is for the person staring at a printer that will not print.
 *
 * That last field is the point of this library. Everything worth knowing here
 * is trap knowledge — the kernel driver holding the interface, the queue that
 * has to be disabled, the code page that resets — and the moment it is useful
 * is the moment something breaks, not in a README nobody reads beforehand.
 */

export type EscposErrorCode =
  /** No printer matched: nothing plugged in, or the filter was too narrow. */
  | 'DEVICE_NOT_FOUND'
  /** The device is there, but the interface could not be claimed. */
  | 'CLAIM_FAILED'
  /** Reported by the printer itself. */
  | 'OUT_OF_PAPER'
  /** Unreachable, or answering that it is not ready. */
  | 'OFFLINE'
  /** The transfer failed, or the printer stalled the endpoint. */
  | 'WRITE_FAILED'
  /** This transport cannot run here, or the printer lacks the feature. */
  | 'UNSUPPORTED';

export interface EscposErrorOptions {
  /** What to try next, in one sentence. This is what the CLI prints. */
  hint?: string;
  cause?: unknown;
}

export class EscposError extends Error {
  override readonly name = 'EscposError';
  readonly code: EscposErrorCode;
  readonly hint?: string;

  constructor(code: EscposErrorCode, message: string, options: EscposErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    if (options.hint !== undefined) this.hint = options.hint;
  }

  /** Message plus hint — what a CLI or a toast should show. */
  format(): string {
    return this.hint ? `${this.message}\n  hint: ${this.hint}` : this.message;
  }
}

/** Narrowing that survives two copies of the library in one process. */
export function isEscposError(e: unknown): e is EscposError {
  return e instanceof Error && (e as EscposError).name === 'EscposError';
}
