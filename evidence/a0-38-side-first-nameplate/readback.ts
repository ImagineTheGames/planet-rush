/**
 * evidence/a0-38-side-first-nameplate/readback.ts — the nameplate as it READS and
 * as it MEASURES, before and after a0-38, off the shipped modules.
 *
 *   npx vite-node evidence/a0-38-side-first-nameplate/readback.ts \
 *     > evidence/a0-38-side-first-nameplate/readback.json
 *
 * The developer: *"friendly or enemy should be the first thing displayed on a name
 * so thats its easier to identify."* Nothing below is typed by hand. Every row is
 * `nameplateModel(...)` — the same call `Hud.updateNameplates` makes — laid out by
 * `nameplateRowLayout`, the same function the drawing layer positions its three
 * pooled Texts with, over widths measured on the repo's own woff2 files
 * (`src/ui/font-metrics`, a0-32's method) at the layer's own type size.
 *
 * Four sections:
 *
 *  1. **`plates`** — the four seats the brief names (an ally, an enemy, the local
 *     player, and an FFA plate) as a player reads them, `before` beside `after`.
 *  2. **`width`** — what a row costs in pixels on the 390px landscape phone: the
 *     widest plate the game can produce, and the REACH from the ship to each end
 *     of the row, which is what the layer's cull tests. Before beside after.
 *  3. **`cull`** — the same fact stated as the thing a player sees: how close to
 *     the screen edge a ship can be before its plate disappears.
 *  4. **`crowding`** — two identically-shaped plates walked towards each other
 *     until their rows touch, before and after, because that is where a longer
 *     leading tag was expected to bite.
 *
 * No Pixi and no `window`: the model, the row layout and the metrics are all pure,
 * which is why this reads back in node.
 */

import { nameplateModel, NAMEPLATE_MAX_CHARS } from '../../src/ui/nameplates';
import type { DifficultyTable, Nameable, NameTable, TeamTable } from '../../src/ui/nameplates';
import {
  NAMEPLATE_FONT_SIZE,
  NAMEPLATE_SUFFIX_GAP,
  NAMEPLATE_TEAM_GAP,
  nameplateRowLayout,
} from '../../src/ui/nameplates-view';
import { textWidth } from '../../src/ui/font-metrics';
import { HUD_TRACKING } from '../../src/ui/instrument';

/** The plate's own type, as `NameplateView` styles it. */
const TYPE = { face: 'body', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name } as const;
const w = (text: string): number => (text.length > 0 ? textWidth(text, TYPE) : 0);
const px = (n: number): number => Math.round(n * 10) / 10;

/** The landscape phone the brief measures at. */
const PHONE = { width: 844, height: 390 } as const;

/**
 * The row as the shipped build drew it BEFORE a0-38: the name centred on the
 * ship, the side tag hung off its right edge, the difficulty tag past that.
 * Kept here — and only here — so every "what moved" number below is a difference
 * between two arrangements rather than an assertion about one.
 */
function beforeRow(centerX: number, side: number, name: number, suffix: number) {
  const nameX = centerX - name / 2;
  const sideX = nameX + name + NAMEPLATE_TEAM_GAP;
  const sideSpan = side > 0 ? NAMEPLATE_TEAM_GAP + side : 0;
  const suffixX = nameX + name + sideSpan + NAMEPLATE_SUFFIX_GAP;
  const right = suffix > 0 ? suffixX + suffix : nameX + name + sideSpan;
  return { sideX, nameX, suffixX, left: nameX, right, width: right - nameX };
}

/** The tokens of a plate, in the order they are DRAWN, rebuilt from their x. */
function read(row: { sideX: number; nameX: number; suffixX: number }, p: {
  teamLabel: string;
  text: string;
  suffix: string;
}): string {
  const tokens = [{ x: row.nameX, t: p.text }];
  if (p.teamLabel) tokens.push({ x: row.sideX, t: p.teamLabel });
  if (p.suffix) tokens.push({ x: row.suffixX, t: p.suffix });
  return tokens.sort((a, b) => a.x - b.x).map((t) => t.t).join(' ');
}

// ---------------------------------------------------------------------------
// 1. The four seats, as they read
// ---------------------------------------------------------------------------

/** A 2v2 as `main.ts` builds it under `?sides=2`: slot i on side i % 2. The names
 *  are the local player's default and three of the seven cast characters. */
const NAMES: NameTable = ['YOU', 'Rusty', 'Bolt', 'Sable'];
const DIFFS: DifficultyTable = [undefined, 'easy', 'medium', 'hard'];
const TEAMS: TeamTable = [0, 1, 0, 1];
const VIEWER = { showTeamLabels: true, viewerTeam: 0 } as const;

function ship(owner: number): Nameable {
  return { owner, kind: 'ship', alive: true, pos: { x: PHONE.width / 2, y: 200 }, radius: 12 };
}

const SEATS = [
  { seat: 'ally (a team-mate’s ship)', owner: 2, opts: VIEWER, teams: TEAMS },
  { seat: 'enemy (a rival’s ship)', owner: 1, opts: VIEWER, teams: TEAMS },
  { seat: 'the local player (their own home)', owner: 0, opts: VIEWER, teams: TEAMS },
  { seat: 'free-for-all (no side exists)', owner: 1, opts: {}, teams: [] as TeamTable },
] as const;

const plates = SEATS.map(({ seat, owner, opts, teams }) => {
  const [p] = nameplateModel([ship(owner)], NAMES, opts, DIFFS, teams);
  const side = w(p!.teamLabel);
  const name = w(p!.text);
  const suffix = w(p!.suffix);
  const after = nameplateRowLayout(PHONE.width / 2, { side, name, suffix });
  const before = beforeRow(PHONE.width / 2, side, name, suffix);
  return {
    seat,
    before: read(before, p!),
    after: read(after, p!),
    tokens: { side: p!.teamLabel, name: p!.text, suffix: p!.suffix },
    drawnWidth: { side: px(side), name: px(name), suffix: px(suffix), row: px(after.width) },
    rowUnchangedInWidth: px(before.width) === px(after.width),
  };
});

// ---------------------------------------------------------------------------
// 2 & 3. What a row costs, and how close to an edge it survives
// ---------------------------------------------------------------------------

/** The widest each slot can be: the longer side word, a name at the model's own
 *  12-character clamp in the widest Latin glyph the UI draws, the longest tier. */
const WIDEST = { side: 'FRIENDLY A', name: 'W'.repeat(NAMEPLATE_MAX_CHARS), suffix: '(MEDIUM)' };
const widest = { side: w(WIDEST.side), name: w(WIDEST.name), suffix: w(WIDEST.suffix) };

/** The typical teams plate the developer's own capture carries. */
const TYPICAL = { side: 'ENEMY B', name: 'Rusty', suffix: '(EASY)' };
const typical = { side: w(TYPICAL.side), name: w(TYPICAL.name), suffix: w(TYPICAL.suffix) };

function reach(t: { side: number; name: number; suffix: number }) {
  const a = nameplateRowLayout(0, t);
  const b = beforeRow(0, t.side, t.name, t.suffix);
  return {
    before: { left: px(-b.left), right: px(b.right), worst: px(Math.max(-b.left, b.right)) },
    after: { left: px(-a.left), right: px(a.right), worst: px(Math.max(-a.left, a.right)) },
    rowWidth: { before: px(b.width), after: px(a.width) },
  };
}

const width = {
  note: 'reach = px from the SHIP to each end of its row; the layer culls a plate whose row leaves the canvas, so the WORST reach is what decides how close to an edge a plate survives',
  viewport: PHONE,
  widest: { strings: WIDEST, ...reach(widest) },
  typical: { strings: TYPICAL, ...reach(typical) },
};

/** The band of ship positions that KEEP a plate, on the 844-wide landscape phone.
 *  Its size is `viewport − rowWidth` and nothing else, so a0-38 cannot change it:
 *  the band SHIFTS (the row hangs left of the ship now instead of right), it does
 *  not shrink or grow. Stated as both numbers so neither claim can be read into
 *  the other. */
function band(t: { side: number; name: number; suffix: number }) {
  const r = reach(t);
  const before = { from: r.before.left, to: px(PHONE.width - r.before.right) };
  const after = { from: r.after.left, to: px(PHONE.width - r.after.right) };
  return {
    before: `${before.from} … ${before.to}`,
    after: `${after.from} … ${after.to}`,
    bandWidth: { before: px(before.to - before.from), after: px(after.to - after.from) },
    shiftedRightBy: px(after.from - before.from),
    worstReachDroppedBy: px(r.before.worst - r.after.worst),
  };
}

const cull = {
  note: 'the horizontal band, in px of the 844-wide landscape phone, in which a ship keeps its plate. Same WIDTH before and after (it is viewport − row width, and the row did not change width); it shifts right, because the row now hangs left of the ship instead of right. So a plate survives further towards the right edge than it used to and less far towards the left — and it is markedly less lopsided about the hull it names (worstReachDroppedBy).',
  widest: band(widest),
  typical: band(typical),
};

// ---------------------------------------------------------------------------
// 4. Crowding — two plates walked towards each other
// ---------------------------------------------------------------------------

/** The gap (or overlap, negative) between two identically-shaped rows whose ships
 *  are `sep` px apart on the same line. */
function pairGap(sep: number, t: { side: number; name: number; suffix: number }, when: 'before' | 'after') {
  const lay = (x: number) =>
    when === 'after' ? nameplateRowLayout(x, t) : beforeRow(x, t.side, t.name, t.suffix);
  const a = lay(0);
  const b = lay(sep);
  return px(b.left - a.right);
}

function touchesAt(t: { side: number; name: number; suffix: number }, when: 'before' | 'after'): number {
  for (let sep = 0; sep <= 400; sep += 0.5) if (pairGap(sep, t, when) >= 0) return px(sep);
  return Infinity;
}

const crowding = {
  note: 'two ships side by side on the same line, each carrying the same plate. The row is a RIGID body whose width a0-38 did not change — only where the ship sits inside it — so two like plates touch at the same separation they always did.',
  typical: {
    touchesAt: { before: touchesAt(typical, 'before'), after: touchesAt(typical, 'after') },
    sweep: [40, 80, 120, 160, 200].map((sep) => ({
      shipsApart: sep,
      gapBefore: pairGap(sep, typical, 'before'),
      gapAfter: pairGap(sep, typical, 'after'),
    })),
  },
  widest: {
    touchesAt: { before: touchesAt(widest, 'before'), after: touchesAt(widest, 'after') },
  },
};

process.stdout.write(
  `${JSON.stringify(
    {
      brief: 'a0-38 — FRIENDLY / ENEMY reads first on a nameplate',
      ruling:
        '"friendly or enemy should be the first thing displayed on a name so thats its easier to identify"',
      type: { face: 'Oxanium (body)', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name },
      gaps: { beforeName: NAMEPLATE_TEAM_GAP, beforeSuffix: NAMEPLATE_SUFFIX_GAP },
      plates,
      width,
      cull,
      crowding,
    },
    null,
    2,
  )}\n`,
);
