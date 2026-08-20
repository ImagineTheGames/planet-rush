/**
 * evidence/a0-118-the-four-fixes/manifest-entries.mjs — append a0-118's entries to
 * evidence/manifest.json. OWNER: QA Manager (a0-118).
 *
 * Idempotent: an entry whose id is already in the manifest is REPLACED, never
 * duplicated, so a re-run after a re-capture updates the record in place.
 *
 *   node evidence/a0-118-the-four-fixes/manifest-entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '../manifest.json');
const ENTRIES = JSON.parse(readFileSync(join(HERE, 'entries.json'), 'utf8'));

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const entry of ENTRIES) {
  const at = manifest.findIndex((e) => e.id === entry.id);
  if (at >= 0) manifest[at] = entry;
  else manifest.push(entry);
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${ENTRIES.length} entries; manifest now ${manifest.length}`);
