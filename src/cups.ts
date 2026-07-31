/**
 * CUPS transport — the fallback, via `lp -o raw`.
 *
 * Slower than the USB endpoint and it gives up real status, but it works where
 * claiming the interface does not: Windows with its own driver bound, Linux
 * without a udev rule, a printer shared over the network. The library should
 * never be the reason someone cannot print at all.
 *
 * `-o raw` is the whole point. A macOS queue is almost always created with a
 * generic PostScript driver, and without `raw` your ESC/POS bytes go through
 * that filter and come out as garbage — the second most common cause of "it
 * prints, but it prints nonsense".
 */
import { EscposError } from './errors.js';
import { ASYNC_DISPOSE, assertOpen, serialQueue, type Transport } from './transport.js';

interface StdinLike {
  write(chunk: Uint8Array): boolean;
  end(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface StderrLike {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

export interface CupsChild {
  readonly stdin: StdinLike | null;
  readonly stderr: StderrLike | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
}

/** Structural shape of `child_process.spawn`, so tests can hand over a fake. */
export type SpawnLike = (command: string, args: readonly string[]) => CupsChild;

export interface CupsOptions {
  /** Queue name, as `lpstat -p` prints it. Omit to use the system default queue. */
  printer?: string;
  /** Job title, shown in the queue. */
  title?: string;
  /** Path to the `lp` binary. */
  lp?: string;
  /** Injection point for tests; defaults to `child_process.spawn`. */
  spawn?: SpawnLike;
}

export class CupsTransport implements Transport {
  readonly #options: CupsOptions;
  readonly #spawn: SpawnLike;
  readonly #enqueue = serialQueue();
  #closed = false;

  private constructor(options: CupsOptions, spawn: SpawnLike) {
    this.#options = options;
    this.#spawn = spawn;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** The `lp` argv this transport will run — what a `doctor` command should show. */
  get argv(): string[] {
    const args = ['-o', 'raw'];
    if (this.#options.printer) args.unshift('-d', this.#options.printer);
    if (this.#options.title) args.push('-t', this.#options.title);
    return [this.#options.lp ?? 'lp', ...args];
  }

  static async open(options: CupsOptions = {}): Promise<CupsTransport> {
    const spawn = options.spawn ?? (await defaultSpawn());
    return new CupsTransport(options, spawn);
  }

  /** One `lp` job per call. There is no persistent connection to hold open. */
  async write(bytes: Uint8Array): Promise<void> {
    assertOpen(this.#closed, 'CUPS transport');
    return this.#enqueue(
      () =>
        new Promise<void>((resolve, reject) => {
          const [command, ...args] = this.argv as [string, ...string[]];
          const child = this.#spawn(command, args);
          let stderr = '';
          let settled = false;

          const fail = (error: EscposError) => {
            if (settled) return;
            settled = true;
            reject(error);
          };

          child.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
          });

          child.on('error', (cause: NodeJS.ErrnoException) => {
            fail(
              cause.code === 'ENOENT'
                ? new EscposError('UNSUPPORTED', `${command} not found`, {
                    cause,
                    hint: 'CUPS is not installed, or `lp` is not on PATH. On Windows there is no `lp` — use the USB or file transport.',
                  })
                : new EscposError('WRITE_FAILED', `${command} failed to start`, { cause }),
            );
          });

          child.on('close', (code) => {
            if (settled) return;
            settled = true;
            if (code === 0) {
              resolve();
              return;
            }
            reject(
              new EscposError('WRITE_FAILED', `${command} exited with code ${code}`, {
                hint:
                  stderr.trim() ||
                  'Check the queue name with `lpstat -p`, and that it is enabled: `cupsenable <queue>`.',
              }),
            );
          });

          const stdin = child.stdin;
          if (!stdin) {
            fail(
              new EscposError('WRITE_FAILED', `${command} exposes no stdin`, {
                hint: 'The spawned process has no writable stdin — check the `spawn` override.',
              }),
            );
            return;
          }
          stdin.on('error', (cause) => {
            // EPIPE here means lp died before reading the job; the `close`
            // handler carries the real reason, so this one only unblocks.
            fail(new EscposError('WRITE_FAILED', `writing to ${command} failed`, { cause }));
          });
          stdin.write(bytes);
          stdin.end();
        }),
    );
  }

  /** Nothing to release — each job is its own process. */
  async close(): Promise<void> {
    this.#closed = true;
  }

  async [ASYNC_DISPOSE](): Promise<void> {
    await this.close();
  }
}

async function defaultSpawn(): Promise<SpawnLike> {
  try {
    const { spawn } = await import('node:child_process');
    return spawn as unknown as SpawnLike;
  } catch (cause) {
    throw new EscposError('UNSUPPORTED', 'cannot spawn processes in this runtime', {
      cause,
      hint: 'The CUPS transport is Node-only. In a browser, use the USB transport with navigator.usb.',
    });
  }
}
