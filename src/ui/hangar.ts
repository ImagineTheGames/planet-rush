/**
 * src/ui/hangar.ts — the HANGAR, the fourth door on the main menu. OWNER: UI
 * Engineer (brief a0-14; the developer, 2026-08-07: *"we need to add a hangar to
 * the main menu (thats where the shop will be, with the things you can
 * unlock)"*).
 *
 * Where a player looks at what they have and what they are working toward. Per
 * the ratified progression direction (`docs/progression-plan.md` §3, §4):
 * **cosmetics, unlocked by level, as a list rather than a tree.**
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * **It is not a store.** There is no currency, no price and no purchase anywhere
 * in this file, and no brief in this chain has the authority to add one. The
 * developer's word for it was "shop"; what the ratified progression actually
 * pays out is cosmetics earned by levelling, so the screen shows what a level
 * grants and lets a player wear it.
 *
 * **Unlocking and equipping are different verbs.** Level 7 *unlocks* a livery;
 * the player then *equips* it. The first is derived from the level and needs no
 * storage; the second is a stored fact ({@link Profile.equipped}) and must
 * survive a restart. {@link equipCosmetic} is the only thing in the front-of-
 * match that writes it.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTRAINT THAT WILL BITE: SILHOUETTES ARE INFORMATION
 * ---------------------------------------------------------------------------
 * GDD §2.11 assigns hulls by name and `style-guide.md` §4 states the reason
 * plainly — *"a silhouette on the minimap is information"*, and *"recognising a
 * shape at 24 pixels tells you who you are dealing with before you can read a
 * name"*. `a0-06` leans on the same rule for the lobby.
 *
 * So a cosmetic that changes a ship's **silhouette** breaks a ratified
 * information rule, and the boundary is written into this contract *before* any
 * content exists rather than discovered by the first person who adds some:
 *
 *  - {@link COSMETIC_VARIABLE} — colour, livery, decals, trim, engine glow. Free.
 *  - {@link COSMETIC_INVARIANT} — outline, proportions, class-identifying
 *    geometry. Never.
 *
 * {@link CosmeticSlot} enumerates exactly the first list, and a {@link Cosmetic}
 * carries **no geometry field at all** — so the type system, not a reviewer, is
 * what stops a hat from changing a hull. If the developer later wants a cosmetic
 * that crosses that line, it is a design decision with a measurable cost (every
 * shape-reading in the game — minimap, lobby, 24px CI raster — is re-opened by
 * it), not a content addition.
 *
 * ---------------------------------------------------------------------------
 * THE EMPTY STATE, WHICH IS WHAT ACTUALLY SHIPS FIRST
 * ---------------------------------------------------------------------------
 * {@link COSMETICS} is **empty**, deliberately: this brief ships the room, not
 * the furniture. An empty grid is indistinguishable from a broken one (LESSONS
 * §20), so the screen is built to be worth opening with nothing in it — your
 * ship at a size worth looking at, your level and your progress toward the next,
 * and, where the list would be, a line that *says* there is nothing yet
 * ({@link HANGAR_EMPTY_LINE}) rather than silence.
 *
 * Same three-piece discipline as the rest of the directory: a pure, DOM-free
 * model with its layout co-located, plus a thin Pixi view ({@link ./hangar-view})
 * that draws exactly what this returns and decides nothing.
 */

import type { Rect, Viewport } from '@platform/layout-registry';
import type { ShipClass } from '@shared/types';
import { COLUMN, plateHeight, rowHeight } from '../art/materials';
import type { FrameMetrics, PlateRole, PlateScale, PlateState } from '../art/materials';
import { beamContent, gantryFrame } from './gantry';
import { hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';
import { CLASS_OPTIONS } from './lobby';
import { levelProgress } from '../progression/curve';
import type { Profile } from '../progression/profile';

// ---------------------------------------------------------------------------
// The cosmetic contract — the boundary, stated before there is any content
// ---------------------------------------------------------------------------

/**
 * What a cosmetic may vary. Prose, deliberately: this list is the contract a
 * content author reads, and {@link COSMETIC_SLOTS} is its machine-checked form.
 */
export const COSMETIC_VARIABLE = ['colour', 'livery', 'decals', 'trim', 'engine glow'] as const;

/**
 * What no cosmetic may ever vary — the silhouette rule (style-guide §4, GDD
 * §2.11). Stated as data so `hangar.test.ts` can hold the slot list to it.
 */
export const COSMETIC_INVARIANT = ['outline', 'proportions', 'class-identifying geometry'] as const;

/**
 * The slots a cosmetic can occupy. One per surface in {@link COSMETIC_VARIABLE}
 * that a player equips *per ship* — the player's colour is not here, because
 * colour is the roster's (`src/art/ships.ts` `playerColor`, keyed by seat), not
 * a thing the hangar hands out.
 *
 * There is no `hull`, no `shape` and no `silhouette` slot, and adding one is the
 * design decision the header describes rather than a content change.
 */
export type CosmeticSlot = 'livery' | 'decal' | 'trim' | 'glow';

/** The slots, in the order the hangar lists them. */
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['livery', 'decal', 'trim', 'glow'];

/** Each slot's word on the screen, and the {@link COSMETIC_VARIABLE} entry it
 *  realises — so the contract above and the screen below cannot drift. */
export const COSMETIC_SLOT_SURFACE: Readonly<Record<CosmeticSlot, (typeof COSMETIC_VARIABLE)[number]>> = {
  livery: 'livery',
  decal: 'decals',
  trim: 'trim',
  glow: 'engine glow',
};

/**
 * One unlockable cosmetic.
 *
 * Note what is absent and must stay absent: no geometry, no hull override, no
 * stat, no price. A cosmetic is a *surface* on a shape the class already owns,
 * and it costs a level rather than a currency.
 */
export interface Cosmetic {
  /** Stable id — what {@link Profile.equipped} stores, so it outlives a rename. */
  readonly id: string;
  /** The player-facing name. */
  readonly name: string;
  /** Which surface it dresses. */
  readonly slot: CosmeticSlot;
  /** The level that grants it. Nothing else gates it — the ratified list has no
   *  prerequisites, no challenges and no purchases (plan §4). */
  readonly level: number;
}

/**
 * **The unlock list, and it is empty.**
 *
 * a0-13 ratified the *direction* (cosmetics, by level) and explicitly designs no
 * content: *"the list is empty until the developer fills it"* (plan §4). So this
 * ships as the empty list it honestly is, and the screen is built to be worth
 * opening anyway. The day it is filled, nothing in this file changes but this
 * array — which is the whole argument for a list over a tree.
 */
export const COSMETICS: readonly Cosmetic[] = [];

/** The screen's heading, and the eyebrow above it. */
export const HANGAR_TITLE = 'HANGAR';
export const HANGAR_EYEBROW = 'FLEET BAY · YOUR RECORD';
/** The way out. */
export const HANGAR_BACK_LABEL = 'BACK';

/**
 * The line drawn where the unlock list would be when there is nothing in it.
 *
 * This is the load-bearing string of the whole brief: with no cosmetics defined,
 * an empty panel and a broken panel look identical, and the first thing the
 * developer will do is open this screen. It says what is true.
 */
export const HANGAR_EMPTY_LINE = 'No cosmetics yet — they unlock as you level up.';

// ---------------------------------------------------------------------------
// Unlocking, and equipping, which are different verbs
// ---------------------------------------------------------------------------

/** What a player can do with one row. */
export type CosmeticStatus = 'locked' | 'unlocked' | 'equipped';

/** Whether a level has earned a cosmetic. Derived — the stored `unlocked[]` is a
 *  cache, so a corrupt profile can never lose a player their unlocks (plan §4). */
export function isUnlocked(cosmetic: Cosmetic, level: number): boolean {
  return level >= cosmetic.level;
}

/** The cosmetic equipped in `slot`, or null. Reads the profile and nothing else
 *  — one profile, one reader. */
export function equippedId(profile: Profile, slot: CosmeticSlot): string | null {
  return profile.equipped?.[slot] ?? null;
}

/** One row's status for a profile. */
export function cosmeticStatus(cosmetic: Cosmetic, profile: Profile): CosmeticStatus {
  if (!isUnlocked(cosmetic, profile.level)) return 'locked';
  return equippedId(profile, cosmetic.slot) === cosmetic.id ? 'equipped' : 'unlocked';
}

/**
 * Equip a cosmetic, returning the profile to persist — or **the identical
 * profile** when nothing moved, so the caller can tell a refusal from a change
 * by identity and neither redraw nor write on a no-op (the stillness rule every
 * model in this directory keeps).
 *
 * Refuses a cosmetic the level has not unlocked. That refusal is not defence
 * against cheating — the player owns their own `localStorage`, and plan §2.2
 * says so plainly; it is there so a stale tap on a row that was locked a moment
 * ago cannot write a lie into the one file the game promises never to wipe.
 *
 * Re-equipping the already-equipped cosmetic **unequips** it: a slot the player
 * can fill is a slot they must be able to empty, or the first hat they ever pick
 * is permanent.
 */
export function equipCosmetic(profile: Profile, cosmetic: Cosmetic): Profile {
  if (!isUnlocked(cosmetic, profile.level)) return profile;
  const current = equippedId(profile, cosmetic.slot);
  const equipped: Record<string, string> = { ...profile.equipped };
  if (current === cosmetic.id) delete equipped[cosmetic.slot];
  else equipped[cosmetic.slot] = cosmetic.id;
  return Object.keys(equipped).length > 0 ? { ...profile, equipped } : stripEquipped(profile);
}

/** The profile with no `equipped` key at all — `exactOptionalPropertyTypes`
 *  means an absent field is absent, not `undefined`, and a round trip through
 *  JSON must not gain an empty object. */
function stripEquipped(profile: Profile): Profile {
  const { equipped: _drop, ...rest } = profile;
  return rest;
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** What the wiring layer hands in. Everything is read, nothing is computed
 *  twice: the profile is the one the front door loaded, and the hull is the one
 *  the lobby persists. */
export interface HangarState {
  readonly profile: Profile;
  /** The hull to show in the bay — the player's last pick
   *  (`planet-rush:shipClass`), not a hangar-local choice. */
  readonly shipClass: ShipClass;
  /** The unlock list. Handed in like the codex's content, so a test can draw a
   *  populated hangar without inventing a shipped cosmetic. Defaults to
   *  {@link COSMETICS}, which is empty. */
  readonly cosmetics?: readonly Cosmetic[];
}

/** Which control the pointer is over / holding. */
export interface HangarPointer {
  readonly hover?: HangarTarget | null;
  readonly press?: HangarTarget | null;
}

/** The ship in the bay, as the view draws it. The *sprite* is the view's job
 *  (it comes from the real generators, `src/art/ships.ts`); the words are
 *  here, and they are the lobby's own ({@link ./lobby} `CLASS_OPTIONS`) so the
 *  hangar can never call a hull by a second name. */
export interface HangarShipView {
  readonly shipClass: ShipClass;
  readonly name: string;
  readonly hull: string;
  readonly blurb: string;
}

/** The level block — the same numbers the end-of-match summary shows, read from
 *  the same profile through the same curve, never recomputed here. */
export interface HangarLevelView {
  readonly level: number;
  /** `LEVEL 7`. */
  readonly levelLabel: string;
  /** `4 210 / 5 600 XP` — where the player is inside this level. */
  readonly xpLabel: string;
  /** `1 390 TO LEVEL 8`, or `''` at the cap. */
  readonly nextLabel: string;
  /** The bar's fill, `[0, 1)`. */
  readonly frac: number;
  /** Lifetime totals, for the two figures beside the bar. */
  readonly xp: number;
  readonly matches: number;
  readonly matchesLabel: string;
}

/** One row of the unlock list. */
export interface HangarRowView {
  readonly id: string;
  readonly name: string;
  readonly slotLabel: string;
  readonly status: CosmeticStatus;
  /** `LEVEL 7` while locked, `EQUIPPED` when worn, `EQUIP` when it can be. */
  readonly action: string;
  readonly state: PlateState;
  readonly role: PlateRole;
}

/** The hangar for one frame. */
export interface HangarModel {
  readonly title: string;
  readonly eyebrow: string;
  readonly ship: HangarShipView;
  readonly level: HangarLevelView;
  readonly rows: readonly HangarRowView[];
  /**
   * The honest empty state: the line to draw *instead of* the list, or `null`
   * when there are rows. Non-null is the shipping case today.
   */
  readonly empty: string | null;
  readonly backLabel: string;
  readonly backState: PlateState;
  readonly backRole: PlateRole;
}

/** Thin-space grouping, so a six-figure XP total reads at a glance. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 *
 * The level block is **read**, not computed: `levelProgress` is the same
 * function the end-of-match summary calls, over the same lifetime XP, so the two
 * screens cannot disagree about what level a player is. The hangar deliberately
 * does not trust `profile.level` for the bar — that field is a cache of this
 * derivation (`src/progression/profile.ts`), and where a cache and its source
 * disagree, the source wins.
 */
export function hangarModel(state: HangarState, pointer: HangarPointer = {}): HangarModel {
  const cosmetics = state.cosmetics ?? COSMETICS;
  const option = CLASS_OPTIONS.find((o) => o.shipClass === state.shipClass) ?? CLASS_OPTIONS[0]!;
  const progress = levelProgress(state.profile.xp);
  const stateOf = (target: HangarTarget): PlateState =>
    sameHangarTarget(pointer.press, target) ? 'press' : sameHangarTarget(pointer.hover, target) ? 'hover' : 'rest';

  const rows = cosmetics.map((cosmetic, index): HangarRowView => {
    const status = cosmeticStatus(cosmetic, { ...state.profile, level: progress.level });
    return {
      id: cosmetic.id,
      name: cosmetic.name,
      slotLabel: COSMETIC_SLOT_SURFACE[cosmetic.slot].toUpperCase(),
      status,
      action: status === 'locked' ? `LEVEL ${cosmetic.level}` : status === 'equipped' ? 'EQUIPPED' : 'EQUIP',
      // A locked row is `inert` — the handoff's role for a thing that is not an
      // action yet. It is NOT gray-as-disabled: gray means disabled is a theme
      // rule this screen keeps by never using hue for state at all.
      role: status === 'locked' ? 'inert' : 'secondary',
      state: stateOf({ kind: 'cosmetic', index }),
    };
  });

  return {
    title: HANGAR_TITLE,
    eyebrow: HANGAR_EYEBROW,
    ship: {
      shipClass: state.shipClass,
      name: option.name,
      hull: option.hull,
      blurb: option.blurb,
    },
    level: {
      level: progress.level,
      levelLabel: `LEVEL ${progress.level}`,
      xpLabel: `${grouped(progress.into)} / ${grouped(progress.into + progress.toNext)} XP`,
      nextLabel: `${grouped(progress.toNext)} TO LEVEL ${progress.level + 1}`,
      frac: progress.frac,
      xp: state.profile.xp,
      matches: state.profile.matches,
      matchesLabel: `${grouped(state.profile.matches)} ${state.profile.matches === 1 ? 'MATCH' : 'MATCHES'}`,
    },
    rows,
    empty: rows.length === 0 ? HANGAR_EMPTY_LINE : null,
    backLabel: HANGAR_BACK_LABEL,
    backState: stateOf({ kind: 'back' }),
    // BACK is this screen's one action, so it is its one bright plate — the
    // hangar has nothing else that could claim `primary` (the single-primary
    // rule, `./gantry` `singlePrimary`).
    backRole: 'primary',
  };
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** What a tap on the hangar resolves to. */
export type HangarTarget = { readonly kind: 'back' } | { readonly kind: 'cosmetic'; readonly index: number };

/** Whether two targets name the same control — structural, because the wiring
 *  layer hands back whatever the hit test returned and those are fresh objects
 *  every call. The same helper `./settings` `sameTarget` exists for. */
export function sameHangarTarget(a: HangarTarget | null | undefined, b: HangarTarget | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'cosmetic' && b.kind === 'cosmetic' ? a.index === b.index : true;
}

/** A stable string key for a target, for the wiring layer's hover/press
 *  bookkeeping (the same shape `entryTargetKey` / `codexTargetKey` take). */
export function hangarTargetKey(target: HangarTarget | null): string | null {
  if (!target) return null;
  return target.kind === 'back' ? 'back' : `cosmetic:${target.index}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface HangarLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
  /** How many rows the list holds — the layout must know, because the rows share
   *  the band with the bay. Defaults to {@link COSMETICS}'s length (zero). */
  readonly rowCount?: number;
}

/** The hangar's rects. */
export interface HangarLayout {
  readonly content: Rect;
  readonly header: Rect;
  readonly footer: Rect;
  /** The heading's strip inside the header beam. */
  readonly title: Rect;
  /** The ship bay — the left pane, where the hull is drawn. */
  readonly bay: Rect;
  /** The level block — top of the right pane. */
  readonly levelPanel: Rect;
  /** The XP bar inside {@link levelPanel}. */
  readonly xpBar: Rect;
  /** The unlock list's viewport — the rest of the right pane. Where
   *  {@link HANGAR_EMPTY_LINE} is drawn when there is nothing in it. */
  readonly list: Rect;
  /** One rect per row, clipped to {@link list}. */
  readonly rows: readonly Rect[];
  /** BACK, in the footer beam. */
  readonly back: Rect;
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/** BACK's width at the reference — the same 300px footer plate the settings
 *  screen uses, so the way out is in the same place on both screens. */
const BACK_WIDTH = 300;
/** The share of the band's width the ship bay claims. A landscape phone is wide
 *  and short: the bay wants to be square-ish, and the list wants the rest. */
const BAY_SHARE = 0.42;
/**
 * The level block's height.
 *
 * Two bounds, and the tighter wins. A pure *share* of the band is what the first
 * cut used, and on a desktop it opened a hand's width of dead panel between the
 * bar and the list — the block only ever holds a word, a bar and two figures,
 * however tall the band is. So the second bound is content-shaped
 * (`rowHeight × LEVEL_ROWS`), which is what actually binds on a tall screen;
 * the share still binds on a short one, where the content bound would eat the
 * list.
 */
const LEVEL_SHARE = 0.42;
/** The level block, measured in row heights: the level word, the bar, and the
 *  line of figures under it, with the gaps between them. */
const LEVEL_ROWS = 2.6;
/** The XP bar's height at the reference. */
const XP_BAR_HEIGHT = 14;
/** The gap between the bay and the right pane. */
const PANE_GAP = 16;

/**
 * Lay the screen out for a viewport.
 *
 * Two panes side by side in the band between the beams: the ship bay on the
 * left, the level block and the unlock list stacked on the right. That split is
 * what makes 390px landscape work rather than merely fit — the logical viewport
 * there is 844×390, which is **wide and short**, so anything stacked vertically
 * has to give up height it does not have. Side by side, the bay gets a square it
 * can draw a ship at a size worth looking at, and the list keeps full-height rows.
 *
 * On a viewport too narrow to hold both panes the bay gives way first: a level
 * readout you can read beats a ship you cannot.
 */
export function hangarLayout(viewport: Viewport, options: HangarLayoutOptions = {}): HangarLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const { metrics } = frame;
  const title = beamContent(frame.header, metrics);

  const footerStrip = beamContent(frame.footer, metrics, 'footer');
  const backHeight = Math.min(plateHeight('compact', metrics), footerStrip.height);
  const backWidth = Math.min(Math.round(BACK_WIDTH * metrics.plateScale), footerStrip.width);
  const back: Rect = {
    x: footerStrip.x + footerStrip.width - backWidth,
    y: footerStrip.y + (footerStrip.height - backHeight) / 2,
    width: Math.max(0, backWidth),
    height: Math.max(0, backHeight),
  };

  // The band, capped at the same column the other screens use so a 4K desktop
  // does not stretch the hangar across a metre of glass.
  const band = frame.band;
  const width = Math.min(COLUMN.title + COLUMN.settings * 0.5, band.width);
  const x = band.x + (band.width - width) / 2;
  const gap = Math.min(PANE_GAP, width / 8);
  const bayWidth = Math.max(0, Math.min(width * BAY_SHARE, Math.max(0, width - gap)));
  const paneWidth = Math.max(0, width - bayWidth - gap);

  const bay: Rect = { x, y: band.y, width: bayWidth, height: band.height };
  const paneX = x + bayWidth + gap;

  const levelHeight = Math.max(0, Math.min(band.height * LEVEL_SHARE, rowHeight(metrics) * LEVEL_ROWS));
  const levelPanel: Rect = { x: paneX, y: band.y, width: paneWidth, height: levelHeight };

  const barHeight = Math.max(0, Math.min(Math.round(XP_BAR_HEIGHT * metrics.plateScale), levelHeight / 3));
  const xpBar: Rect = {
    x: paneX,
    // Centred in the block, so the level word sits above it and the two figures
    // below — the arrangement the summary screen (pr-05) will read the same way.
    y: levelPanel.y + (levelHeight - barHeight) / 2,
    width: paneWidth,
    height: barHeight,
  };

  const listY = band.y + levelHeight + gap;
  const list: Rect = {
    x: paneX,
    y: listY,
    width: paneWidth,
    height: Math.max(0, band.y + band.height - listY),
  };

  const rowCount = Math.max(0, Math.floor(options.rowCount ?? COSMETICS.length));
  const rowH = rowHeight(metrics);
  const rowGap = metrics.rowGap;
  const rows: Rect[] = [];
  for (let i = 0; i < rowCount; i++) {
    const y = list.y + i * (rowH + rowGap);
    // A row that does not wholly fit the list viewport is not drawn, and so is
    // not hit-testable either — the same "invisible ⇒ untappable" rule the rest
    // of the directory keeps. (Scrolling arrives with the content that needs it.)
    if (y + rowH > list.y + list.height + 0.5) break;
    rows.push({ x: list.x, y, width: list.width, height: rowH });
  }

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    bay,
    levelPanel,
    xpBar,
    list,
    rows,
    back,
    isTouch,
    metrics,
  };
}

/**
 * The target a tap at `(x, y)` hits, or `null`.
 *
 * A locked row is still a target: the wiring layer sounds a refusal on it
 * ({@link equipCosmetic} returns the identical profile), because a control that
 * does nothing *silently* is the one a player concludes is broken.
 */
export function hangarHitTest(layout: HangarLayout, x: number, y: number): HangarTarget | null {
  if (hitRect(layout.back, x, y)) return { kind: 'back' };
  for (let i = 0; i < layout.rows.length; i++) {
    const rect = layout.rows[i];
    if (rect && hitRect(rect, x, y)) return { kind: 'cosmetic', index: i };
  }
  return null;
}

/** The plate role and scale the bay's frame is drawn at — an `inert` panel,
 *  because the bay is a display, not a control. */
export const HANGAR_BAY_PLATE: { role: PlateRole; scale: PlateScale } = { role: 'inert', scale: 'standard' };

/** The hangar's layout-registry id: it owns the screen. */
export const HANGAR_ID = 'hangar';
