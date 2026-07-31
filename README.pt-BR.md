# escpos-direct

[![npm](https://img.shields.io/npm/v/escpos-direct?color=cb3837&logo=npm)](https://www.npmjs.com/package/escpos-direct)
[![CI](https://github.com/Fransuelton/escpos-direct/actions/workflows/ci.yml/badge.svg)](https://github.com/Fransuelton/escpos-direct/actions/workflows/ci.yml)
[![dependências de runtime](https://img.shields.io/badge/deps%20de%20runtime-0-brightgreen)](https://www.npmjs.com/package/escpos-direct?activeTab=dependencies)
[![licença](https://img.shields.io/npm/l/escpos-direct?color=blue)](LICENSE)

Impressão térmica ESC/POS para Node e navegador, escrevendo **direto no endpoint
USB** — sem CUPS, sem fila de impressão, sem spooler estragando os seus bytes.

> 🇬🇧 [Read in English](README.md)

**Status: início.** O núcleo do encoder e os transportes estão prontos e
testados; imagem, código de barras e CLI vêm a seguir.

```ts
import { Receipt, mm58 } from 'escpos-direct';

const nota = new Receipt(mm58)
  .reset() // ESC @, e só depois ESC t
  .align('center')
  .bold(true)
  .line('MINHA LOJA')
  .bold(false)
  .align('left')
  .rule()
  .item('2x Coxinha', 'R$ 7,00') // quebra por palavra, valor à direita
  .item('1x Bolo de Pote - Ninho', 'R$ 18,00')
  .rule()
  .total('TOTAL', 'R$ 25,00') // altura dupla, colunas divididas por você
  .feed(); // passa da serrilha

const bytes = nota.encode(); // Uint8Array — sem hardware nenhum
```

E aí manda para a impressora:

```ts
import { UsbTransport } from 'escpos-direct/usb';

await using impressora = await UsbTransport.open();
await impressora.write(bytes);
```

## CLI

```bash
npx escpos-direct doctor           # por que não imprime nesta máquina?
npx escpos-direct devices          # lista USB e marca quem é classe impressora
npx escpos-direct test             # página de teste: acento, régua, estilos, códigos
npx escpos-direct print nota.txt   # ou - para ler do stdin
npx escpos-direct preview nota.txt # renderiza no terminal, em escala
```

O `doctor` é a razão de tudo isto existir. Ele percorre ambiente, backend USB,
dispositivos, o claim, o status ao vivo e as filas do CUPS — e cada falha vem
com o hint da sua plataforma:

```
Claim
✓ Claimed interface 0 without root

Status
✓ Printer reports ready
· printer=0x12 offline=0x12 error=0x12 paper=0x12
```

O `preview` desenha a nota dentro da largura do papel e marca em vermelho
qualquer linha que estoure, decodificando pela code page — então page errada
aparece antes de custar papel. Em qualquer comando que imprime, `--file
saida.bin` grava bytes em vez de papel, e `--cups <fila>` manda pelo CUPS.

## Por que não sai acento na minha impressora?

Essa é a pergunta que originou o projeto, e ela quase nunca tem resposta em
português. São cinco armadilhas, todas silenciosas:

**1. O `ESC t` tem que vir _depois_ do `ESC @`.**
O reset zera a code page selecionada. Mandar na ordem contrária não faz nada, e
a impressora fica na página de fábrica dela. É a causa nº 1 de acento quebrado.

**2. Codificar em CP850 não é a mesma coisa que Latin-1.**
`Buffer.from(s, 'latin1')` põe o `ç` em `0xE7`; a CP850 põe em `0x87`. O Node não
tem CP850 nativa, então esta lib carrega as próprias tabelas — geradas pelo
`iconv` do sistema, não digitadas à mão.

**3. No macOS, a fila CUPS quase sempre nasce com driver PostScript genérico.**
Sem `-o raw`, seus bytes ESC/POS passam pelo filtro e viram lixo. Esta lib pula o
CUPS inteiro.

**4. Em altura/largura dobrada, a linha tem metade das colunas.**
Alinhar o `TOTAL` contra 32 colunas com a impressora em modo dobrado joga o valor
para fora do papel. O builder rastreia o tamanho da fonte e faz a conta sozinho.

**5. Impressora de 58mm barata não tem guilhotina.**
Sem os LFs finais, o rodapé para atrás da serrilha e você rasga por cima do
texto.

Emoji, a lib descarta de propósito — sairiam como `?` e sujariam a nota. Acento,
ela preserva: é justamente para isso que a code page existe.

## Instalação

```bash
npm install escpos-direct            # só o encoder — não vem mais nada junto
npm install escpos-direct usb        # ...com o transporte USB
```

O núcleo tem **zero dependências** e não compila nada. O `usb` é _peer
opcional_: você instala por conta, e só se for imprimir por USB. Quem só gera
bytes no navegador não baixa um módulo nativo que nunca vai carregar.

Ele vem com binário pronto, então acrescentá-lo continua não sendo etapa de
compilação.

## Transportes

O encoder é puro e a entrega é trocável: escolher transporte não muda uma linha
de como a nota é montada.

| Import               | Como imprime              | Quando usar                                                                        |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `escpos-direct/usb`  | Endpoint bulk, via WebUSB | O padrão. O mesmo arquivo roda no Chrome — passe `{ usb: navigator.usb }`          |
| `escpos-direct/cups` | `lp -o raw`               | Onde o claim da interface falha: Windows, Linux sem regra udev, fila compartilhada |
| `escpos-direct/file` | Escreve num caminho       | `/dev/usb/lp0` no Linux, ou capturar o payload para comparar                       |

O `await using` não é enfeite. Ele libera a interface quando o bloco termina, e
**liberar é a condição para o CUPS continuar funcionando depois**. Sem ele, uma
exceção no meio da nota deixa a impressora reivindicada até o processo morrer.

```ts
await using impressora = await UsbTransport.open({ vendorId: 0x09c5 });
await impressora.write(bytes);
```

### O erro te diz o que fazer

Toda falha é um `EscposError` com `code` para o programa decidir, `cause` para o
log e **`hint` para a pessoa** — a frase específica da sua plataforma que, sem
isso, custa uma tarde de procura:

```ts
import { isEscposError } from 'escpos-direct';

try {
  await using impressora = await UsbTransport.open();
  await impressora.write(bytes);
} catch (e) {
  if (!isEscposError(e)) throw e;
  console.error(e.code); // 'CLAIM_FAILED'
  console.error(e.format()); // e, no Linux: "O driver usblp do kernel costuma
  //    segurar a interface: sudo modprobe -r usblp"
}
```

Códigos: `DEVICE_NOT_FOUND`, `CLAIM_FAILED`, `OUT_OF_PAPER`, `OFFLINE`,
`WRITE_FAILED`, `UNSUPPORTED`.

> As mensagens e os `hint` saem em inglês, como o resto da API — é lib pública.
> A explicação em português é esta aqui.

## USB direto funciona mesmo no macOS?

Funciona. Verificado no macOS 26.5.2 (Apple Silicon), Node 24, contra uma YiDa
YD583: o `claimInterface()` passa **sem root e com a fila CUPS habilitada**.

O macOS não gruda driver exclusivo do kernel em interface de classe impressora
como o `usblp` do Linux faz — não há o que destacar. Dá para conferir na sua:

```bash
ioreg -p IOService -w0 -l -r -n "SUA_IMPRESSORA" | grep -E '\+-o |bInterfaceClass'
```

Uma `IOUSBHostInterface` com `bInterfaceClass = 7` e nenhum driver filho quer
dizer que a interface está livre.

E o CUPS continua funcionando depois, desde que a interface seja liberada — o que
o transporte faz por você com `await using`.

## Imagem

```ts
nota.align('center').image(logo, { dither: 'atkinson' });
```

Recebe pixels RGBA crus — o mesmo formato do `ImageData` do navegador, então um
canvas entra direto. Decodificar PNG ou JPEG não é trabalho do núcleo: custaria
uma dependência nativa e a promessa de rodar em qualquer lugar.

| Dither              | Use para                              |
| ------------------- | ------------------------------------- |
| `atkinson` (padrão) | Logo e arte de linha — mais contraste |
| `floyd-steinberg`   | Foto e gradiente suave                |
| `bayer`             | Rápido, textura xadrez regular        |
| `none`              | Entrada que já é preto e branco       |

**O Atkinson propaga só 6/8 do erro e descarta o resto.** É isso que segura o
contraste, e é também por isso que ele perde detalhe nos extremos: impresso
contra um gradiente inteiro, o Atkinson para de marcar pontos perto da ponta
clara enquanto o Floyd-Steinberg vai até o fim. Para logo, contraste é a troca
certa; para foto, detalhe é.

Imagem mais larga que o papel lança erro em vez de imprimir — a impressora
cortaria calada, e um logo sem a borda direita passa despercebido numa
conferência rápida.

## Código de barras e QR (inclusive PIX)

```ts
nota
  .barcode('789123456789', { symbology: 'ean13', hri: 'below', height: 60 })
  .qr(payloadPix, { size: 6, correction: 'M' });
```

Nove simbologias (`code128` por padrão, mais EAN-13/8, UPC-A/E, CODE39, CODE93,
ITF e Codabar), com controle de altura, largura do módulo e onde saem os
dígitos legíveis.

**Dado inválido lança erro em vez de imprimir.** Impressora que recebe um código
de barras que não sabe codificar não imprime nada e não reclama — a nota sai com
um buraco no lugar. Então o `ean13` exige seus 12 ou 13 dígitos, o `itf` exige
quantidade par, e o CODE128 ganha o prefixo de code set `{B` quando você não
passa nenhum — sem ele, muita impressora fica muda.

No QR, o payload entra literal, então **o PIX não precisa de nada especial**:

```ts
nota.align('center').qr(brCode, { size: 6 });
```

Os bytes do QR são escritos crus, de propósito fora da code page: QR carrega
bytes e quem decide como lê-los é o leitor.

## Status da impressora: medido, não prometido

```ts
await using impressora = await UsbTransport.open();

const status = await impressora.status();
if (!status.ready) throw new Error(status.reason);
await impressora.write(bytes);
```

Tempo real, direto do firmware — responde até enquanto a impressora está
imprimindo, e não passa por fila nenhuma. Você recebe `ready`, `paper`
(`ok` / `near-end` / `out`), `coverOpen`, `drawerOpen`, `error`, um `reason` de
uma frase e os quatro bytes `raw` para o seu log.

E isto não é a especificação repetida: são três estados medidos numa YiDa
YD583, abrindo a tampa e tirando o rolo na mão:

| Consulta      | Fechada, com papel | Tampa aberta        | Sem papel, fechada |
| ------------- | ------------------ | ------------------- | ------------------ |
| `n=1` status  | `0x12`             | `0x1a` offline      | `0x1a`             |
| `n=2` offline | `0x12`             | `0x32` fim de papel | `0x32`             |
| `n=3` erro    | `0x12`             | `0x12`              | `0x12`             |
| `n=4` sensor  | `0x12`             | `0x72` fim de papel | `0x72`             |

Os bits 1 e 4 são fixos em 1 — por isso `0x12` é a base de "está tudo bem".

**Tampa aberta e sem papel dão exatamente o mesmo byte.** Esta impressora nunca
levanta o bit de tampa aberta (`0x04` na consulta 2) que a especificação define:
abrir a tampa desarma o sensor de papel, e esse sensor é o único que ela tem.

Então o `status()` reporta **um** estado e explica, em vez de fingir que
distingue os dois:

```
ready: false | paper: out | coverOpen: false
reason: out of paper, or the cover is open — many thermal printers report
        both identically, because opening the cover lifts the paper sensor
```

Se a sua impressora levantar o `0x04`, aí sim o `coverOpen` vem `true` e o
motivo diz isso direto. Em interface só de escrita, o `status()` lança
`UNSUPPORTED` em vez de travar — cheque o `canReadStatus` antes se quiser
decidir na hora.

Essa é a parte que ninguém documenta, e é o motivo de estar escrita aqui: se
você procurou "impressora térmica diz que está sem papel mas tem papel", a
resposta provável é que a tampa não fechou direito.

## Licença

MIT © Fransuelton
