import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialQueue } from '../src/transport.js';
import { EscposError, isEscposError } from '../src/errors.js';
import { FileTransport } from '../src/file.js';
import { CupsTransport, type CupsChild, type SpawnLike } from '../src/cups.js';
import { Receipt } from '../src/receipt.js';

describe('EscposError', () => {
  it('keeps code, hint and cause apart — each has a different audience', () => {
    const cause = new Error('LIBUSB_ERROR_ACCESS');
    const e = new EscposError('CLAIM_FAILED', 'cannot claim interface 0', {
      hint: 'try `sudo modprobe -r usblp`',
      cause,
    });
    expect(e.code).toBe('CLAIM_FAILED');
    expect(e.message).toBe('cannot claim interface 0');
    expect(e.cause).toBe(cause);
    expect(e.format()).toBe('cannot claim interface 0\n  hint: try `sudo modprobe -r usblp`');
  });

  it('is recognizable without instanceof, which breaks across duplicate installs', () => {
    expect(isEscposError(new EscposError('OFFLINE', 'nope'))).toBe(true);
    expect(isEscposError(new Error('nope'))).toBe(false);
  });
});

describe('serialQueue', () => {
  it('runs tasks in call order however long each takes', async () => {
    const enqueue = serialQueue();
    const done: string[] = [];
    const task = (name: string, ms: number) => () =>
      new Promise<void>((r) => setTimeout(() => (done.push(name), r()), ms));

    await Promise.all([enqueue(task('a', 30)), enqueue(task('b', 0)), enqueue(task('c', 10))]);
    expect(done).toEqual(['a', 'b', 'c']);
  });

  it('does not wedge on a failed task — one bad receipt must not stop the till', async () => {
    const enqueue = serialQueue();
    const failed = enqueue(() => Promise.reject(new Error('boom'))).catch(() => 'failed');
    const after = enqueue(async () => 'ran');
    expect(await failed).toBe('failed');
    expect(await after).toBe('ran');
  });
});

describe('FileTransport', () => {
  it('writes the payload byte for byte', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'escpos-'));
    const path = join(dir, 'receipt.bin');
    const bytes = new Receipt().reset().line('Recibo').feed().encode();

    await using t = await FileTransport.open(path);
    await t.write(bytes);
    await t.close();

    expect([...(await readFile(path))]).toEqual([...bytes]);
  });

  it('appends when asked, so a device node is not truncated per job', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'escpos-'));
    const path = join(dir, 'receipt.bin');

    const first = await FileTransport.open(path);
    await first.write(Uint8Array.of(1));
    await first.close();

    const second = await FileTransport.open(path, { append: true });
    await second.write(Uint8Array.of(2));
    await second.close();

    expect([...(await readFile(path))]).toEqual([1, 2]);
  });

  it('reports an unwritable path with a hint instead of a raw errno', async () => {
    const error = await FileTransport.open('/nope/definitely/not/here.bin').catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('DEVICE_NOT_FOUND');
    expect(error.hint).toMatch(/permission/i);
  });
});

/** A fake `lp` that records what it was given. */
function fakeLp(exitCode = 0, stderr = ''): { spawn: SpawnLike; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: SpawnLike = (command, args) => {
    const call: Call = { command, args: [...args], stdin: [] };
    calls.push(call);
    const handlers: Record<string, (arg: never) => void> = {};
    const child: CupsChild = {
      stdin: {
        write(chunk) {
          call.stdin.push(chunk);
          return true;
        },
        end() {
          setTimeout(() => handlers.close?.(exitCode as never), 0);
        },
        on: () => undefined,
      },
      stderr: {
        on(_event, listener) {
          if (stderr) setTimeout(() => listener(stderr), 0);
          return undefined;
        },
      },
      on(event: string, listener: (arg: never) => void) {
        handlers[event] = listener;
        return undefined;
      },
    };
    return child;
  };
  return { spawn, calls };
}

interface Call {
  command: string;
  args: string[];
  stdin: Uint8Array[];
}

describe('CupsTransport', () => {
  it('always passes -o raw, or the PostScript filter mangles the bytes', async () => {
    const { spawn, calls } = fakeLp();
    const t = await CupsTransport.open({ printer: 'YD583', spawn });
    await t.write(Uint8Array.of(0x1b, 0x40));

    expect(calls[0]!.command).toBe('lp');
    expect(calls[0]!.args).toEqual(['-d', 'YD583', '-o', 'raw']);
    expect([...calls[0]!.stdin[0]!]).toEqual([0x1b, 0x40]);
  });

  it('omits -d when no queue is named, falling back to the system default', async () => {
    const { spawn, calls } = fakeLp();
    const t = await CupsTransport.open({ spawn });
    await t.write(Uint8Array.of(1));
    expect(calls[0]!.args).toEqual(['-o', 'raw']);
  });

  it('turns a non-zero exit into WRITE_FAILED and hands stderr over as the hint', async () => {
    const { spawn } = fakeLp(1, 'lp: Error - The printer or class does not exist.');
    const t = await CupsTransport.open({ printer: 'ghost', spawn });
    const error = await t.write(Uint8Array.of(1)).catch((e) => e);
    expect(isEscposError(error) && error.code).toBe('WRITE_FAILED');
    expect(error.hint).toMatch(/does not exist/);
  });

  it('one job per write, in order', async () => {
    const { spawn, calls } = fakeLp();
    const t = await CupsTransport.open({ spawn });
    await Promise.all([t.write(Uint8Array.of(1)), t.write(Uint8Array.of(2))]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.stdin[0]![0])).toEqual([1, 2]);
  });
});
