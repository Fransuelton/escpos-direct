# Contributing

The most valuable contribution to this project is not code — it is a
**compatibility report**. Everything here has been verified on one printer, and
the ESC/POS "standard" is a family of dialects. If you have a thermal printer,
[tell us how it behaves](https://github.com/Fransuelton/escpos-direct/issues/14).

> 🇧🇷 Issues e PRs em português são bem-vindos. O código e o histórico ficam em
> inglês, mas a conversa pode ser no seu idioma.

## Getting started

```bash
npm install
npm test          # the whole suite, no printer required
npm run typecheck
npm run lint
```

The tests need no hardware. Layout is a pure function of its input, and even the
USB transport is covered with a fake `USBDevice` — which is possible because it
is written against the standard WebUSB interface rather than a Node-specific
one.

Only two things need a real printer:

```bash
node examples/spike.mjs   # claims the interface, prints nothing without --write
node examples/status.mjs  # reads DLE EOT
```

## Working on it

- **Code, identifiers and error messages in English.** It is a public library;
  a Portuguese API would cut its reach.
- **Comments explain why, not what.** JSDoc on the public surface; a comment
  elsewhere should be earning its place.
- **The main entry point stays pure** — no I/O, no native modules, no
  dependencies. It runs in a browser, and that is a promise worth keeping.
  Transports live behind subpath imports.
- **Behaviour comes with a test.** Prefer a byte snapshot or decoded text over
  an assertion about an array index.
- **Never declare an export the build does not emit.** `npm run check:exports`
  enforces this; publishing a broken entry point cannot be undone.

Several invariants exist because of a real bug on real paper — `ESC t` after
`ESC @`, CP850 not being Latin-1, halved columns at double width. They carry a
comment saying so. Read it before simplifying one.

## Commits and pull requests

Semantic, lean, in English:

```
feat: read printer status over DLE EOT
fix: keep manual spacing in printed text
docs: cli
```

Atomic commits, please — one coherent change each, even when several land in the
same PR. It makes `git bisect` and a surgical revert possible later.

Add a changeset describing the user-visible effect:

```bash
npm run changeset
npx changeset add --empty   # for tooling or docs, which ship no release
```

## What gets tested where

|                                         | Where                              |
| --------------------------------------- | ---------------------------------- |
| Layout, code pages, commands, dithering | Unit tests, no hardware            |
| USB claim, write, release               | Fake `USBDevice`, plus manual runs |
| Actual print quality, scannable codes   | A human, with paper                |

The last row is why compatibility reports matter so much. There is no substitute
for someone looking at a strip of paper.
