# escpos-direct

Impressão térmica ESC/POS para Node e navegador, escrevendo **direto no endpoint
USB** — sem CUPS, sem fila de impressão, sem spooler estragando os seus bytes.

> 🇬🇧 [Read in English](README.md)

**Status: início.** O núcleo do encoder e os transportes estão prontos e
testados; imagem, código de barras e CLI vêm a seguir.

```ts
import { Receipt, mm58 } from 'escpos-direct';

const nota = new Receipt(mm58)
  .reset()                                   // ESC @, e só depois ESC t
  .align('center').bold(true).line('MINHA LOJA').bold(false)
  .align('left').rule()
  .item('2x Coxinha', 'R$ 7,00')             // quebra por palavra, valor à direita
  .item('1x Bolo de Pote - Ninho', 'R$ 18,00')
  .rule()
  .total('TOTAL', 'R$ 25,00')                // altura dupla, colunas divididas por você
  .feed();                                   // passa da serrilha

const bytes = nota.encode();                 // Uint8Array — sem hardware nenhum
```

E aí manda para a impressora:

```ts
import { UsbTransport } from 'escpos-direct/usb';

await using impressora = await UsbTransport.open();
await impressora.write(bytes);
```

## Por que não sai acento na minha impressora?

Essa é a pergunta que originou o projeto, e ela quase nunca tem resposta em
português. São cinco armadilhas, todas silenciosas:

**1. O `ESC t` tem que vir *depois* do `ESC @`.**
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
npm install escpos-direct
```

O núcleo tem **zero dependências** e não compila nada. O `usb` é dependência
opcional, só entra se você usar o transporte USB — e vem com binário pronto, sem
etapa de compilação.

## Transportes

O encoder é puro e a entrega é trocável: escolher transporte não muda uma linha
de como a nota é montada.

| Import | Como imprime | Quando usar |
|---|---|---|
| `escpos-direct/usb` | Endpoint bulk, via WebUSB | O padrão. O mesmo arquivo roda no Chrome — passe `{ usb: navigator.usb }` |
| `escpos-direct/cups` | `lp -o raw` | Onde o claim da interface falha: Windows, Linux sem regra udev, fila compartilhada |
| `escpos-direct/file` | Escreve num caminho | `/dev/usb/lp0` no Linux, ou capturar o payload para comparar |

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
  console.error(e.code);     // 'CLAIM_FAILED'
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

## Licença

MIT © Fransuelton
