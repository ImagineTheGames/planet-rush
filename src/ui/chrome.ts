/**
 * src/ui/chrome.ts — the ONE panel-chrome skin contract. OWNER: UI Engineer.
 *
 * Every menu, the map picker, the build wheel and the HUD are made of the same
 * three physical materials: a **panel** that recedes into the void, a **hairline
 * rule** that draws its edge, and **muted label text** for the words that are not
 * the thing you act on. Before this file each view hand-rolled those three from
 * whatever hex and alpha was nearest — the ore prompt panel filled `vacuum` at
 * .82, the minimap at .72, the settings backdrop at .96, and the corner radius on
 * a panel ranged from 3 to 12 across the directory. The result read as a dozen
 * slightly different UIs sharing a screen.
 *
 * The ui-mockup (docs/art-direction/ui-mockup.html) draws the whole screen in ONE
 * chrome: panels are `#10141C`, their rule is `#252D3A`, muted labels are
 * `#8B95A5`, and corners step through a short radius scale (a card is rounder than
 * a control, a control rounder than a chip). Those three tones are already
 * ratified — they are the **void material's shades** in the art direction
 * (`src/art/tokens.ts` `MATERIALS.void.shades`: "HUD panel fill", "HUD hairline /
 * divider rule", "Secondary (muted) HUD label text"). This file names them so a
 * view spends them by role instead of by hex, and the sibling test
 * ({@link ./chrome.test}) pins each back to its art-token shade so the UI skin and
 * the art direction can never drift into two different Cold Vacuums — the same
 * cross-check discipline `button-theme.ts` and the art `compliance` suite use.
 *
 * Pure data. No Pixi, no DOM — a view imports the tokens and applies them to its
 * own Graphics, exactly as it already does with {@link ./button-theme} and
 * {@link ./typography}. Nothing here is signal yellow (reserved: ore) or threat
 * red (reserved: danger); the void shades are neutral chrome by construction
 * (style-guide §1/§2).
 */

// ---------------------------------------------------------------------------
// The three chrome tones — the void material's shades (style-guide §1; art
// tokens MATERIALS.void.shades). ./chrome.test pins each to its art source.
// ---------------------------------------------------------------------------

/** A HUD/menu panel fill. One step up from `vacuum`, so a panel reads as chrome
 *  sitting on the void rather than a hole in it (art void shade "HUD panel fill"). */
export const PANEL_FILL = 0x10141c;

/** A panel's edge and every divider rule — the hairline that bounds chrome
 *  (art void shade "HUD hairline / divider rule"). */
export const PANEL_RULE = 0x252d3a;

/** Secondary label text: the words a player reads but does not act on — TOTAL,
 *  HOME, MATCH, a wedge's target line, a strip action (art void shade "Secondary
 *  (muted) HUD label text"). Distinct from the disabled grey in
 *  {@link ./button-theme} (`hullSteel`), which is a *state*, not a role. */
export const TEXT_MUTED = 0x8b95a5;

// ---------------------------------------------------------------------------
// Panel treatment — the default fill/rule weights a panel draws with.
// ---------------------------------------------------------------------------
//
// A floating panel sits over the live world (the ore prompt over the planet, the
// wheel over the ship), so it is nearly-opaque rather than solid — enough to lift
// its contents off the scene without blacking the world out. The mockup draws HUD
// panels at ~.9; the rule is a solid 1px hairline.

/** A floating panel's fill opacity (mockup HUD panels ≈ .9). */
export const PANEL_FILL_ALPHA = 0.9;

/** A panel/divider rule's stroke width — a single crisp hairline. */
export const PANEL_RULE_WIDTH = 1;

/** A panel/divider rule's opacity. Solid: the edge is structure, not decoration. */
export const PANEL_RULE_ALPHA = 1;

// ---------------------------------------------------------------------------
// The radius scale — corners, by the size of the thing they round (mockup).
// ---------------------------------------------------------------------------

/**
 * The short corner-radius scale the mockup steps through. Bigger surfaces are
 * rounder: a full card (the menu box, a map card, the minimap) is roundest, a
 * control (a button, the ore/prompt panel) is a step tighter, a chip (a small tag
 * or toggle) tighter still, and a bar (an HP/pip sliver) is barely rounded. A view
 * picks the tier by what it is drawing, so the whole UI rounds consistently.
 */
export const RADIUS = {
  /** A full card / large panel — menu box, map card, minimap frame. */
  card: 12,
  /** A HUD/menu panel or a floating overlay — the ore prompt, the respawn panel. */
  panel: 10,
  /** A pressable control — every menu button, a map/ship card body. */
  control: 8,
  /** A small tag / toggle / chip. */
  chip: 6,
  /** A thin bar — an HP bar, an ore pip. Barely rounded, so a sliver still reads. */
  bar: 2,
} as const;

export type RadiusTier = keyof typeof RADIUS;
