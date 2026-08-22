/**
 * evidence/a0-132-say-when-the-line-drops/lib.mjs — a0-131's two clients, pointed
 * at this lane's fleet, plus the two readbacks this brief needs. OWNER: Netcode
 * Engineer (a0-132).
 *
 * The profiles, the `frame`/`note` split and the `bothFrames` caveat are a0-131's
 * and are re-exported unchanged, so a frame here is comparable with a frame there.
 * What is added is the pair of readbacks a0-131 had no reason to take: the
 * CONNECTION LOST overlay as it exists **in the DOM** (`src/net/link-loss-view`),
 * and the presence lines the HUD model is holding (`src/ui/peer-presence`). Both
 * are read off the shipped bundle; neither is injected.
 */
export { frame, note, bothFrames, doors, readback, sleep, launch, DESKTOP, PHONE, client, SHOTS as A131_SHOTS }
  from '../a0-131-online-with-eyes/lib.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');

/** The CONNECTION LOST overlay, as the page actually has it — present or absent,
 *  and if present, the words and the buttons a thumb could hit. Reads the DOM, not
 *  a seam: this is the half a0-131 photographed as blank. */
export const overlay = (page) => page.evaluate(() => {
  const root = document.getElementById('pr-link-loss');
  if (!root) return { mounted: false };
  const shown = root.innerHTML.length > 0;
  const box = root.getBoundingClientRect();
  return {
    mounted: true,
    shown,
    html: root.innerHTML.length,
    title: document.getElementById('pr-link-loss-title')?.textContent ?? null,
    detail: document.getElementById('pr-link-loss-detail')?.textContent ?? null,
    buttons: [...root.querySelectorAll('button')].map((b) => ({ id: b.id, label: b.textContent })),
    rect: { x: box.x, y: box.y, w: box.width, h: box.height },
  };
});

/** What the HUD's presence model is holding, and what the view actually drew. */
export const presence = (page) => page.evaluate(() => {
  const stage = window.__presenceStage;
  return stage ? { lines: stage.lines?.() ?? null, drawn: stage.drawn?.() ?? null } : null;
});

/** The session's own account of the link, through the shipped read-back seam. */
export const link = (page) => page.evaluate(() => {
  const s = window.__cornerStage;
  return s ? { phase: s.linkPhase?.() ?? null, ...(s.session?.() ?? {}) } : null;
});
