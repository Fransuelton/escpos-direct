import type { CliOptions } from '../cli.js';
import { openTransport, resolveProfile } from './context.js';
import { fromText, readSource } from './document.js';
import { dim, info, ok, warn } from './ui.js';

export async function print(path: string | undefined, values: CliOptions): Promise<number> {
  const profile = resolveProfile(values);
  const bytes = fromText(await readSource(path), profile).encode();

  await using transport = await openTransport(values);

  if (values.status !== false && 'status' in transport) {
    const status = await (
      transport as { status(): Promise<{ ready: boolean; reason?: string }> }
    )
      .status()
      .catch(() => undefined);
    if (status && !status.ready) {
      warn(`Printer is not ready: ${status.reason}`);
      info(dim('Pass --no-status to send anyway.'));
      return 1;
    }
  }

  await transport.write(bytes);
  ok(`Sent ${bytes.length} bytes.`);
  return 0;
}
