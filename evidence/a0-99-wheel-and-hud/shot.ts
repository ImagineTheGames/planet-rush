/**
 * evidence/a0-99-wheel-and-hud/shot.ts — the two things every a0-99 capture does.
 * OWNER: QA Manager (a0-99).
 *
 * `frame()` writes a PNG under ./shots. `note()` writes the JSON readback beside
 * it. They are separate calls on purpose: the manifest attestation is written off
 * the PNG, and the JSON is only ever a cross-check — a0-96's rule, kept, because
 * the day the two disagree the image is the finding and the disagreement is the
 * story.
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

/** Rectangle intersection in the logical viewport the registry reports in.
 *  "Drawn over" is, mechanically, a non-empty intersection of two rendered
 *  rects — the brief's HUD question made arithmetic instead of eyeballed. */
export function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bot = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bot <= y) return null;
  return { x, y, width: r - x, height: bot - y };
}
