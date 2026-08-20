/**
 * evidence/a0-111-yesterday-with-eyes/shot.ts — the two things every a0-111
 * capture does. OWNER: QA Manager (a0-111).
 *
 * `frame()` writes a PNG under ./shots. `note()` writes the JSON readback beside
 * it. They are separate calls on purpose: the manifest attestation is written off
 * the PNG, and the JSON is only ever a cross-check — a0-96's rule, kept through
 * a0-99, because the day the two disagree the image is the finding and the
 * disagreement is the story.
 */
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');

export async function frame(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

export function note(name: string, data: unknown): void {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
