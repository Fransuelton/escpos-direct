# escpos-direct

Impressão térmica ESC/POS para Node e navegador, escrevendo **direto no endpoint
USB** — sem CUPS, sem fila de impressão, sem spooler estragando os seus bytes.

> 🇬🇧 [Read in English](README.md)

**Status: início.** O núcleo do encoder está pronto e testado; os transportes
vêm a seguir.

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
