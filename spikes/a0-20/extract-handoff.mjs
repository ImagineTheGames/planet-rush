#!/usr/bin/env node
/**
 * spikes/a0-20/extract-handoff.mjs — THROWAWAY. Not part of the build.
 *
 * `docs/design/gantry-bone-handoff.html` is the ratified Gantry/Bone artefact, but
 * it ships as a single JSON-escaped line, so `grep -n` on it returns one useless
 * line number and no context. Every citation in `docs/theme-coverage.md` that
 * quotes the DESIGN (rather than the code) is read through this script, so a
 * reader can reproduce the quote instead of trusting it.
 *
 * Usage, from the repo root:
 *
 *   node spikes/a0-20/extract-handoff.mjs                 # list the screens
 *   node spikes/a0-20/extract-handoff.mjs 5a              # print screen 5a's markup
 *   node spikes/a0-20/extract-handoff.mjs 5a | grep -n conic
 *   node spikes/a0-20/extract-handoff.mjs --raw > /tmp/handoff.html
 *
 * The screen ids are the design's own (`<div id="5a">` … `BUILD WHEEL`).
 *
 * No dependencies, no writes outside stdout. Node 18+.
 */

import { readFileSync } from 'node:fs';

const SRC = 'docs/design/gantry-bone-handoff.html';

/** The file is one giant escaped string on its longest line. Unescape it. */
function html() {
  const raw = readFileSync(SRC, 'utf8');
  let longest = '';
  for (const line of raw.split('\n')) if (line.length > longest.length) longest = line;
  try {
    return JSON.parse(longest);
  } catch {
    // Not valid JSON on its own (it is a fragment) — undo the escapes by hand.
    return longest
      .replace(/\\u002F/g, '/')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/** Every `<div id="…">` screen in the file, with the line it starts on. */
function screens(doc) {
  const out = [];
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /<div id="([^"]+)"/.exec(lines[i]);
    if (!m) continue;
    // The design labels each screen with an Audiowide caption a line or two down.
    const near = lines.slice(i, i + 6).join(' ');
    const title = /font-size:26px;color:#DCE3EC;">([^<]+)</.exec(near);
    out.push({ id: m[1], line: i + 1, title: title ? title[1] : '' });
  }
  return out;
}

/** The markup of one screen: from its opening div to the next screen's. */
function screen(doc, id) {
  const all = screens(doc);
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const lines = doc.split('\n');
  const from = all[idx].line - 1;
  const to = idx + 1 < all.length ? all[idx + 1].line - 1 : lines.length;
  return lines.slice(from, to).join('\n');
}

const arg = process.argv[2];
const doc = html();

if (arg === '--raw') {
  process.stdout.write(doc);
} else if (!arg) {
  console.log(`${SRC} — ${doc.length} chars unescaped\n`);
  for (const s of screens(doc)) console.log(`  ${s.id.padEnd(6)} line ${String(s.line).padStart(5)}  ${s.title}`);
  console.log('\nPass a screen id to print its markup.');
} else {
  const body = screen(doc, arg);
  if (body === null) {
    console.error(`no screen "${arg}" — run with no argument to list them`);
    process.exit(1);
  }
  process.stdout.write(body + '\n');
}
