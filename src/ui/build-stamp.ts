/**
 * src/ui/build-stamp.ts — THE CORNER THE BUILD STAMP OWNS. OWNER: UI Engineer (a0-129).
 *
 * The build stamp is the tiny mono tag in the bottom-left corner of every screen
 * — `@render/build-badge`, ratified by the developer at M10 as *"shown on every
 * single page"*, and the first thing anyone reads off a screenshot to say which
 * build a bug is against. It is drawn by the boot path's own badge layer, above
 * every screen, and no screen draws a second copy.
 *
 * ---------------------------------------------------------------------------
 * WHY A UI-OWNED MODULE FOR SOMEONE ELSE'S ELEMENT
 * ---------------------------------------------------------------------------
 * a0-127, photographing something else, found the MAP SELECT screen drawing its
 * BACK plate across the stamp — *"the plate's white accent bar landing on the
 * final character"*, 55% of the stamp's rect on the plate's body — and made the
 * observation this module exists for:
 *
 * > *"MEASURED off these pixels rather than off a registry — there is no registry
 * > to read here."*
 *
 * a0-122's overlap sweep compares every registered rect against every other, so
 * it is exactly as complete as the registry it reads. On a menu screen the
 * registry is **empty**: `main.ts` `refreshLayout` is the client's only
 * registration path and it runs on match frames, and the badge registers there
 * (`BADGE_ID`) and nowhere else. An element ratified as appearing on *every* page
 * that is registered on *one* of them is a hole in a gate we are relying on, and
 * the hole is the reason a0-122 could not have found this and could not find the
 * next one.
 *
 * So this file gives the menus the two things the sweep needs: the stamp's rect,
 * as a {@link LayoutEntry} a screen can register alongside its own furniture
 * ({@link buildStampEntry}), and the row of pixels the stamp is entitled to
 * ({@link buildStampRow}), which is what a screen's furniture has to clear.
 *
 * ---------------------------------------------------------------------------
 * WHICH YIELDS — THE PLATE, AND IT YIELDS UPWARD
 * ---------------------------------------------------------------------------
 * The brief asks the question and asks for the argument. Three facts decide it:
 *
 * **1. The stamp's WIDTH changes at runtime.** The tag grows a server field and
 * an rtt field the moment a session is welcomed (`@platform/build-identity`;
 * `3d7cc6a` → `3d7cc6a · d891dd0a (gru) · 62ms`), and `fitBadgeTag` drops
 * trailing fields only when the zone cannot hold them. A control placed to clear
 * the stamp *sideways* is therefore placed against a number that changes under
 * it — correct offline, covered on connect, and the lobby screens where this was
 * found are precisely the connected ones. A clearance measured *vertically* is
 * sized by the stamp's LINE, which is fixed by `BADGE_FONT_SIZE`.
 *
 * **2. The footer beam is the stamp's ratified ground.** `./main-menu`'s own
 * layout says so in as many words — *"the footer beam … carries the
 * build-identity stamp, which is drawn by the boot path's own badge layer — the
 * beam is the plate it sits on, and the menu deliberately does not draw a second
 * copy"*. A beam is structure: dark, unlit, and drawn before anything else, which
 * is what makes a 10px hull-steel tag at 0.55 alpha readable on it. The main menu
 * has no footer plate and has never had this defect. The screens that grew one —
 * the two pickers (u10-01), the codex, the lobby, the doors — bolted a bright
 * plate onto the ground the stamp was already sitting on. **They are the
 * newcomers, so they are what moves.**
 *
 * **3. Lifting the stamp instead would hand its placement to ten screens.** One
 * badge, owned by the boot path, living above every screen, is the whole design
 * (`@render/build-badge`: *"rather than one per screen that three of them would
 * forget"*). Its one lift — `BADGE_STRIP_LIFT`, over the desktop controls strip —
 * is set once in `main.ts` for the one screen with furniture on the bottom edge.
 * A per-menu lift would be ten more, in a file no UI screen owns, and the first
 * screen to forget one would be back here. The stamp is also *already* what other
 * elements clear rather than the other way round: `./layout-exclusions`
 * `ARROW_KEEPOUT_IDS` names `build-badge`, so the under-attack arrow has yielded
 * to it since a0-125.
 *
 * And the constraint the brief sets: nothing here shrinks or dims the stamp. It
 * is 10px at 0.55 alpha before this change and after it. What changes is what is
 * drawn underneath it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS ARE MIRRORED RATHER THAN IMPORTED
 * ---------------------------------------------------------------------------
 * `@render/build-badge` carries PixiJS. This module is deliberately Pixi-free,
 * like `./hud-geometry`, `./layout-exclusions` and `./anchor-reach`, so a screen's
 * geometry unit-tests headless. The three numbers it needs are therefore mirrored
 * as constants and **pinned against their source** in `./hud-geometry.test.ts` —
 * the same mirror-a-platform-constant discipline `./anchor-reach`
 * (`BADGE_STRIP_LIFT_MIRROR`) and `./minimap` (`MINIMAP_FIRE_COLUMN`) already use.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * layout registry's convention, unchanged.
 */

import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';

// ---------------------------------------------------------------------------
// The mirrored numbers
// ---------------------------------------------------------------------------

/** Mirror of `@render/build-badge` `BADGE_ID`. The stamp registers under one id
 *  everywhere — the match registers the measured rect through
 *  `BuildBadge.layoutBounds`, a menu registers {@link buildStampEntry} — so a
 *  finding on either names the same element. */
export const BUILD_STAMP_ID = 'build-badge';

/** Mirror of `@render/build-badge` `BADGE_MARGIN` (8): the stamp's inset from the
 *  bottom and left **viewport** edges. Not the safe area: the badge corners
 *  itself off the logical viewport (`writeBadgeRect`), which is why every
 *  function here takes the raw viewport and not a `GantryFrame`. */
export const BUILD_STAMP_MARGIN = 8;

/**
 * The stamp's line box, CSS px.
 *
 * The one number here that is a MEASUREMENT rather than a mirror, and it is
 * a0-127's: the client reported drawing the stamp at `{8,363 43.5x13}` on a
 * 798x384 handset, at `BADGE_FONT_SIZE` 10. It cannot be derived here, because
 * the stamp is set in the platform's own mono stack (`BADGE_FONT` — IBM Plex
 * Mono, `ui-monospace`, …) rather than in one of the self-hosted faces
 * `./font-metrics` carries per-glyph advances for, so there is no headless
 * measurement of it to take. `./hud-geometry.test.ts` pins it against
 * `BADGE_FONT_SIZE` — a line box below the type size would be nonsense — and
 * against the rect a0-127 photographed.
 */
export const BUILD_STAMP_LINE = 13;

/** Mirror of `@render/build-badge` `BADGE_ANCHOR` — the declared placement the
 *  registry resolves the stamp's zone from. */
export const BUILD_STAMP_ANCHOR: AnchorSpec = {
  region: 'bottom-left',
  margin: BUILD_STAMP_MARGIN,
};

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/**
 * **The pixels the stamp is entitled to on `viewport`** — its whole row, from the
 * left margin to the right edge of its declared `bottom-left` zone.
 *
 * It is a ROW and not a measured rect on purpose, and the purpose is fact 1 in
 * the header. `@render/build-badge` `badgeAvailableWidth` is `W/2 − margin` — the
 * room the zone gives the tag before `fitBadgeTag` starts dropping fields — and
 * the tag really does travel most of it: a connected session's three-field tag is
 * ~205px against a 43px offline one, on a screen whose furniture did not move.
 * Reserving the row rather than today's string is the difference between a fix
 * that survives the next `welcome` frame and one that does not.
 *
 * The direction of the error is deliberate: the row can only ever be WIDER than
 * the ink, so a screen it flags is a screen with a plate in a corner the stamp is
 * allowed to grow into — a defect waiting for a connect, not a false alarm.
 *
 * `lift` is the badge's own bottom clearance (`BuildBadge.lift` —
 * `BADGE_STRIP_LIFT` while the desktop controls strip is drawn, 0 everywhere
 * else), so a caller that knows the stamp is raised reserves the raised row.
 */
export function buildStampRow(viewport: Viewport, lift = 0): Rect {
  const height = Math.max(0, Math.min(BUILD_STAMP_LINE, viewport.height));
  return {
    x: BUILD_STAMP_MARGIN,
    y: viewport.height - BUILD_STAMP_MARGIN - height - Math.max(0, lift),
    width: Math.max(0, viewport.width / 2 - BUILD_STAMP_MARGIN),
    height,
  };
}

/**
 * The y a plate's BOTTOM edge may not pass if the stamp is to stay readable
 * under it — the top of {@link buildStampRow}.
 *
 * Named separately because that is how every caller uses it: a footer plate is
 * placed by an existing rule (centred in its beam, bottom-aligned where the beam
 * is shorter than the thumb floor) and then clamped, and a clamp wants a number
 * rather than a rect.
 */
export function buildStampFloor(viewport: Viewport, lift = 0): number {
  return buildStampRow(viewport, lift).y;
}

/**
 * The stamp as the layout registry sees it on a screen that draws it —
 * {@link BUILD_STAMP_ID}, its declared anchor, and the row it owns.
 *
 * **What the bounds are, stated plainly.** In a match the client registers the
 * badge's *measured* rect (`main.ts`, `BuildBadge.layoutBounds`), because there
 * the badge object is in hand and Pixi has already measured its text. A menu
 * screen has neither — its layout is a pure function of a viewport — so what it
 * registers is the row above: the stamp's zone, which is what the stamp fills
 * whenever the identity is long enough and what its neighbours must clear either
 * way. That is an overstatement of the ink and never an understatement, and the
 * header argues why that is the honest direction for this element.
 */
export function buildStampEntry(viewport: Viewport, lift = 0): LayoutEntry {
  return { id: BUILD_STAMP_ID, anchor: BUILD_STAMP_ANCHOR, bounds: buildStampRow(viewport, lift) };
}

/**
 * `rect` lifted just clear of the stamp's row, growing **upward** — the fix, in
 * one function, for every plate a menu bolts to a footer beam.
 *
 * Upward and not sideways is fact 1 in the header. It never resizes the plate:
 * a control that got smaller to make room for a stamp would be the m10-14 lesson
 * (*"nothing may cover a control"*) obeyed by breaking the control instead, and
 * the thumb floor is not this module's to spend. A plate that already clears the
 * row is returned untouched, so this costs nothing on the screens and viewports
 * where the two were never in the same pixels.
 *
 * Takes the row rather than a viewport so a caller that has already resolved one
 * — every screen in this directory does, through `./gantry` `GantryFrame.stamp` —
 * cannot resolve a second one that disagrees with it.
 */
export function clearBuildStamp(rect: Rect, stampRow: Rect): Rect {
  if (rect.width <= 0 || rect.height <= 0) return rect;
  if (rect.y + rect.height <= stampRow.y) return rect;
  // Never off the top of the frame. On a viewport too short to hold a control
  // and a stamp at once there is no placement that satisfies both, and a plate
  // pushed above y=0 is a control the player cannot reach — which is a worse
  // answer than a stamp that is hard to read. Unreachable on every profile in
  // the matrix (the shortest is 320px against a 21px row); it is here so the
  // function is total, like `promptBounds`'s own clamp.
  return { ...rect, y: Math.max(0, stampRow.y - rect.height) };
}
