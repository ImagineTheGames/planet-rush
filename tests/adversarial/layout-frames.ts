/**
 * tests/adversarial/layout-frames.ts — **the census.** OWNER: QA Agent (a0-122).
 *
 * Every game state worth sweeping, at every viewport worth sweeping it at, as a
 * list of {@link Unlayered} things on the glass in the order they are painted.
 * `./layout-model` holds the rule; this holds what the rule is asked about.
 *
 * ── WHERE THE RECTS COME FROM ───────────────────────────────────────────────
 *
 * Out of the shipped geometry, never typed here. Every builder below calls the
 * same pure function the view calls — `entryLayout` for the doors, `pauseLayout`
 * / `settingsLayout` for the pause stack, `endOfMatchLayout` for the four
 * outcomes, `connectionStatusLayout` for the online overlays, `wheelFootprint` /
 * `promptBounds` / `waveClockLayout` / `oreCounterLayout` / `stationHpBounds` /
 * `collapsedRect` / `homeArrow` for the match HUD — and measures its type through
 * `src/ui/font-metrics.ts`, the repo's own per-glyph advances of the shipped
 * `public/fonts/*.woff2`. So a drawing change lands in this sweep by itself,
 * which is the property a0-103's `reachCatalogue` (`src/ui/minimap.test.ts`) was
 * built for and this borrows wholesale.
 *
 * The paint ORDER is `src/ui/hud.ts`'s own `addChild` list for the match states,
 * and each view's own draw sequence elsewhere. It is transcribed here because
 * **the layout registry cannot express it** — see below.
 *
 * ── AND WHAT THE CENSUS MUST NOT INVENT (a0-128) ────────────────────────────
 *
 * A cross-product composes; a game does not. This file used to take `wheelOpen`
 * and `alarm` as independent booleans, and two independent booleans are four
 * screens whether or not the game has four — it has three. The fourth,
 * `match-alarm-wheel` with the arrow home up, is 288 of the 1,896 frames the
 * sweep used to run and **none of them exist**: the wheel opens only inside
 * `STATION.dockRange` and the arrow is drawn only once home is off the inset
 * rect, which is further out on every viewport. a0-125 measured 3.3 px of overlap
 * on one of them and a0-127 went to photograph it and could not.
 *
 * So a match frame is staged from a {@link MatchSituation} — the WORLD, not the
 * screen — and `./layout-reachable` asks the shipped predicates what that world
 * puts on the glass. There is no exclusion list and no pair of ids is named
 * impossible anywhere: the wheel and the arrow read the same home offset, so the
 * frame is not excluded, it is unspellable. Every {@link Variant} also carries
 * the {@link Stage} it was staged from, and `./layout-overlap.test.ts` fails on a
 * frame whose painted list disagrees with what that stage would draw.
 *
 * ── WHAT THE REGISTRY CANNOT SAY, STATED PLAINLY ────────────────────────────
 *
 * The brief asks for this if it is true, and it is true. A `LayoutEntry`
 * (`@platform/layout-registry`) is `{id, anchor, bounds}`. Three facts the rule
 * needs are not in it, and each one is a defect this repo shipped:
 *
 *  1. **Draw order.** Nothing in the registry says which of two entries is on
 *     top. Without it a scrim under a readout and a button over a plate are the
 *     same finding, which is why "no two registered rects may intersect" is
 *     useless and why six briefs each hand-argued their own pair instead.
 *  2. **"Must be read or pressed."** Every entry is equal. The registry cannot
 *     distinguish the DONE plate from the beam behind it, so it cannot know that
 *     covering one is a defect and covering the other is Tuesday.
 *  3. **"This may sit inside that."** a0-115 established that some elements
 *     legitimately sit inside others (the wheel's hub, a row's `?` square). The
 *     registry has no way to declare it, so `src/ui/layout-exclusions.ts` had to
 *     invent a side table — in a UI-owned file, explicitly written to lift into
 *     the registry verbatim on the day its owner wants it — and `src/ui/
 *     anchor-reach.ts` had to invent a second one for reservations.
 *
 * This file is therefore the third such side table, in `tests/`, for the same
 * reason and with the same shape. `Painted.role`, `Painted.surface` and the paint
 * order are the three missing fields; they lift into `LayoutEntry` unchanged.
 *
 * ── AND WHAT THE REGISTRY CANNOT SEE AT ALL ─────────────────────────────────
 *
 * The DOM. `src/net/playtest-log-button.ts` (a0-97) and
 * `src/net/connect-trace-view.ts` (a0-114) are `position:fixed` elements over the
 * canvas at the platform's maximum z-index, and neither registers anything. A
 * sweep of registry entries alone scores both of those defects clean — which is
 * what "rect intersection alone missed the DOWNLOAD LOG button once already"
 * means. They are modelled here from their own CSS and are marked `surface:
 * 'dom'`, which `./layout-model` `layer` paints above every canvas element.
 *
 * ── MODELLING LIMITS, DECLARED ──────────────────────────────────────────────
 *
 * Three, all in {@link MIRRORED} or beside their use, and all listed in
 * `tests/reports/a0-122-overlaps.md`. A model that quietly guesses is what a0-98
 * was; these are the places this one does, said out loud.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import { FireMode } from '@platform/actions';
import type { ControlScheme } from '@platform/actions';
import { writeAffordanceRects } from '@platform/touch-visuals';
import type { TouchAffordanceRects } from '@platform/touch-visuals';
import { BADGE_STRIP_LIFT, writeBadgeRect } from '@render/build-badge';
import { FS_AFFORDANCE_ID, writeAffordanceRect } from '@render/fullscreen-affordance';
import { PING_BADGE_STACK_LIFT, writePingRect } from '../../src/net/ping-badge';
import { CONNECT_TRACE_TOP_PX } from '../../src/net/connect-trace-view';
import { TRACKING } from '../../src/art/materials';
import { textHeight, textWidth } from '../../src/ui/font-metrics';
import type { TypeSpec } from '../../src/ui/font-metrics';
import { hudMetrics, hudType } from '../../src/ui/instrument';
import { contentBox } from '../../src/ui/viewport';
import { showControlsStrip } from '../../src/ui/controls-strip';
import { liveOnGlassControls } from '../../src/ui/live-controls';
import { ZOOM_CONTROL_ID, zoomControlBounds } from '../../src/ui/zoom-control';
import { MINIMAP_MARGIN, collapsedRect } from '../../src/ui/minimap';
import {
  ALARM_FRAME_STROKE,
  ARROW_SIZE,
  HUD_EYEBROW_TYPE,
  HUD_PAD,
  ORE_BANK_TYPE,
  PROMPT_TYPE,
  arrowClearOfReadouts,
  arrowPoly,
  oreCounterLayout,
  polyBounds,
  promptBounds,
  promptLineBox,
  promptWithdraws,
  promptWrapWidth,
  glassCornerReserve,
  stationHpBounds,
  waveClockLayout,
  wheelFootprint,
} from '../../src/ui/hud-geometry';
import {
  ARROW_KEEPOUT_IDS,
  HUD_READOUT_IDS,
  labelRepeatsOwner,
  labelYieldsToReadouts,
} from '../../src/ui/layout-exclusions';
import type { PlacedLabel } from '../../src/ui/layout-exclusions';
import {
  NAMEPLATE_FONT_SIZE,
  NAMEPLATE_KIND_ORDER,
  nameplateClusterClearance,
  nameplateRowLayout,
} from '../../src/ui/nameplates-view';
import { pauseButtons, pauseLayout } from '../../src/ui/pause-menu';
import type { PauseButton, PauseScreen } from '../../src/ui/pause-menu';
import { pauseAllowsDownloadLog } from '../../src/ui/pause-menu';
import { settingsLayout } from '../../src/ui/settings';
import { endButtons, endOfMatchLayout } from '../../src/ui/end-of-match';
import type { EndKind } from '../../src/ui/end-of-match';
import { connectionStatusLayout } from '../../src/ui/connection-status';
import { DOOR_ORDER, KEYPAD_KEYS } from '../../src/ui/lobby-entry';
import { entryLayout } from '../../src/ui/lobby-geometry';
import { layer } from './layout-model';
import type { Frame, Unlayered } from './layout-model';
import { arrowHome, homeAway, situation, wheelIsOpen } from './layout-reachable';
import type { MatchSituation, Stage, StagedFrame } from './layout-reachable';

// ---------------------------------------------------------------------------
// The three mirrored constants
// ---------------------------------------------------------------------------

/**
 * Numbers this model needs that their own module keeps private, mirrored here
 * with the line they are mirrored from.
 *
 * The same compromise `src/ui/minimap.test.ts` `STAMP_TEXT` makes and for the
 * same reason: the alternative is not measuring the element at all, and an
 * element left out of a sweep reads as an element that passed. Each is a SIZE,
 * never a position, so a drift makes the modelled rect the wrong size — it does
 * not move it to a different corner — and every one of them is small enough that
 * the error is a pixel or two rather than a screen. Listed in the report under
 * "modelling limits" so the next person does not have to find them.
 */
const MIRRORED = {
  /** `src/ui/hud.ts:194` — the controls strip's row height. */
  STRIP_ROW: 18,
  /** `src/ui/hud.ts:195` — its padding. */
  STRIP_PAD: 12,
  /** `src/ui/hud.ts:216-220` — the wave clock's three type sizes. */
  WAVE_NAME_TYPE: 15,
  WAVE_NEXT_TYPE: 14,
  WAVE_MATCH_TYPE: 13,
} as const;

/**
 * How tall the refusal panel (`src/net/connect-trace-view.ts`) measures, in the
 * entry screen's own logical px.
 *
 * A DOM box, so a headless model cannot measure it — `src/main.ts`
 * `refusalHeightLogical` reads `getBoundingClientRect` for exactly that reason.
 * This is the number a0-114's capture read off both real profiles: the panel's
 * band was `y 92 … 161.4` on the phone and on the desktop, one hint line plus a
 * `.45rem` gap plus a 44px button row. Transcribed rather than derived, and
 * that is a modelling limit rather than a measurement.
 */
const REFUSAL_HEIGHT = 69.4;

// ---------------------------------------------------------------------------
// The viewports
// ---------------------------------------------------------------------------

export interface Profile {
  readonly id: string;
  readonly label: string;
  readonly vp: Viewport;
  readonly isTouch: boolean;
}

/**
 * The four the brief names, and why each is in.
 *
 * `798×384` and `1280×800` are the two the brief sets as the minimum, and they
 * are not arbitrary: they are the pair a0-98, a0-111, a0-114 and a0-118 all
 * captured on, so a finding here can be put beside those numbers. The two
 * ultrawides are the developer's own report (a0-74, *"all that UI goes to the
 * edges of the screens"*) — `3440×1440` is the display `evidence/a0-75-fill-rate`
 * profiles as theirs, and `3840×1080` is the 32:9 shape where the HUD chrome is
 * bound to a content box far narrower than the glass (a0-74's fix, a0-103's
 * `CONTENT_BOUND_IDS`), which is the case a naive sweep gets wrong in both
 * directions.
 */
export const VIEWPORTS: readonly Profile[] = [
  { id: 'phone-798x384', label: 'phone landscape (a0-111 profile)', vp: { width: 798, height: 384 }, isTouch: true },
  { id: 'desktop-1280x800', label: 'desktop', vp: { width: 1280, height: 800 }, isTouch: false },
  { id: 'ultrawide-3440x1440', label: "21:9 — the developer's display", vp: { width: 3440, height: 1440 }, isTouch: false },
  { id: 'ultrawide-3840x1080', label: '32:9 super-ultrawide', vp: { width: 3840, height: 1080 }, isTouch: false },
];

// ---------------------------------------------------------------------------
// Type measurement
// ---------------------------------------------------------------------------

const measure = (text: string, spec: TypeSpec): { width: number; height: number } => ({
  width: textWidth(text, spec),
  height: textHeight(text, spec),
});

/** Nominal metrics for the two dev stamps, whose real size comes from a canvas.
 *  Only the HEIGHT reaches their placement (both hang off the bottom-left), the
 *  same compromise `src/ui/minimap.test.ts` makes. */
const STAMP_TEXT = { width: 160, height: 12 };

// ---------------------------------------------------------------------------
// The match HUD
// ---------------------------------------------------------------------------

/**
 * A shipped rule switched OFF, to prove the sweep is not vacuous.
 *
 * Every one of the six defects was fixed by a rule in `src/ui`, and a sweep that
 * comes back clean proves nothing unless it would go red with that rule removed.
 * These are the four rules that live inside a builder below; a0-97's and a0-114's
 * are the other two, and they are bypassed at their own call sites
 * ({@link refusalAtConstant}, {@link pauseState}'s `offerLog`).
 *
 * Never reachable from {@link STATES} — these build the negative controls in
 * `./layout-overlap.test.ts` and nothing else.
 */
export type Bypass =
  /** a0-100 — place the prompt as if no wheel were open, which is what it did. */
  | 'a0-100'
  /** a0-115 — do not let a world label step out of a readout. */
  | 'a0-115'
  /** a0-116 — do not pull the arrow in off a readout. */
  | 'a0-116'
  /** a0-119 — do not drop an owner's second label. */
  | 'a0-119';

/**
 * What the HUD is doing this frame — **derived, since a0-128.**
 *
 * This used to be a record of independent booleans: `wheelOpen`, `alarm`, a
 * bearing. Two independent booleans are four screens whether or not the game has
 * four, and one of the four did not exist — the wheel open with the arrow home
 * up, which `./layout-reachable` shows cannot happen on any viewport. So the
 * census now states the WORLD ({@link MatchSituation}) and asks the shipped
 * predicates what is on the glass.
 */
interface HudDraws {
  /** `canOpenWheel` on the sim's own `isDocked` — `./layout-reachable`. */
  readonly wheelOpen: boolean;
}

/** What the shipped conditions say this situation puts on the glass. */
function hudDraws(sit: MatchSituation): HudDraws {
  return { wheelOpen: wheelIsOpen(sit) };
}

/**
 * The match HUD, in `src/ui/hud.ts`'s own paint order.
 *
 * The order is that file's `addChild` list, transcribed with its own comments'
 * reasoning intact: markers and bars and names float over the WORLD and under
 * every piece of corner chrome; the minimap sits above the readouts; the alarm,
 * then the wheel, then the prompt on top of everything — *"the SPEND prompt
 * fires while the wheel is open (GDD §2.10), so it has to sit on top of it"*,
 * which is precisely why a0-100 was a defect and not a curiosity.
 */
function matchHud(p: Profile, sit: MatchSituation, bypass?: Bypass): Unlayered[] {
  const { vp, isTouch } = p;
  const { wheelOpen } = hudDraws(sit);
  const box = contentBox(vp);
  const out: Unlayered[] = [];
  const scheme: ControlScheme = 'tap';
  const mode = FireMode.AutoAim;

  // --- the world floats, first and lowest -----------------------------------

  // Over-ship health bar for the local ship, held at the screen centre by the
  // follow camera. World-role: HUD chrome passing over it is a0-102's ground
  // argument, not a defect.
  out.push({
    id: 'healthbars',
    role: 'world',
    surface: 'canvas',
    bounds: { x: vp.width / 2 - 20, y: vp.height / 2 - 30, width: 40, height: 4 },
    note: 'the local ship’s hull bar',
  });

  // Nameplates: the station's plate first, then the ship's — `NAMEPLATE_KIND_ORDER`,
  // and the order is the a0-119 ruling (the station's plate is placed first and
  // keeps its pixels). Both belong to the SAME owner, which is the frame the
  // developer photographed on 2026-08-19.
  if (sit.plateAt) out.push(...nameplates(p, sit.plateAt, readoutsFor(p, wheelOpen), bypass));

  // --- corner chrome ---------------------------------------------------------

  const ore = oreCluster(p);
  out.push(
    {
      id: 'ore-hud',
      role: 'read',
      surface: 'canvas',
      bounds: ore.cluster,
      note: 'the banked-ore counter (GDD §2.2, top-left)',
    },
    {
      id: 'banked-total',
      role: 'read',
      surface: 'canvas',
      bounds: ore.numeral,
      note: 'the banked numeral inside it',
    },
  );

  const clock = waveClock(p, wheelOpen);
  out.push({
    id: 'wave-clock',
    role: 'read',
    surface: 'canvas',
    bounds: clock,
    note: 'the asteroid-wave clock (GDD §2.2, top-centre)',
  });

  // Every fixed rect on the glass comes from ONE place (`fixedChrome`), because
  // the two keep-out tables pick from it and a builder that computed its own copy
  // would let the frame and the keep-out disagree about where an element is —
  // which is the whole class a0-122 exists to find. `./hud` `keepOutCandidates`
  // is the same arrangement in the shipped view.
  const chrome = fixedChrome(p, wheelOpen);
  out.push({
    id: 'station-hp',
    role: 'read',
    surface: 'canvas',
    bounds: chrome['station-hp'] as Rect,
    note: 'own-station HP (GDD §2.2, top-right)',
  });

  const zoom = chrome[ZOOM_CONTROL_ID];
  if (zoom) {
    out.push({
      id: ZOOM_CONTROL_ID,
      role: 'press',
      surface: 'canvas',
      bounds: zoom,
      note: 'the VIEW zoom chip (a0-74, touch only)',
    });
  }

  const strip = chrome['controls-strip'];
  if (strip) {
    out.push({
      id: 'controls-strip',
      role: 'read',
      surface: 'canvas',
      bounds: strip,
      note: 'the key-binding strip along the bottom (GDD §2.2)',
    });
  }

  const map = collapsedRect(
    { width: box.width, height: box.height },
    isTouch,
    {},
    liveOnGlassControls(isTouch, scheme, mode).fireButton,
  );
  out.push({
    id: 'minimap',
    role: 'press',
    surface: 'canvas',
    bounds: { ...map, x: box.x + map.x },
    note: `the collapsed minimap (bottom-right, margin ${MINIMAP_MARGIN})`,
  });

  // --- the alarm -------------------------------------------------------------

  if (sit.alarmFiring) {
    // The frame is a STROKE, not a fill: four bars around the glass. Modelled as
    // what it inks rather than as a filled rect, because a filled rect would
    // "cover" the whole HUD and need a blanket exception — and a blanket
    // exception is how a rule stops finding anything.
    const t = ALARM_FRAME_STROKE;
    for (const [name, r] of [
      ['top', { x: 0, y: 0, width: vp.width, height: t }],
      ['bottom', { x: 0, y: vp.height - t, width: vp.width, height: t }],
      ['left', { x: 0, y: 0, width: t, height: vp.height }],
      ['right', { x: vp.width - t, y: 0, width: t, height: vp.height }],
    ] as const) {
      out.push({
        id: `alarm-frame-${name}`,
        role: 'ground',
        surface: 'canvas',
        bounds: r as Rect,
        note: 'the under-attack frame’s stroke',
      });
    }
    const arrow = alarmArrow(p, sit, bypass === 'a0-116' ? [] : arrowKeepOutFor(p, wheelOpen));
    if (arrow) {
      out.push({
        id: 'alarm-arrow',
        role: 'read',
        surface: 'canvas',
        bounds: arrow,
        note: 'the screen-edge arrow home (GDD §2.2)',
      });
    }
  }

  // --- the wheel, and the prompt on top of it --------------------------------

  if (wheelOpen) {
    out.push({
      id: 'build-wheel',
      role: 'press',
      surface: 'canvas',
      bounds: wheelFootprint(vp.width, vp.height),
      note: 'the Build & Upgrade wheel (GDD §2.5), halo included',
    });
  }

  if (sit.prompt !== null) {
    const wrapAt = promptWrapWidth(vp.width, vp.height, isTouch);
    const text = wrapped(sit.prompt, p, wrapAt);
    // The a0-100 bypass is exactly what the prompt did before a0-100: it placed
    // itself without knowing a wheel was open, and never withdrew.
    const knowsWheel = bypass === 'a0-100' ? false : wheelOpen;
    if (bypass === 'a0-100' || !promptWithdraws(vp.width, vp.height, isTouch, {}, wheelOpen, text.h)) {
      out.push({
        id: 'onboarding',
        role: 'read',
        surface: 'canvas',
        bounds: promptBounds(vp.width, vp.height, text.w, text.h, isTouch, {}, knowsWheel),
        note: 'an onboarding prompt (GDD §2.10)',
      });
    }
  }

  // --- platform chrome, over the HUD ----------------------------------------

  out.push({
    id: 'build-badge',
    role: 'read',
    surface: 'canvas',
    bounds: chrome['build-badge'] as Rect,
    note: 'the build stamp (every evidence frame is read off it)',
  });
  out.push({
    id: 'net-ping',
    role: 'read',
    surface: 'canvas',
    bounds: chrome['net-ping'] as Rect,
    note: 'the ping stamp',
  });
  // The re-enter-fullscreen button (`@render/fullscreen-affordance`), drawn only
  // after a real exit from fullscreen and — `FullscreenLifecycle.affordanceVisible`
  // — only on TOUCH: *"desktop is untouched; keyboard/mouse never auto-fullscreens"*.
  // So this is a phone element, and painting it on a desktop frame would be the
  // sweep inventing a defect rather than finding one.
  const fsRect = chrome[FS_AFFORDANCE_ID];
  if (fsRect) {
    out.push({
      id: FS_AFFORDANCE_ID,
      role: 'press',
      surface: 'canvas',
      bounds: fsRect,
      note: 'the re-enter-fullscreen affordance (drawn after a real exit, touch only)',
    });
  }

  const touch: TouchAffordanceRects = { leftStickZone: null, aimZone: null, fireButton: null };
  writeAffordanceRects(isTouch, mode, vp.width, vp.height, touch, scheme !== 'tap');
  for (const [id, rect, note] of [
    ['touch-left-stick', touch.leftStickZone, 'the thrust stick'],
    ['touch-aim-stick', touch.aimZone, 'the aim stick'],
    ['touch-fire-button', touch.fireButton, 'the FIRE button'],
  ] as const) {
    if (rect) {
      out.push({ id, role: 'press', surface: 'canvas', bounds: { ...rect }, note });
    }
  }

  return out;
}

/** The ore cluster's ground rect (what `describeLayout` registers as `ore-hud`)
 *  and its numeral, both measured through the shipped font data. */
function oreCluster(p: Profile): { cluster: Rect; numeral: Rect } {
  const box = contentBox(p.vp);
  const m = hudMetrics(box.width, box.height);
  const ore = oreCounterLayout(
    measure('ORE', { face: 'heading', size: hudType(HUD_EYEBROW_TYPE, m), tracking: TRACKING.eyebrow }),
    measure('1204', { face: 'bodyBold', size: hudType(ORE_BANK_TYPE, m), tracking: TRACKING.name }),
    m,
  );
  return {
    cluster: { x: box.x + HUD_PAD, y: HUD_PAD, width: ore.ground.width, height: ore.ground.height },
    numeral: {
      x: box.x + HUD_PAD + ore.numeral.x,
      y: HUD_PAD + ore.numeral.y,
      width: ore.numeral.width,
      height: ore.numeral.height,
    },
  };
}

/** The wave clock's drawn scrim, in screen space — `Hud.debugWaveClock()`'s own
 *  arithmetic (content-box layout, shifted by the box's x). */
function waveClock(p: Profile, wheelOpen: boolean): Rect {
  const box = contentBox(p.vp);
  const m = hudMetrics(box.width, box.height);
  const lines = [
    measure('WAVE 1/5 · Outer Drift', {
      face: 'heading',
      size: hudType(MIRRORED.WAVE_NAME_TYPE, m),
      tracking: TRACKING.name,
    }),
    measure('NEXT 2:28', {
      face: 'bodyBold',
      size: hudType(MIRRORED.WAVE_NEXT_TYPE, m),
      tracking: TRACKING.name,
    }),
    measure('MATCH 0:02', {
      face: 'body',
      size: hudType(MIRRORED.WAVE_MATCH_TYPE, m),
      tracking: TRACKING.name,
    }),
  ];
  const layout = waveClockLayout(box.width, box.height, lines, wheelOpen);
  return { ...layout.bounds, x: layout.bounds.x + box.x };
}

/**
 * Every FIXED rect on the glass this frame, by registry id — the candidate list
 * both keep-out tables pick from (`src/ui/hud.ts` `keepOutCandidates`, the same
 * arrangement in the shipped view).
 *
 * `null` means the element is not drawn on this profile, and an element that is
 * not drawn is not in anybody's way: the strip is desktop-only
 * (`showControlsStrip`), the VIEW chip and the re-enter-fullscreen button are
 * touch-only.
 *
 * The top-right column's `x` carries `glassCornerReserve` — a0-125's D1. The
 * affordance is drawn on exactly the frames this record gives it a rect on, so
 * "the button is up" and "the column stands off its corner" are one condition
 * here as they are in `./hud`.
 */
function fixedChrome(p: Profile, wheelOpen: boolean): Record<string, Rect | null> {
  const { vp, isTouch } = p;
  const box = contentBox(vp);
  const ore = oreCluster(p);
  const reserve = glassCornerReserve(vp.width, box.x + box.width, isTouch);
  const hp = stationHpBounds(box.width);
  const zoom = zoomControlBounds(box.width, box.height, isTouch);
  const lift = showControlsStrip(isTouch) ? BADGE_STRIP_LIFT : 0;
  const blank = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });
  return {
    'ore-hud': ore.cluster,
    'banked-total': ore.numeral,
    'wave-clock': waveClock(p, wheelOpen),
    'station-hp': { ...hp, x: box.x + hp.x - reserve },
    [ZOOM_CONTROL_ID]: zoom ? { ...zoom, x: box.x + zoom.x - reserve } : null,
    'controls-strip': showControlsStrip(isTouch)
      ? {
          x: box.x,
          y: vp.height - MIRRORED.STRIP_ROW - MIRRORED.STRIP_PAD,
          width: box.width,
          height: MIRRORED.STRIP_ROW + MIRRORED.STRIP_PAD,
        }
      : null,
    'build-badge': writeBadgeRect(STAMP_TEXT.width, STAMP_TEXT.height, vp.width, vp.height, blank(), lift),
    'net-ping': writePingRect(
      STAMP_TEXT.width,
      STAMP_TEXT.height,
      vp.width,
      vp.height,
      blank(),
      lift + PING_BADGE_STACK_LIFT,
    ),
    [FS_AFFORDANCE_ID]: isTouch ? writeAffordanceRect(vp.width, vp.height, blank()) : null,
  };
}

/** The rects named by `ids`, in that order, skipping the ones this profile does
 *  not draw — `src/ui/layout-exclusions.ts` `readoutRects`, in the model. */
function pickChrome(chrome: Record<string, Rect | null>, ids: readonly string[]): Rect[] {
  const out: Rect[] = [];
  for (const id of ids) {
    const r = chrome[id];
    if (r) out.push(r);
  }
  return out;
}

/** The readout rects a WORLD LABEL must clear this frame — a0-115's own list
 *  (`HUD_READOUT_IDS`), built from the same geometry the frame paints. */
function readoutsFor(p: Profile, wheelOpen: boolean): Rect[] {
  return pickChrome(fixedChrome(p, wheelOpen), HUD_READOUT_IDS);
}

/**
 * What the ARROW HOME must clear this frame — `ARROW_KEEPOUT_IDS`, a0-125's list
 * and a longer one: three of a0-122's five findings were this mark covered by an
 * element the world-label list does not name (both dev stamps and the desktop
 * strip), and a fourth arrived the moment D1's fix moved the HOME cluster out of
 * the corner that had been shielding it from the fullscreen button.
 */
function arrowKeepOutFor(p: Profile, wheelOpen: boolean): Rect[] {
  return pickChrome(fixedChrome(p, wheelOpen), ARROW_KEEPOUT_IDS);
}

/**
 * The alarm arrow's drawn triangle, after a0-116's yield.
 *
 * The whole path the view takes: `homeArrow` clamps the bearing to the edge
 * inset, `arrowClearOfReadouts` pulls it in along its own ray until the triangle
 * clears every readout, and `arrowPoly`/`polyBounds` are the triangle it draws.
 * Nothing here re-implements the rule — if a0-116 were reverted this function
 * returns the rect that lands on the clock, which is what makes the sweep able to
 * fail.
 */
function alarmArrow(p: Profile, sit: MatchSituation, readouts: readonly Rect[]): Rect | null {
  const { vp } = p;
  // `./layout-reachable` `arrowHome` is `Hud.drawHomeArrow`'s own first two
  // lines: the alarm is up, and home is not already on screen. It returns `null`
  // for a situation the game draws no arrow in, which is what makes the wheel
  // and the arrow unable to appear together — both read the one home offset.
  const arrow = arrowHome(sit, vp);
  if (!arrow) return null;
  const centre = { x: vp.width / 2, y: vp.height / 2 };
  const cleared = arrowClearOfReadouts(arrow, centre, readouts);
  return polyBounds(arrowPoly(cleared, ARROW_SIZE));
}

/**
 * The two nameplates of ONE owner at a camera stop — a station's and a ship's —
 * placed through the view's own decision path.
 *
 * `NameplateView.update`, step for step: measure the row, cull it off-canvas,
 * `labelYieldsToReadouts` (a0-115: step aside, or stand down), then
 * `labelRepeatsOwner` against the plates already placed (a0-119: the second plate
 * for an owner stands down). A plate that stands down is not painted at all,
 * because an element that is not drawn is not in the frame.
 */
function nameplates(
  p: Profile,
  at: { x: number; y: number },
  readouts: readonly Rect[],
  bypass?: Bypass,
): Unlayered[] {
  const box = contentBox(p.vp);
  const spec: TypeSpec = {
    face: 'body',
    size: hudType(NAMEPLATE_FONT_SIZE, hudMetrics(box.width, box.height)),
    tracking: TRACKING.label,
  };
  const name = measure('Rusty', spec);
  const suffix = measure('(EASY)', spec);
  const placed: PlacedLabel[] = [];
  const out: Unlayered[] = [];

  // Station first, ship second — `NAMEPLATE_KIND_ORDER`, which is a0-119's ruling
  // about which of the two keeps its pixels.
  //
  // The two are placed so their ROWS COINCIDE, because that is the frame the
  // developer photographed on 2026-08-19: a ship docked at its own station, one
  // owner, `Rusty (EASY)` printed on `Rusty (EASY)`. A census that put them a
  // comfortable distance apart would never engage a0-119's rule at all, and a
  // cell that cannot fail is not coverage — so the row baseline is pinned to the
  // station's and the ship's own `y` is solved back out of its own clearance.
  const stationClear = nameplateClusterClearance({ kind: 'station', radius: 48 } as never);
  const shipClear = nameplateClusterClearance({ kind: 'ship', radius: 14, local: false } as never);
  for (const kind of NAMEPLATE_KIND_ORDER) {
    const plate = {
      kind,
      owner: 1,
      x: at.x,
      y: kind === 'station' ? at.y : at.y - stationClear + shipClear,
      radius: kind === 'station' ? 48 : 14,
      local: false,
    };
    const bottom = plate.y - nameplateClusterClearance(plate as never);
    const height = name.height;
    const top = bottom - height;
    const row = nameplateRowLayout(plate.x, { side: 0, name: name.width, suffix: suffix.width });
    if (row.left < 0 || top < 0 || row.right > p.vp.width || top + height > p.vp.height) continue;
    const yielded =
      bypass === 'a0-115'
        ? { dx: 0, withheld: false }
        : labelYieldsToReadouts(
            { left: row.left, right: row.right, top, bottom },
            plate.x,
            plate.radius,
            readouts,
            p.vp.width,
          );
    if (yielded.withheld) continue;
    const drawn: Rect = { x: row.left + yielded.dx, y: top, width: row.width, height };
    if (bypass !== 'a0-119' && labelRepeatsOwner(plate.owner, drawn, placed)) continue;
    placed.push({ owner: plate.owner, rect: drawn });
    out.push({
      id: `nameplate-${kind}`,
      role: 'read',
      surface: 'canvas',
      bounds: drawn,
      note: `the ${kind} nameplate “Rusty (EASY)”, owner 1`,
    });
  }
  return out;
}

/** Greedily wrap a sentence the way Pixi's word wrap does, and report the box it
 *  lays out in — `hud-geometry.test.ts`'s own `wrapped`, so the model and the
 *  shipped `promptWithdraws` predicate cannot disagree about a line's height. */
function wrapped(text: string, p: Profile, width: number): { w: number; h: number } {
  const m = hudMetrics(contentBox(p.vp).width, contentBox(p.vp).height);
  const spec: TypeSpec = { face: 'heading', size: hudType(PROMPT_TYPE, m), tracking: TRACKING.label };
  let lines = 1;
  let widest = 0;
  let line = '';
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && textWidth(next, spec) > width) {
      widest = Math.max(widest, textWidth(line, spec));
      lines++;
      line = word;
    } else {
      line = next;
    }
  }
  widest = Math.max(widest, textWidth(line, spec));
  return { w: Math.min(widest, width), h: lines * promptLineBox(p.vp.width, p.vp.height) };
}

// ---------------------------------------------------------------------------
// The DOM surfaces
// ---------------------------------------------------------------------------

/**
 * The corner DOWNLOAD LOG button (`src/net/playtest-log-button.ts`), from its own
 * stylesheet: `right:max(12px,safe)`, `bottom:max(12px,safe)`,
 * `padding:.55rem 1.1rem`, `min-height:44px`, `min-width:44px`,
 * `font-size:clamp(12px,3vw,14px)` in the heading face at `.1em`.
 *
 * This is the element a0-97 found on top of the settings screen's DONE plate, and
 * it is in the layout registry nowhere — it is DOM, at the platform's maximum
 * z-index, inside the fullscreen element on touch, so it is on top of whatever
 * the canvas drew there on every viewport.
 *
 * Conservative by construction: the box is the button's own minimum, so where
 * this model is wrong it is wrong by being too SMALL, and a too-small box can
 * only miss a cover, never invent one.
 */
function downloadLogButton(p: Profile, hint: string | null): Unlayered[] {
  const gap = 12;
  const size = Math.min(14, Math.max(12, p.vp.width * 0.03));
  const label = 'DOWNLOAD LOG';
  const w = Math.max(44, textWidth(label, { face: 'heading', size, tracking: 0.1 }) + 2 * 17.6 + 2);
  const h = Math.max(44, textHeight(label, { face: 'heading', size, tracking: 0.1 }) + 2 * 8.8 + 2);
  const out: Unlayered[] = [];
  const button: Rect = { x: p.vp.width - gap - w, y: p.vp.height - gap - h, width: w, height: h };
  if (hint) {
    // `.pr-log-hint` sits above the button with a `.4rem` gap, right-aligned in
    // the same `max-width:min(22rem,80vw)` column.
    const hintSize = Math.min(13, Math.max(11, p.vp.width * 0.028));
    const hintSpec: TypeSpec = { face: 'body', size: hintSize, tracking: 0 };
    const maxW = Math.min(22 * 16, p.vp.width * 0.8);
    const hw = Math.min(maxW, textWidth(hint, hintSpec) + 2 * 8.8);
    const hh = textHeight(hint, hintSpec) * 1.4 + 2 * 5.6;
    out.push({
      id: 'playtest-download-log-hint',
      role: 'read',
      surface: 'dom',
      bounds: { x: p.vp.width - gap - hw, y: button.y - 6.4 - hh, width: hw, height: hh },
      note: 'the corner offer’s hint line (DOM over canvas)',
    });
  }
  out.push({
    id: 'playtest-download-log-button',
    role: 'press',
    surface: 'dom',
    bounds: button,
    note: 'the corner DOWNLOAD LOG button (DOM over canvas, maximum z-index)',
  });
  return out;
}

/**
 * The refusal panel (`src/net/connect-trace-view.ts`) — RETRY and DOWNLOAD LOG
 * under the failure line, the surface a0-114 got off the doors.
 *
 * `strip` is where `src/main.ts` stands it: the band `entryLayout` reserved for
 * it. Passing the strip in rather than computing a top here is the point of the
 * fix — a constant top is exactly what a0-114 was, and {@link refusalAtConstant}
 * below is that constant, kept as the sweep's own negative control.
 */
function refusalPanel(strip: Rect, p: Profile): Unlayered[] {
  // Centred, `width:min(30rem,92vw)`, one hint line over a row of two buttons.
  const w = Math.min(30 * 16, p.vp.width * 0.92);
  const x = p.vp.width / 2 - w / 2;
  const hintH = REFUSAL_HEIGHT - 44 - 7.2;
  return [
    {
      id: 'pr-connect-trace-hint',
      role: 'read',
      surface: 'dom',
      bounds: { x, y: strip.y, width: w, height: hintH },
      note: 'the refusal’s hint line (DOM over canvas)',
    },
    {
      id: 'pr-connect-trace-retry',
      role: 'press',
      surface: 'dom',
      bounds: { x: p.vp.width / 2 - 100 - 4.8, y: strip.y + hintH + 7.2, width: 100, height: 44 },
      note: 'RETRY (DOM over canvas)',
    },
    {
      id: 'pr-connect-trace-download',
      role: 'press',
      surface: 'dom',
      bounds: { x: p.vp.width / 2 + 4.8, y: strip.y + hintH + 7.2, width: 140, height: 44 },
      note: 'DOWNLOAD LOG (DOM over canvas)',
    },
  ];
}

/** Where the panel stood BEFORE a0-114: a constant `CONNECT_TRACE_TOP_PX` from
 *  the top of the page, whatever the screen under it was doing. The sweep's
 *  negative control (`./layout-overlap.test.ts`), never a shipped state. */
export function refusalAtConstant(p: Profile): Unlayered[] {
  return refusalPanel(
    { x: 0, y: CONNECT_TRACE_TOP_PX, width: p.vp.width, height: REFUSAL_HEIGHT },
    p,
  );
}

// ---------------------------------------------------------------------------
// The states
// ---------------------------------------------------------------------------

/** One frame's worth of elements, the name of the cell it is, and — since
 *  a0-128 — how the game gets there. */
export interface Variant {
  /** Appended to the state id when present — a camera stop, a bearing. */
  readonly id?: string;
  /** The world this frame was staged from (`./layout-reachable`). Every variant
   *  carries one: a frame staged without saying how a player reaches it is the
   *  seed of the next D5, and `./layout-overlap.test.ts` fails on a frame whose
   *  painted list disagrees with what its stage would draw. */
  readonly stage: Stage;
  readonly painted: readonly Unlayered[];
}

export interface StateSpec {
  readonly id: string;
  /** What this screen is, for the report. */
  readonly title: string;
  /** Which of the six defects lived here — the reason the state is in scope. */
  readonly from: string;
  /** How the game reaches this screen, in words — the sentence a0-127 could not
   *  write for `match-alarm-wheel`'s arrow and had to file a `failed` verdict
   *  instead. */
  readonly reached: string;
  build(p: Profile): Variant[];
}

/** The camera stops the nameplate cells are swept at: a row across the top band
 *  where the readouts live (a0-111 sampled 28 and found 4 bad), plus a mid-screen
 *  row where nothing is in the way. */
function plateStops(p: Profile): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const cols = 14;
  for (let i = 0; i < cols; i++) {
    const x = ((i + 0.5) / cols) * p.vp.width;
    out.push({ x, y: 120 });
    out.push({ x, y: p.vp.height * 0.6 });
  }
  return out;
}

/** The bearings the alarm arrow is swept at. a0-116 measured at 0.1° and found
 *  75 of every 360 landing in the clock; 1° is 360 cells a state and finds the
 *  same class without spending an hour on it. */
const BEARINGS = Array.from({ length: 360 }, (_, i) => (i * Math.PI) / 180);

/** The pause stack, whose screens differ only by which buttons are up — and by
 *  whether the corner log offer stands, which is the whole of a0-97. */
function pauseState(screen: PauseScreen, p: Profile, offerLog?: boolean): Unlayered[] {
  const ids: readonly PauseButton[] = pauseButtons(screen);
  const out: Unlayered[] = [];
  if (screen === 'settings') {
    const l = settingsLayout(p.vp, { isTouch: p.isTouch });
    out.push(
      { id: 'settings-header', role: 'ground', surface: 'canvas', bounds: l.header, note: 'the header beam' },
      { id: 'settings-footer', role: 'ground', surface: 'canvas', bounds: l.footer, note: 'the footer beam' },
      { id: 'settings-title', role: 'read', surface: 'canvas', bounds: l.title, note: 'the word SETTINGS' },
    );
    l.rows.forEach((r, i) =>
      out.push({ id: 'settings-row', role: 'press', surface: 'canvas', bounds: r, note: `settings row ${i}` }),
    );
    l.help.forEach((r, i) =>
      out.push({ id: 'settings-help', role: 'press', surface: 'canvas', bounds: r, note: `row ${i}’s ? square` }),
    );
    out.push({
      id: 'settings-done',
      role: 'press',
      surface: 'canvas',
      bounds: l.back,
      note: 'the DONE plate — the only way out on a phone with no Escape key (a0-96)',
    });
  } else {
    const l = pauseLayout(p.vp, ids, { isTouch: p.isTouch });
    out.push(
      { id: 'pause-header', role: 'ground', surface: 'canvas', bounds: l.header, note: 'the header beam' },
      { id: 'pause-footer', role: 'ground', surface: 'canvas', bounds: l.footer, note: 'the footer beam' },
      { id: 'pause-title', role: 'read', surface: 'canvas', bounds: l.title, note: 'the screen’s name' },
    );
    l.buttons.forEach((r, i) =>
      out.push({
        id: `pause-${ids[i] ?? i}`,
        role: 'press',
        surface: 'canvas',
        bounds: r,
        note: `the ${String(ids[i]).toUpperCase()} plate`,
      }),
    );
  }
  // a0-97's rule, read from the shipped predicate rather than restated: the log
  // offer stands on the pause MENU and on nothing stacked over it. `offerLog`
  // overrides it for the negative control — before a0-97 the offer stood on any
  // open pause screen, which is how it came to be on top of DONE.
  if (offerLog ?? pauseAllowsDownloadLog(screen)) out.push(...downloadLogButton(p, null));
  return out;
}

/** The entry screen — the doors, and the doors with a refusal on them. */
function doorsState(p: Profile, refused: boolean): Unlayered[] {
  const l = entryLayout(p.vp, { isTouch: p.isTouch, refusalHeight: refused ? REFUSAL_HEIGHT : 0 });
  const out: Unlayered[] = [
    { id: 'entry-header', role: 'ground', surface: 'canvas', bounds: l.header, note: 'the header beam' },
    { id: 'entry-footer', role: 'ground', surface: 'canvas', bounds: l.footer, note: 'the footer beam' },
    { id: 'entry-title', role: 'read', surface: 'canvas', bounds: l.title, note: 'the wordmark' },
    { id: 'entry-eyebrow', role: 'read', surface: 'canvas', bounds: l.eyebrow, note: 'the authority tag' },
    {
      id: 'entry-message',
      role: 'read',
      surface: 'canvas',
      bounds: l.message,
      note: refused
        ? 'FAILED: no allocator configured — the words the player is asked to report (a0-114)'
        : 'the prompt line under the wordmark',
    },
  ];
  l.doors.forEach((r, i) =>
    out.push({
      id: `door-${DOOR_ORDER[i]}`,
      role: 'press',
      surface: 'canvas',
      bounds: r,
      note: `the ${String(DOOR_ORDER[i]).toUpperCase()} plate`,
    }),
  );
  out.push({ id: 'entry-back', role: 'press', surface: 'canvas', bounds: l.back, note: 'BACK' });
  if (refused) out.push(...refusalPanel(l.refusal, p));
  return out;
}

/** The JOIN keypad, refused — the second screen a0-114's capture cleared, and
 *  the one whose mode switch a0-98's centre probe missed. */
function keypadState(p: Profile, refused: boolean): Unlayered[] {
  const l = entryLayout(p.vp, { isTouch: p.isTouch, refusalHeight: refused ? REFUSAL_HEIGHT : 0 });
  const out: Unlayered[] = [
    { id: 'entry-header', role: 'ground', surface: 'canvas', bounds: l.header, note: 'the header beam' },
    { id: 'entry-footer', role: 'ground', surface: 'canvas', bounds: l.footer, note: 'the footer beam' },
    { id: 'entry-title', role: 'read', surface: 'canvas', bounds: l.title, note: 'the wordmark' },
    { id: 'entry-message', role: 'read', surface: 'canvas', bounds: l.message, note: 'the failure line' },
  ];
  l.segments.forEach((r, i) =>
    out.push({
      id: `mode-${i === 0 ? 'browse' : 'code'}`,
      role: 'press',
      surface: 'canvas',
      bounds: r,
      note: `the ${i === 0 ? 'BROWSE' : 'ENTER ROOM CODE'} segment (a0-114 §"the two JOIN refusals")`,
    }),
  );
  l.cells.forEach((r, i) =>
    out.push({ id: `code-cell-${i}`, role: 'read', surface: 'canvas', bounds: r, note: `code cell ${i}` }),
  );
  l.keys.forEach((r, i) =>
    out.push({
      id: 'keypad-key',
      role: 'press',
      surface: 'canvas',
      bounds: r,
      note: `the ${KEYPAD_KEYS[i]} key`,
    }),
  );
  out.push(
    { id: 'entry-back', role: 'press', surface: 'canvas', bounds: l.back, note: 'BACK' },
    { id: 'entry-erase', role: 'press', surface: 'canvas', bounds: l.erase, note: 'ERASE' },
    { id: 'entry-submit', role: 'press', surface: 'canvas', bounds: l.submit, note: 'JOIN' },
  );
  if (refused) out.push(...refusalPanel(l.refusal, p));
  return out;
}

/** The end-of-match screen, for one outcome. */
function endState(p: Profile, kind: EndKind): Unlayered[] {
  const outcome = OUTCOMES[kind];
  const ids = endButtons(outcome);
  const l = endOfMatchLayout(p.vp, ids, { isTouch: p.isTouch, summaryRows: 3 });
  const out: Unlayered[] = [
    { id: 'end-header', role: 'ground', surface: 'canvas', bounds: l.header, note: 'the header beam' },
    { id: 'end-footer', role: 'ground', surface: 'canvas', bounds: l.footer, note: 'the footer beam' },
    { id: 'end-title', role: 'read', surface: 'canvas', bounds: l.title, note: 'the authority tag' },
    { id: 'end-headline', role: 'read', surface: 'canvas', bounds: l.headline, note: `the word ${kind.toUpperCase()}` },
    { id: 'end-subhead', role: 'read', surface: 'canvas', bounds: l.subhead, note: 'the line under the rule' },
    { id: 'end-match-time', role: 'read', surface: 'canvas', bounds: l.matchTime, note: 'the match-time line' },
  ];
  if (l.summary) {
    out.push(
      { id: 'end-summary-track', role: 'ground', surface: 'canvas', bounds: l.summary.bar, note: 'the XP groove' },
      { id: 'end-summary-xp', role: 'read', surface: 'canvas', bounds: l.summary.xpTotal, note: 'the XP total' },
      { id: 'end-summary-level', role: 'read', surface: 'canvas', bounds: l.summary.levelLabel, note: 'the LEVEL readout' },
      { id: 'end-summary-progress', role: 'read', surface: 'canvas', bounds: l.summary.progress, note: 'the progress line' },
    );
    l.summary.rows.forEach((r, i) =>
      out.push({ id: 'end-summary-row', role: 'read', surface: 'canvas', bounds: r, note: `summary row ${i}` }),
    );
  }
  l.buttons.forEach((r, i) =>
    out.push({
      id: `end-${ids[i] ?? i}`,
      role: 'press',
      surface: 'canvas',
      bounds: r,
      note: `the ${String(ids[i]).toUpperCase()} plate`,
    }),
  );
  return out;
}

/** The four outcomes `endKind` names, as the models the layout is taken against. */
const OUTCOMES = {
  victory: { winner: 1, loser: 0, players: [1, 0], cause: 'destroyed' },
  defeat: { winner: 0, loser: 1, players: [1, 0], cause: 'destroyed' },
  draw: { winner: null, loser: null, players: [1, 0], cause: 'collapse' },
  eliminated: { winner: 0, loser: 1, players: [1, 0], cause: 'destroyed' },
} as unknown as Record<EndKind, Parameters<typeof endButtons>[0]>;

/** The online overlays — the card in the middle of the screen and its one
 *  button, over whatever the match behind it was drawing. */
function onlineState(p: Profile, withAction: boolean): Unlayered[] {
  const l = connectionStatusLayout(p.vp);
  const out: Unlayered[] = [
    { id: 'connection-panel', role: 'ground', surface: 'canvas', bounds: l.panel, note: 'the status card' },
    {
      id: 'connection-message',
      role: 'read',
      surface: 'canvas',
      bounds: { x: l.panel.x + 16, y: l.panel.y + 24, width: l.panel.width - 32, height: 60 },
      note: 'what went wrong',
    },
  ];
  if (withAction) {
    out.push({
      id: 'connection-action',
      role: 'press',
      surface: 'canvas',
      bounds: l.action,
      note: 'BACK TO MENU',
    });
  }
  // An error screen carries the corner offer (`downloadLogModel`'s auto-offer,
  // brief §3) — the second place a0-97's element stands on a live control.
  out.push(...downloadLogButton(p, withAction ? 'DOWNLOAD LOG to report this.' : null));
  return out;
}

/** The sentence GDD §2.10 has that is hardest to place — the one a0-100's
 *  companion test names as costing the most screens. */
const PROMPT = 'Hold the FIRE button on the asteroid — your shots chip the rock';

export const STATES: readonly StateSpec[] = [
  {
    id: 'match-hud',
    title: 'the match HUD at rest',
    from: 'a0-115 (a nameplate through the word ORE)',
    reached: 'parked at your own station with BUILD not held — the wheel stays shut on ' +
      '`canOpenWheel`’s `requested` term, which is the conjunction’s other half',
    build: (p) =>
      plateStops(p).map((at, i) => {
        const sit = situation({ plateAt: at });
        return { id: `stop${i}`, stage: { kind: 'match', sit }, painted: matchHud(p, sit) };
      }),
  },
  {
    id: 'match-prompt',
    title: 'the match HUD with an onboarding prompt up',
    from: 'a0-100 (the prompt drawn through the wheel)',
    reached: 'an onboarding sentence fires with no wheel open (GDD §2.10)',
    build: (p) => {
      const sit = situation({ prompt: PROMPT });
      return [{ stage: { kind: 'match', sit }, painted: matchHud(p, sit) }];
    },
  },
  {
    id: 'match-wheel',
    title: 'the build wheel open, with the SPEND prompt firing',
    from: 'a0-100 (318 px of prompt through the wheel)',
    reached: 'docked at your own station holding BUILD — the SPEND prompt fires while the ' +
      'wheel is open, which is why `src/ui/hud.ts` paints it last (GDD §2.10)',
    build: (p) => {
      const sit = situation({ buildRequested: true, prompt: PROMPT });
      return [{ stage: { kind: 'match', sit }, painted: matchHud(p, sit) }];
    },
  },
  {
    id: 'match-alarm',
    title: 'the match HUD under alarm, at every bearing',
    from: 'a0-116 (the alarm arrow across the wave clock)',
    reached: 'out in the field at `ARROW_STAGED_RANGE` while your own station takes sustained ' +
      'damage — GDD §2.2’s own sentence, and every one of the 360 bearings is a separation a ' +
      'shipped map can produce (`./layout-reachable` `arenaReach`)',
    build: (p) =>
      BEARINGS.map((bearing, i) => {
        const sit = situation({ alarmFiring: true, home: homeAway(bearing) });
        return { id: `bearing${i}`, stage: { kind: 'match', sit }, painted: matchHud(p, sit) };
      }),
  },
  {
    id: 'match-alarm-wheel',
    title: 'the alarm sounding with the wheel open',
    from: 'a0-116 + a0-100 — the clock re-flows to one row while the wheel is up (a0-24)',
    // a0-128. This state is reachable and stays: flying home to spend under
    // siege is the triangle decision GDD §2.2 is about, and the compact clock
    // (a0-24) only exists here. What is NOT reachable is the arrow on it — the
    // wheel opens inside `STATION.dockRange` (160 u) and the arrow is only drawn
    // once home is off the inset rect, which on the tightest of the four
    // viewports is 164 u away. So the 72 bearings this state used to sweep were
    // 72 copies of one frame, distinguished only by an element the game does not
    // draw here, and they are one frame now. Nothing is skipped: the arrow's
    // absence is derived, and `./layout-overlap.test.ts` proves it holds over the
    // WHOLE docked disc rather than at the 72 points a sweep could sample.
    reached: 'docked at your own station holding BUILD while the station is under sustained ' +
      'attack — the arrow is not drawn because the station you are standing on is on screen, ' +
      'and §2.2 hands the tell to the station at that point',
    build: (p) => {
      const sit = situation({ alarmFiring: true, buildRequested: true });
      return [{ stage: { kind: 'match', sit }, painted: matchHud(p, sit) }];
    },
  },
  {
    id: 'pause-menu',
    title: 'the pause menu',
    from: 'a0-97 (the corner offer stands here, and here only)',
    reached: 'PAUSE from a live match',
    build: (p) => [{ stage: { kind: 'pause', screen: 'menu' }, painted: pauseState('menu', p) }],
  },
  {
    id: 'pause-settings',
    title: 'the pause SETTINGS screen',
    from: 'a0-97 (DONE under the DOWNLOAD LOG button)',
    reached: 'SETTINGS from the pause menu',
    build: (p) => [{ stage: { kind: 'pause', screen: 'settings' }, painted: pauseState('settings', p) }],
  },
  {
    id: 'pause-confirm',
    title: 'the pause EXIT confirmation',
    from: 'a0-97 (the second screen stacked over pause)',
    reached: 'EXIT from the pause menu',
    build: (p) => [{ stage: { kind: 'pause', screen: 'confirm' }, painted: pauseState('confirm', p) }],
  },
  {
    id: 'doors',
    title: 'the doors screen, idle',
    from: 'a0-114 (the screen the refusal landed on)',
    reached: 'the entry screen with nothing refused',
    build: (p) => [{ stage: { kind: 'entry', screen: 'doors', refused: false }, painted: doorsState(p, false) }],
  },
  {
    id: 'doors-refused',
    title: 'a refused HOST — the doors with the refusal panel on them',
    from: 'a0-114 (DOWNLOAD LOG over the word HOST)',
    reached: 'HOST refused by the allocator — the panel stands in the band `entryLayout` reserved',
    build: (p) => [{ stage: { kind: 'entry', screen: 'doors', refused: true }, painted: doorsState(p, true) }],
  },
  {
    id: 'keypad-refused',
    title: 'a refused JOIN — the keypad with the refusal panel on it',
    from: 'a0-114 (the mode switch under RETRY, missed by a centre probe)',
    reached: 'JOIN refused with a room code entered',
    build: (p) => [{ stage: { kind: 'entry', screen: 'keypad', refused: true }, painted: keypadState(p, true) }],
  },
  {
    id: 'online-error',
    title: 'the online error overlay',
    from: 'a0-97 (an error screen carries the corner offer)',
    reached: 'a session that failed — the overlay offers BACK TO MENU',
    build: (p) => [{ stage: { kind: 'online', withAction: true }, painted: onlineState(p, true) }],
  },
  {
    id: 'online-reconnecting',
    title: 'the reconnecting overlay',
    from: 'a0-97 (an overlay that is merely waiting)',
    reached: 'a dropped link the client is still retrying — nothing to press yet',
    build: (p) => [{ stage: { kind: 'online', withAction: false }, painted: onlineState(p, false) }],
  },
  {
    id: 'end-victory',
    title: 'the end-of-match screen — VICTORY',
    from: 'the four outcomes the brief names',
    reached: 'the match ends with the local player the last core standing',
    build: (p) => [{ stage: { kind: 'end', outcome: 'victory' }, painted: endState(p, 'victory') }],
  },
  {
    id: 'end-defeat',
    title: 'the end-of-match screen — DEFEAT',
    from: 'the four outcomes the brief names',
    reached: 'the match ends with somebody else the last core standing',
    build: (p) => [{ stage: { kind: 'end', outcome: 'defeat' }, painted: endState(p, 'defeat') }],
  },
  {
    id: 'end-draw',
    title: 'the end-of-match screen — DRAW',
    from: 'a0-113 made DRAW reachable; it had never been swept',
    reached: 'the collapse takes the last two cores in the same tick (a0-113)',
    build: (p) => [{ stage: { kind: 'end', outcome: 'draw' }, painted: endState(p, 'draw') }],
  },
  {
    id: 'end-eliminated',
    title: 'the end-of-match screen — ELIMINATED',
    from: 'the four outcomes the brief names',
    reached: 'the local core dies while the match runs on',
    build: (p) => [{ stage: { kind: 'end', outcome: 'eliminated' }, painted: endState(p, 'eliminated') }],
  },
];

// ---------------------------------------------------------------------------
// The negative controls — "would this sweep have caught the six?"
// ---------------------------------------------------------------------------

/**
 * One of the six defects, rebuilt with the rule that fixed it switched off.
 *
 * A green sweep is worth exactly as much as its ability to go red, and six of
 * these screens were green in CI on the day they were photographed. So each of
 * the six is re-staged here through the SAME builders, with only the shipped rule
 * bypassed, and `./layout-overlap.test.ts` asserts each one still reproduces —
 * naming the pair the sweep is supposed to find. If a builder ever stops painting
 * an element, or the rule stops being the thing that saves it, these go quiet and
 * the test fails on the silence.
 */
export interface Control {
  readonly brief: string;
  readonly what: string;
  /** The rule switched off to reproduce it. */
  readonly bypassed: string;
  /**
   * The `coverer OVER victim` pairs the sweep must report, and the viewports each
   * reproduces on. A list rather than one pair because a defect does not have to
   * look the same on two screen shapes — a0-114 is the proof: on the phone the
   * panel lands on the HOST plate and on the desktop it lands on the failure LINE,
   * and both are in its own capture.
   */
  readonly expect: readonly {
    readonly over: string;
    readonly under: string;
    readonly on: readonly string[];
  }[];
  frame(p: Profile): readonly Unlayered[];
}

/** A camera stop that puts a world label squarely in the ore counter — the
 *  top-left corner, which is where a0-111 photographed it. */
function overTheOreCounter(p: Profile): { x: number; y: number } {
  const ore = oreCluster(p);
  // The label's row sits `nameplateClusterClearance` above its entity, so the
  // entity goes that far BELOW the counter's middle to put the row on the word.
  const clear = nameplateClusterClearance({ kind: 'station', radius: 48 } as never);
  return { x: ore.cluster.x + ore.cluster.width / 2, y: ore.cluster.y + ore.cluster.height / 2 + clear };
}

/** Every viewport id — the default for a control that reproduces on all four. */
const ALL_VIEWPORTS: readonly string[] = VIEWPORTS.map((v) => v.id);

export const CONTROLS: readonly Control[] = [
  {
    brief: 'a0-97',
    what: 'the pause SETTINGS screen’s DONE plate, under the corner DOWNLOAD LOG button',
    bypassed: 'pauseAllowsDownloadLog — the offer withdraws on anything stacked over pause',
    expect: [{ over: 'playtest-download-log-button', under: 'settings-done', on: ALL_VIEWPORTS }],
    frame: (p) => pauseState('settings', p, true),
  },
  {
    brief: 'a0-100',
    what: 'the objective prompt drawn through the build wheel',
    bypassed: 'promptBand / promptWithdraws — the prompt yields to an open wheel',
    // The phone is where a0-99 photographed it and where the band runs out: the
    // wheel is 318.5px of a 384px screen, so there is no clear band left under it.
    expect: [{ over: 'onboarding', under: 'build-wheel', on: ['phone-798x384'] }],
    frame: (p) => matchHud(p, situation({ buildRequested: true, prompt: PROMPT }), 'a0-100'),
  },
  {
    brief: 'a0-114',
    what: 'a refused HOST drawing RETRY and DOWNLOAD LOG onto the doors',
    bypassed: 'refusalStrip — the panel stands in the band the screen reserved for it',
    // Both halves of a0-114's own capture. `create` IS the HOST door
    // (`lobby-entry` DOOR_ORDER / DOOR_OPTIONS), and the desktop half is the one
    // the fix's table records as *"the failure line … behind the button offering
    // to report it"*.
    expect: [
      { over: 'pr-connect-trace-download', under: 'door-create', on: ['phone-798x384'] },
      { over: 'pr-connect-trace-retry', under: 'door-campaign', on: ['phone-798x384'] },
      {
        over: 'pr-connect-trace-download',
        under: 'entry-message',
        on: ['desktop-1280x800', 'ultrawide-3440x1440', 'ultrawide-3840x1080'],
      },
    ],
    frame: (p) => [...doorsState(p, false), ...refusalAtConstant(p)],
  },
  {
    brief: 'a0-115',
    what: 'a rival nameplate drawn through the word ORE',
    bypassed: 'labelYieldsToReadouts — a world label steps out of a fixed readout',
    expect: [{ over: 'ore-hud', under: 'nameplate-station', on: ALL_VIEWPORTS }],
    frame: (p) => matchHud(p, situation({ plateAt: overTheOreCounter(p) }), 'a0-115'),
  },
  {
    brief: 'a0-116',
    what: 'the alarm arrow across the wave clock',
    bypassed: 'arrowClearOfReadouts — the arrow gives up radius to clear a readout',
    expect: [{ over: 'alarm-arrow', under: 'wave-clock', on: ALL_VIEWPORTS }],
    frame: (p) =>
      matchHud(p, situation({ alarmFiring: true, home: homeAway(-Math.PI / 2) }), 'a0-116'),
  },
  {
    brief: 'a0-119',
    what: 'two nameplates for the same owner, on each other',
    bypassed: 'labelRepeatsOwner — an owner’s second label stands down',
    expect: [{ over: 'nameplate-ship', under: 'nameplate-station', on: ALL_VIEWPORTS }],
    frame: (p) =>
      matchHud(p, situation({ plateAt: { x: p.vp.width / 2, y: p.vp.height * 0.6 } }), 'a0-119'),
  },
];

// ---------------------------------------------------------------------------
// The cross-product
// ---------------------------------------------------------------------------

/**
 * Every state × every viewport × every variant, as layered {@link Frame}s.
 *
 * One pass answers every element at once, because every element is on every
 * frame of it — the same property that makes `./latch-bounds.test.ts`'s sweep
 * affordable, one class up.
 */
export function sweepFrames(
  states: readonly StateSpec[] = STATES,
  viewports: readonly Profile[] = VIEWPORTS,
): StagedFrame[] {
  const out: StagedFrame[] = [];
  for (const state of states) {
    for (const p of viewports) {
      for (const variant of state.build(p)) {
        out.push({
          state: variant.id === undefined ? state.id : `${state.id}/${variant.id}`,
          viewport: p.id,
          stage: variant.stage,
          painted: layer(variant.painted),
        });
      }
    }
  }
  return out;
}

/** The state id a frame belongs to, with any variant suffix stripped — what a
 *  report groups by, and what {@link LAYOUT_ALLOWANCES} matches on. */
export function baseState(state: string): string {
  const cut = state.indexOf('/');
  return cut < 0 ? state : state.slice(0, cut);
}
