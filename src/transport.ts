/**
 * What every transport has in common.
 *
 * A transport takes the bytes `Receipt.encode()` produced and gets them to the
 * printer. It never inspects them — which is what keeps the encoder pure and
 * testable, and what makes swapping USB for CUPS a one-line change.
 */
import { EscposError } from './errors.js';

/**
 * Node shipped `Symbol.asyncDispose` in 20.4; on older 20.x it is missing, and
 * `Symbol.for('Symbol.asyncDispose')` is the exact key the TypeScript and Babel
 * polyfills use. Resolving it here keeps `await using` working on both without
 * patching a global that is not ours.
 */
export const ASYNC_DISPOSE: typeof Symbol.asyncDispose =
  (Symbol as Partial<SymbolConstructor>).asyncDispose ??
  (Symbol.for('Symbol.asyncDispose') as typeof Symbol.asyncDispose);

export interface Transport {
  /** Send a payload. Serialized: concurrent calls queue, they never interleave. */
  write(bytes: Uint8Array): Promise<void>;
  /** Release the printer. Safe to call twice. */
  close(): Promise<void>;
  readonly closed: boolean;
  [ASYNC_DISPOSE](): Promise<void>;
}

/**
 * One task at a time, in call order.
 *
 * Two receipts written concurrently to the same endpoint interleave their
 * chunks, and ESC/POS has no framing for the printer to tell them apart — what
 * comes out is one receipt with lines from both. A failed task does not wedge
 * the queue: the next one still runs.
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** Shared guard, so "already released" is a typed error and not a stack trace. */
export function assertOpen(closed: boolean, what: string): void {
  if (closed) {
    throw new EscposError('WRITE_FAILED', `${what} is closed`, {
      hint: 'This transport was already released. Open a new one — with `await using`, the block it belonged to has ended.',
    });
  }
}
