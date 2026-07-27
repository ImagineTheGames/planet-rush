// evidence/_merge-entry.mjs — QA helper: merge one entry JSON into manifest.json by id.
// Usage: node evidence/_merge-entry.mjs /tmp/entry.json   (upserts by .id)
// This is a local manifest-editing convenience for the QA Manager; it touches only
// evidence/manifest.json. Removed before the PR is not required (other _*.mjs helpers
// live here too), but it writes nothing outside evidence/.
import { readFileSync, writeFileSync } from 'node:fs';
const entry = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const path = new URL('./manifest.json', import.meta.url);
const m = JSON.parse(readFileSync(path, 'utf8'));
const i = m.findIndex((x) => x.id === entry.id);
if (i >= 0) m[i] = entry; else m.push(entry);
writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
console.log(`${i >= 0 ? 'updated' : 'added'} ${entry.id}; manifest entries: ${m.length}`);
