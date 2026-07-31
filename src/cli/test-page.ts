import type { CliOptions } from '../cli.js';
import { Receipt } from '../receipt.js';
import type { Profile } from '../profile.js';
import { openTransport, resolveProfile } from './context.js';
import { dim, heading, info, ok } from './ui.js';

/** A page that makes every common failure visible at a glance. */
export function testPage(profile: Profile): Uint8Array {
  const r = new Receipt(profile);
  const cols = profile.columns;

  r.reset()
    .align('center')
    .bold(true)
    .line('ESCPOS-DIRECT')
    .bold(false)
    .line(`${profile.columns} columns · ${profile.dots} dots · ${profile.codePage}`)
    .align('left')
    .rule();

  // A ruler: if the digits do not end flush with the rule above, the profile is
  // wrong for this paper.
  r.line('Column ruler');
  r.line(
    Array.from({ length: cols }, (_, i) => ((i + 1) % 10 === 0 ? '0' : String((i + 1) % 10))).join(''),
  );
  r.rule();

  r.line('Accents (code page check)');
  r.line('ção não é açaí, coração');
  r.line('pão, ôvo, três, você, Ç');
  r.line('Emoji dropped 😀 accents kept');
  r.rule();

  r.line('Styles');
  r.bold(true).line('bold').bold(false);
  r.underline(true).line('underline').underline(false);
  r.size(2).line('double').size(1);
  r.rule();

  r.line('Alignment');
  r.align('left').line('left');
  r.align('center').line('center');
  r.align('right').line('right');
  r.align('left').rule();

  r.line('Columns');
  r.item('2x Item with a long description that wraps', '99,00');
  r.sub('sub-line, no value');
  r.pair('Subtotal', '99,00');
  r.total('TOTAL', '99,00');
  r.rule();

  r.line('Codes');
  r.align('center')
    .barcode('123456789012', { symbology: 'ean13', height: 50, hri: 'below' })
    .feed(1)
    .qr('https://github.com/Fransuelton/escpos-direct', { size: 5 })
    .feed(1)
    .align('left')
    .rule();

  return r.align('center').line('end of test page').feed().encode();
}

export async function testPageCommand(values: CliOptions): Promise<number> {
  const profile = resolveProfile(values);
  const bytes = testPage(profile);

  heading('Test page');
  info(`${bytes.length} bytes · ${profile.columns} columns · ${profile.codePage}`);

  await using transport = await openTransport(values);
  if (values.status !== false && 'status' in transport) {
    const status = await (transport as { status(): Promise<{ ready: boolean; reason?: string }> })
      .status()
      .catch(() => undefined);
    if (status && !status.ready) {
      info(dim(`printer says: ${status.reason}`));
    }
  }
  await transport.write(bytes);
  ok('Sent. Check the paper for accents, ruler alignment and the codes.');
  return 0;
}
