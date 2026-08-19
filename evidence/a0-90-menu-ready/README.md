# a0-90 — the menu was ready 0.5–0.7 s before it would answer

- **`audit.txt`** — the measurement, the numbers, and what was rejected. Read this.
- **`measure.mjs`** — the harness. Playwright against a real `vite preview`
  bundle; `BASE=` points it at another one, so before and after are the same
  script run twice.
- **`shots/`** — four instants, before and after, on both device profiles. The
  eight PNGs are byte-identical per device: the same finished-looking menu, three
  of which refuse a press on the code as it shipped.

Reproduce:

```sh
npx vite build && npx vite preview --port 4199 --strictPort &
BASE=http://localhost:4199/ CLICKS=1 node evidence/a0-90-menu-ready/measure.mjs
```
