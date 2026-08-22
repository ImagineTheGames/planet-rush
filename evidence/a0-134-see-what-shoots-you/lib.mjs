/**
 * evidence/a0-134-see-what-shoots-you/lib.mjs — the rig, which is a0-131's rig.
 * OWNER: UI Engineer (a0-134).
 *
 * a0-134 is a re-stage of a0-131 item 2, so it is measured with a0-131's own
 * ruler and nothing else: the two profiles, the two clients, `frame()` writing
 * the PNG and `note()` writing the JSON readback beside it as separate calls, are
 * re-exported from `../a0-131-online-with-eyes/lib.mjs` unchanged. A re-stage
 * measured against a NEW ruler is not a re-stage.
 *
 * What is added here is the one seam this brief is about: `viewStage`, the
 * `?debug=1`-free `window.__viewStage` a0-74 installed, which reports the
 * renderer's OWN visible-world rectangle (`renderer.visibleWorld` — the very box
 * the cull culls against) rather than a number this file computed. The whole
 * finding is a comparison between that rectangle and a weapon range, so neither
 * half may be arithmetic written in the evidence.
 */
export {
  HERE,
  DESKTOP,
  PHONE,
  frame,
  note,
  bothFrames,
  client,
  doors,
  readback,
  sleep,
  launch,
} from '../a0-131-online-with-eyes/lib.mjs';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(ROOT, 'shots');

/**
 * The view, off the shipped bundle: the world rectangle the renderer drew, the
 * viewport it drew it in, the seated rung, and the zoom control's own report of
 * itself. Everything the finding needs, and nothing derived here.
 */
export const viewStage = (page) =>
  page.evaluate(() => {
    const s = window.__viewStage;
    if (!s) return null;
    return { world: s.world(), viewport: s.viewport(), zoom: s.zoom(), control: s.control() };
  });

/** Where the local ship actually is, and where the other ships are — the seam
 *  `?debug=1` installs for QA. Used to state a standoff in world units rather
 *  than eyeballing a gap on a plate. */
export const shipStage = (page) =>
  page.evaluate(() => {
    const d = window.__debug;
    if (!d) return null;
    return typeof d.ships === 'function' ? d.ships() : null;
  });
