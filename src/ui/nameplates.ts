/**
 * src/ui/nameplates.ts — player-name labels over ships and owned stations.
 * OWNER: UI Engineer (field request v0.2.1, GDD §2.9, style-guide §3).
 *
 * The developer, playing a live build: *"I want to see player names over their
 * stations and their ships."* So every **ship** and every **owned station** carries
 * a small name label — the local player's chosen lobby name over their own home
 * and (optionally) ship, and each bot's **personality name** (the seven cast
 * characters, GDD §2.9 — Rusty, Bolt, Foreman, Patch, Sable, Vulture, Warden)
 * over theirs. When online lands (m9) the room's slot names flow through the same
 * `names` table with no change here — the model is deliberately data-driven and
 * never reaches for a name itself.
 *
 * **This module is the pure, PixiJS-free decision half**, the same split the
 * health bars use ([[healthbar]] / healthbar-view): it decides *who gets a label,
 * what text, and which colour* from sim/lobby state, and passes the already
 * screen-projected position straight through to the pooled view
 * ({@link ./nameplates-view}). Positions arrive in screen space so labels are a
 * fixed size and **zoom-independent** (field request rule 3), the same discipline
 * as the rest of the screen-space HUD.
 *
 * **The rules (field request v0.2.1), each unit-tested here:**
 *
 *  - **Who.** Every live **ship** and every **owned (live) station** gets a label.
 *    A dead/eliminated ship and a destroyed station (a wreck, GDD §2.7 — no longer
 *    *owned*) get none. Un-owned hostile wave units are never named.
 *  - **The local ship's own label is optional-off** ({@link NameplateOptions
 *    .showOwnShipLabel}). It defaults **off**: the follow camera pins the local
 *    ship to screen-centre with its own distinct health bar, so a name glued there
 *    reads as noise (field request rule 3 — "your call"). The local player's
 *    **station** is still labelled; only the centre-screen ship is suppressed.
 *  - **What text.** From the `names` table, indexed by slot ({@link resolveName}).
 *    A missing/blank name degrades to a `P{n}` slot tag — identity never vanishes,
 *    the same fallback discipline as the identity decal (style-guide §3 rule 3).
 *  - **Which colour.** The owner's identity colour (style-guide §3 rule 2 — HP
 *    bars and *labels* are trim, one of the few places player colour is allowed),
 *    read through the SAME roster resolver [[station-hp]] and [[healthbar]] use, so
 *    a ship's trim, its bar and its name can never disagree. Never signal yellow
 *    or threat red — those are RESERVED (style-guide §2).
 *  - **Fade under combat clutter.** A label over an entity that is damaged or
 *    fighting drops to {@link NAMEPLATE_FADE_ALPHA} so it never fights the health
 *    bar for the eye during a brawl (field request rule 3). It is *also* stacked
 *    ABOVE the bar cluster by the view, so it can never cover a health bar.
 *
 * Integration (feeding this each frame, projected to screen) is the wiring in
 * `main.ts` / {@link ./hud}; the view is the thin Pixi half in
 * {@link ./nameplates-view}.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { playerColor } from './station-hp';

// ---------------------------------------------------------------------------
// Text policy
// ---------------------------------------------------------------------------

/** Longest label the model hands the view, in characters — a name is a quick
 *  read at arm's length, not a paragraph. The lobby also clamps on entry
 *  ({@link ./lobby} `setPlayerName`), so this is a second, defensive guard; an
 *  over-long name is truncated with an ellipsis rather than overrunning the ship. */
export const NAMEPLATE_MAX_CHARS = 12;

/** Full opacity of a resting label (calm entity). Slightly under 1 so the name
 *  reads as chrome floating over the world, not as a solid sprite. */
export const NAMEPLATE_FULL_ALPHA = 0.92;

/** Faded opacity while the entity is in combat or damaged — the label steps back
 *  so the health bar owns the eye during a fight (field request rule 3). */
export const NAMEPLATE_FADE_ALPHA = 0.4;

// ---------------------------------------------------------------------------
// Model I/O
// ---------------------------------------------------------------------------

/** What a name label can sit over. */
export type NameplateKind = 'ship' | 'station';

/**
 * One label-bearing entity as the model sees it, built by the caller from sim
 * state (a {@link Ship} or a home {@link MiningStation}). The decision reads only the
 * ownership / kind / liveness / combat fields; `pos`/`radius` are passed straight
 * through to the view.
 *
 * `pos`/`radius` are **screen space, CSS px** — the caller projects world → screen
 * (via the renderer's camera) before handing them over, so the label is a fixed
 * screen size and never scales with camera zoom. For the local ship the caller
 * passes the viewport centre, where the follow camera holds it.
 */
export interface Nameable {
  /** The entity's owner slot — selects the name and the identity colour. A
   *  non-slot value (`-1`, an un-owned hostile) is never named. */
  readonly owner: PlayerId;
  /** Ship or owned station — the view stacks the label differently for each. */
  readonly kind: NameplateKind;
  /** False for a dead/eliminated ship or a destroyed station (a wreck) — no label. */
  readonly alive: boolean;
  /** Entity centre in screen space (already projected by the caller), CSS px. */
  readonly pos: Vec2;
  /** Entity screen radius, CSS px — the view floats the label clear of the sprite
   *  (and, for a ship, clear of its health-bar cluster above it). */
  readonly radius: number;
  /** True **only** for the camera-followed local ship — suppressed by default
   *  ({@link NameplateOptions.showOwnShipLabel}). Never set on a station. */
  readonly local?: boolean;
  /** The entity is actively fighting this tick (a ship firing, a turreted station
   *  under attack) ⇒ the label fades. Default false. */
  readonly inCombat?: boolean;
  /** HP as a fraction 0..1 (default 1 = full). Below full ⇒ a health bar is up ⇒
   *  the label fades so it never competes with it. */
  readonly hpFraction?: number;
}

/** One label to draw: everything the pooled view needs, nothing it re-derives. */
export interface Nameplate {
  /** Owner slot — for the view/test to reason about identity if it wants. */
  readonly owner: PlayerId;
  /** Ship or station — the view stacks it above the bar cluster or above the HP pin. */
  readonly kind: NameplateKind;
  /** The resolved, length-clamped label text. */
  readonly text: string;
  /** The owner's **bot difficulty** as a recessive metadata suffix — `(EASY)` /
   *  `(MEDIUM)` / `(HARD)` (field request v0.2.2) — or `''` for a HUMAN seat (they
   *  never carry one) and any slot the difficulty table does not name. The view
   *  draws it dimmer than the name so it reads as metadata, not identity. Kept
   *  separate from {@link text} precisely so the two can be weighted differently;
   *  it flows through the SAME per-slot seam the name does ({@link resolveDifficultySuffix}). */
  readonly suffix: string;
  /** The owner's identity colour (style-guide §3), from the ratified roster. */
  readonly color: number;
  /** Entity centre, screen px — the view centres the label here and offsets it up. */
  readonly x: number;
  readonly y: number;
  /** Entity screen radius, so the view can float the label clear of the sprite. */
  readonly radius: number;
  /** Opacity 0..1 — full when calm, {@link NAMEPLATE_FADE_ALPHA} under clutter. */
  readonly alpha: number;
  /** True for the local player's own-ship label (only ever present when
   *  {@link NameplateOptions.showOwnShipLabel} is on). */
  readonly local: boolean;
}

/**
 * The per-slot name table. Indexed by {@link PlayerId} (slot 0..7); a slot with
 * no entry (or a blank one) degrades to a `P{n}` tag ({@link resolveName}). This
 * is the single data seam: offline it is built from the lobby's slot state (local
 * name + each bot's personality name); when online lands the server's room names
 * populate the exact same array with no change to this module.
 */
export type NameTable = readonly (string | undefined)[];

/**
 * The per-slot **difficulty** table, the exact mirror of {@link NameTable} and
 * fed through the same seam (field request v0.2.2). Indexed by {@link PlayerId};
 * a bot seat carries its tier word (`'easy' | 'medium' | 'hard'`, or any label —
 * the resolver upper-cases and wraps it), and a **human seat is left empty** so it
 * never shows a suffix. Offline it is built from the lobby's per-seat difficulty
 * picks alongside the name table; when online lands (m9) the room's slot
 * difficulties populate the same array with no change to this module.
 */
export type DifficultyTable = readonly (string | undefined)[];

/** Tunable knobs for {@link nameplateModel}. All optional; the defaults are the
 *  field-request calls (own-ship label off, the two alpha levels above). */
export interface NameplateOptions {
  /** Show the local player's OWN ship label. Default **false** — a name pinned to
   *  screen-centre reads as noise (field request rule 3; the own station is still
   *  labelled either way). Wire this to a settings toggle if a player disagrees. */
  readonly showOwnShipLabel?: boolean;
  /** Resting opacity. Default {@link NAMEPLATE_FULL_ALPHA}. */
  readonly fullAlpha?: number;
  /** Faded opacity under combat clutter. Default {@link NAMEPLATE_FADE_ALPHA}. */
  readonly fadeAlpha?: number;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** A slot is a real player seat (0..7), never an un-owned hostile (`-1`). */
function isOwnedSlot(owner: PlayerId): boolean {
  return Number.isFinite(owner) && owner >= 0;
}

/**
 * Resolve a slot's label text from the `names` table, with the defensive length
 * clamp and the `P{n}` fallback. Blank/whitespace-only names fall back too, so a
 * player who clears their name still shows an identity tag rather than an empty
 * label. Exported so the lobby and the model share one truth for "the name shown."
 */
export function resolveName(names: NameTable, owner: PlayerId): string {
  const raw = isOwnedSlot(owner) ? names[Math.floor(owner)] : undefined;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const text = trimmed.length > 0 ? trimmed : fallbackName(owner);
  return clampLen(text);
}

/** The identity tag a nameless slot shows — `P1`..`P8`, 1-based like the hull
 *  decal (style-guide §3 rule 3), so identity never depends on a name being set. */
export function fallbackName(owner: PlayerId): string {
  const slot = isOwnedSlot(owner) ? Math.floor(owner) : 0;
  return `P${slot + 1}`;
}

/**
 * Resolve a slot's **difficulty suffix** from the difficulty table (field request
 * v0.2.2): a bot seat's tier becomes the recessive metadata token `(EASY)` /
 * `(MEDIUM)` / `(HARD)`, upper-cased and parenthesised so it reads as metadata;
 * a human/absent/blank slot resolves to `''` (no suffix — humans never carry one).
 * The exact counterpart of {@link resolveName}, so the same per-slot seam that
 * decides "what name" decides "what difficulty tag."
 */
export function resolveDifficultySuffix(difficulties: DifficultyTable, owner: PlayerId): string {
  if (!isOwnedSlot(owner)) return '';
  const raw = difficulties[Math.floor(owner)];
  const tier = typeof raw === 'string' ? raw.trim() : '';
  return tier.length > 0 ? `(${tier.toUpperCase()})` : '';
}

/**
 * Whether this entity gets a label this frame, in one place so it can be
 * unit-tested: owned, alive, and — for the local ship only — not suppressed.
 */
export function nameplateGetsLabel(e: Nameable, opts: NameplateOptions = {}): boolean {
  if (!isOwnedSlot(e.owner)) return false;
  if (!e.alive) return false;
  // The local ship's own label is off unless explicitly enabled; a local STATION
  // (no `local` flag) is always labelled.
  if (e.kind === 'ship' && e.local && !(opts.showOwnShipLabel ?? false)) return false;
  return true;
}

/**
 * Turn a frame's label-bearing entities into the labels to draw. Pure: it filters
 * by {@link nameplateGetsLabel}, resolves text + difficulty suffix + colour + fade,
 * and passes screen position through untouched. Output order follows input, all a
 * pooled view needs.
 */
export function nameplateModel(
  entities: readonly Nameable[],
  names: NameTable,
  opts: NameplateOptions = {},
  difficulties: DifficultyTable = [],
): Nameplate[] {
  const full = opts.fullAlpha ?? NAMEPLATE_FULL_ALPHA;
  const fade = opts.fadeAlpha ?? NAMEPLATE_FADE_ALPHA;
  const plates: Nameplate[] = [];
  for (const e of entities) {
    if (!nameplateGetsLabel(e, opts)) continue;
    plates.push({
      owner: e.owner,
      kind: e.kind,
      text: resolveName(names, e.owner),
      suffix: resolveDifficultySuffix(difficulties, e.owner),
      color: playerColor(e.owner),
      x: e.pos.x,
      y: e.pos.y,
      radius: e.radius,
      alpha: underClutter(e) ? fade : full,
      local: e.kind === 'ship' && e.local === true,
    });
  }
  return plates;
}

/** True when a health bar is up over this entity (damaged or fighting), so the
 *  label steps back (field request rule 3 — never fight the bar for the eye). */
function underClutter(e: Nameable): boolean {
  const frac = e.hpFraction ?? 1;
  return (e.inCombat ?? false) || frac < 1;
}

function clampLen(text: string): string {
  if (text.length <= NAMEPLATE_MAX_CHARS) return text;
  // Keep a character for the ellipsis so the clamp is visible, not a silent cut.
  return `${text.slice(0, NAMEPLATE_MAX_CHARS - 1)}…`;
}
