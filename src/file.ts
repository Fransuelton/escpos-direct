/**
 * File transport — write the payload to a path.
 *
 * Two uses, both real. On Linux a printer shows up as a character device
 * (`/dev/usb/lp0`), and writing to it is the simplest transport there is. And
 * pointed at a regular file it captures a receipt as bytes, which is how you
 * diff what changed between two versions of a layout, or hand a payload to
 * someone who has the printer you do not.
 */
import { EscposError } from './errors.js';
import { ASYNC_DISPOSE, assertOpen, serialQueue, type Transport } from './transport.js';

interface FileHandleLike {
  write(data: Uint8Array): Promise<unknown>;
  close(): Promise<void>;
}

export interface FileOptions {
  /** Append instead of truncating. The default for a device node, where truncation is meaningless. */
  append?: boolean;
}

export class FileTransport implements Transport {
  readonly path: string;
  readonly #handle: FileHandleLike;
  readonly #enqueue = serialQueue();
  #closed = false;

  private constructor(path: string, handle: FileHandleLike) {
    this.path = path;
    this.#handle = handle;
  }

  get closed(): boolean {
    return this.#closed;
  }

  static async open(path: string, options: FileOptions = {}): Promise<FileTransport> {
    const { open } = await import('node:fs/promises');
    try {
      const handle = await open(path, options.append ? 'a' : 'w');
      return new FileTransport(path, handle);
    } catch (cause) {
      throw new EscposError('DEVICE_NOT_FOUND', `cannot open ${path}`, {
        cause,
        hint: 'Check the path and permissions. For a Linux device node like /dev/usb/lp0, your user usually has to be in the `lp` group.',
      });
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    assertOpen(this.#closed, 'file transport');
    return this.#enqueue(async () => {
      assertOpen(this.#closed, 'file transport');
      try {
        await this.#handle.write(bytes);
      } catch (cause) {
        throw new EscposError('WRITE_FAILED', `write to ${this.path} failed`, {
          cause,
          hint: 'For a device node, this usually means the printer is off or unplugged.',
        });
      }
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }

  async [ASYNC_DISPOSE](): Promise<void> {
    await this.close();
  }
}
