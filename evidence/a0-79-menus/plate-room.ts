/**
 * evidence/a0-79-menus/plate-room.ts — how much field the menu plates leave, and
 * whether the labels still fit when they leave more. OWNER: UI Engineer (a0-79).
 *
 *   npx vite-node evidence/a0-79-menus/plate-room.ts
 *
 * Two questions, one instrument, no browser:
 *
 *  1. **The margin.** For a sweep of viewports, what fraction of the screen is
 *     field on each side of the plate column? The developer's complaint is that
 *     on a phone the answer is ~3%, i.e. the plates run edge to edge; the
 *     handoff's own desktop answer is 18.75% (an 800px column on 1280px), and
 *     that is the number a phone should be reading too.
 *
 *  2. **The labels.** A margin is only free if nothing inside the plate is
 *     squeezed by it. `src/ui/font-metrics.ts` is the repo's measured advance
 *     table, so the width of every label and sub-line on the menu is arithmetic
 *     here rather than a browser screenshot — which is what lets the narrow
 *     PORTRAIT case (the opposite constraint to the developer's landscape phone)
 *     be checked at all.
 *
 * It reads the SHIPPED layout for the "after" column, so re-running it after the
 * fix is a real before/after rather than two predictions.
 */
import { writeFileSync } from 'node:fs';
import {
  COLUMN,
  DISPLAY_TRACKING,
  PLATE_SCALES,
  TRACKING,
  frameMetrics,
  plateTypeSize,
  platePadX,
} from '../../src/art/materials';
import { gantryFrame } from '../../src/ui/gantry';
import { MAIN_MENU_ITEMS, itemPlate, mainMenuLayout } from '../../src/ui/main-menu';
import { textWidth } from '../../src/ui/font-metrics';

/** The handoff's own proportion: an 800px column on the 1280px reference. */
const HANDOFF_COLUMN_SHARE_OF_VIEWPORT = COLUMN.title / 1280;

const VIEWPORTS = [
  { name: "phone landscape 798x384 (developer's screenshot)", w: 798, h: 384 },
  { name: 'phone portrait-held 844x390 (logical, landscape lock)', w: 844, h: 390 },
  { name: 'phone PORTRAIT 390x844 (unlocked logical)', w: 390, h: 844 },
  { name: 'phone PORTRAIT narrow 360x780', w: 360, h: 780 },
  { name: 'reference desktop 1280x720', w: 1280, h: 720 },
  { name: 'desktop 1920x1080', w: 1920, h: 1080 },
  { name: 'ultrawide 3440x1440', w: 3440, h: 1440 },
];

/** The label/sub type sizes `main-menu-view.ts` draws with. */
const LABEL_PX = { primary: 27, secondary: 21 } as const;
const SUB_PX = 13;
const TICK_GAP = 24;

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  console.log(s);
};

say('a0-79 — the room the main-menu plates leave, and what still fits in them');
say('='.repeat(78));
say('');
say(`The handoff draws an ${COLUMN.title}px column on a ${1280}px screen:`);
say(`  the plates take ${(HANDOFF_COLUMN_SHARE_OF_VIEWPORT * 100).toFixed(1)}% of the viewport and leave`);
say(`  ${(((1 - HANDOFF_COLUMN_SHARE_OF_VIEWPORT) / 2) * 100).toFixed(2)}% of it as field on EACH side.`);
say('That is the proportion every viewport should read, and the one this measures against.');
say('');

for (const v of VIEWPORTS) {
  const layout = mainMenuLayout({ width: v.w, height: v.h });
  const frame = gantryFrame({ width: v.w, height: v.h });
  const m = frameMetrics(v.w, v.h);
  const plate = layout.buttons[0];
  if (!plate) continue;
  const left = plate.x;
  const right = v.w - (plate.x + plate.width);
  say(`── ${v.name}`);
  say(
    `   band ${frame.band.width.toFixed(0)}  column ${plate.width.toFixed(1)}` +
      `  (${((plate.width / frame.band.width) * 100).toFixed(1)}% of band,` +
      ` ${((plate.width / v.w) * 100).toFixed(1)}% of viewport)`,
  );
  say(
    `   side field  left ${left.toFixed(1)}px  right ${right.toFixed(1)}px` +
      `  = ${((left / v.w) * 100).toFixed(2)}% of the viewport each side`,
  );

  // Does every plate's text still fit its own width?
  let worst = { name: '', slack: Number.POSITIVE_INFINITY, need: 0, room: 0 };
  for (let i = 0; i < MAIN_MENU_ITEMS.length; i++) {
    const item = MAIN_MENU_ITEMS[i]!;
    const rect = layout.buttons[i];
    if (!rect) continue;
    const { scale } = itemPlate(item);
    const padX = platePadX(scale, m);
    const tick = PLATE_SCALES[scale].tickWidth;
    const textX = padX + tick + Math.max(8, Math.round(TICK_GAP * m.plateScale));
    const room = rect.width - textX - padX;
    const labelPx = plateTypeSize(item.primary ? LABEL_PX.primary : LABEL_PX.secondary, m);
    const subPx = plateTypeSize(SUB_PX, m);
    const label = textWidth(item.label, {
      face: 'heading',
      size: labelPx,
      tracking: DISPLAY_TRACKING.heading,
    });
    const sub = textWidth(item.sub, { face: 'body', size: subPx, tracking: TRACKING.label });
    const need = Math.max(label, sub);
    const slack = room - need;
    if (slack < worst.slack) worst = { name: item.label, slack, need, room };
  }
  say(
    `   tightest label: ${worst.name} needs ${worst.need.toFixed(0)}px in ${worst.room.toFixed(0)}px` +
      ` → slack ${worst.slack.toFixed(0)}px ${worst.slack >= 0 ? 'FITS' : 'OVERFLOWS'}`,
  );
  say('');
}

writeFileSync(new URL('./plate-room.txt', import.meta.url), out.join('\n') + '\n');
