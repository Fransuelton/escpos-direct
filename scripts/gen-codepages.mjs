/**
 * Gera as tabelas de code page a partir do `iconv` do sistema (ADR-02).
 *
 * Digitar 128 entradas à mão é como se erra acentuação silenciosamente: o byte
 * errado não quebra nada, só sai um caractere torto no papel meses depois. O
 * iconv é fonte autoritativa e o resultado é conferível.
 *
 *   node scripts/gen-codepages.mjs > src/codepage/tables.ts
 */
import { execFileSync } from 'node:child_process';

// CP850 é o padrão para português. CP860 é a página "Portugal" e algumas
// impressoras baratas só têm ela. CP437 é o default de fábrica da maioria.
// CP1252 aparece em impressora chinesa que ignora `ESC t`.
const PAGES = {
  cp437: 0, cp850: 2, cp860: 3, cp863: 4, cp865: 5, cp858: 19, cp1252: 16,
};

/** Byte alto -> caractere Unicode, segundo o iconv. */
function decode(page) {
  const out = new Map();
  for (let b = 0x80; b <= 0xff; b++) {
    try {
      const s = execFileSync('iconv', ['-f', page.toUpperCase(), '-t', 'UTF-8'], {
        input: Buffer.from([b]),
        stdio: ['pipe', 'pipe', 'ignore'],
      }).toString('utf8');
      if (s.length) out.set(b, s);
    } catch {
      // byte sem mapeamento nesta página — fica de fora
    }
  }
  return out;
}

let ts = `// GERADO POR scripts/gen-codepages.mjs — NÃO EDITE À MÃO.
// Fonte: iconv do sistema. Regenere com \`npm run gen:codepages\`.

/** Valor de \`n\` em \`ESC t n\` para cada página. */
export const ESC_T: Record<string, number> = ${JSON.stringify(PAGES, null, 2)
  .replace(/"([a-z0-9]+)":/g, '$1:')};

/** Unicode -> byte, por página. Só a faixa alta; 0x00–0x7F é ASCII puro. */
export const TABLES: Record<string, Record<string, number>> = {
`;

for (const page of Object.keys(PAGES)) {
  const map = decode(page);
  const pares = [...map].map(([b, ch]) => `${JSON.stringify(ch)}:${b}`);
  ts += `  ${page}: {${pares.join(',')}},\n`;
  process.stderr.write(`  ${page}: ${map.size} caracteres\n`);
}

ts += `};

export type CodePage = keyof typeof ESC_T;
`;

process.stdout.write(ts);
