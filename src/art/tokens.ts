/**
 * src/art/tokens.ts — the Cold Vacuum art direction, as code. OWNER: Art & Audio Agent.
 *
 * The **single source** every a2 art brief imports. It extracts the developer's
 * concept boards (docs/art-direction/) into typed constants: the palette, the
 * material vocabulary (steel / ice / ember / void), line weights, the glow
 * language, silhouette rules, and the UI type scale — so no generator ever
 * re-invents a hex, a stroke width, or a font size from memory. `palette.ts`
 * sources the six colours and the roster from here; `compliance.ts` enforces
 * them; the a2-02..07 form briefs read the rest.
 *
 * The direction froze on the **Cold Vacuum** board (concept-round2.html · I2 —
 * "de-oranged: steel, patina, signal yellow"), refined in cold-vacuum-elements-r2,
 * ui-mockup, ship-classes and scene-gallery. Those boards are the visual target;
 * `style-guide.md` is the ratified contract distilled from them.
 *
 * **Precedence — where the boards and the contract disagree, the contract wins:**
 *
 *  - The early boards drew the 8-player roster in cyan / red / gold
 *    (`#4DC3FF` = plasma, `#E24A3B` ≈ danger, `#FFC93E` ≈ ore) — hues that
 *    collide with reserved material colours. `style-guide.md` §3.1 replaced them
 *    with a collision-free roster; that roster (below) is authoritative.
 *  - The boards drew earthlike oceans in a saturated blue (`#2E6E9E`). §1's
 *    "no seventh hue" rule pulls that back to a steel-blue *shade* within the
 *    ramp. The saturated blue lives here only as a documented reference tone.
 *  - ui-mockup set the whole HUD in Audiowide; §7 splits the faces —
 *    Audiowide display, **Oxanium** for HUD numerals (it holds at 12px).
 *
 * Every such divergence is ranked in docs/art-direction/GAP-ANALYSIS.md. This
 * file records only the ratified values; the superseded ones stay in the boards.
 */

// ---------------------------------------------------------------------------
// 1. Palette — the six frozen colours (style-guide §1 / Cold Vacuum board)
// ---------------------------------------------------------------------------

/**
 * The six Cold Vacuum material colours — the whole world palette. Packed 0xRRGGBB.
 * `palette.ts` re-exports these as its `PALETTE`, so this object is the one place
 * a material hex is ever written.
 */
export const PALETTE = {
  /** Background. Near-black, so every entity carries its own contrast. */
  vacuum: 0x0d1015,
  /** All ships, all players. Hulls never take player colour. */
  hullSteel: 0x7e8894,
  /** Corrosion, continents, the repair channel. The "old system" tint. */
  patina: 0x4fa08b,
  /** Ore, hazard stripes, costs, the station core. **RESERVED** (§2). */
  signalYellow: 0xf2d24b,
  /** Weapon fire, cockpits, energy. The cold cutting-torch blue. */
  plasma: 0x4dc3ff,
  /** Damage, alarms, enemy fire, the under-attack tell. */
  threatRed: 0xb23a3a,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** The light end of the value ramp. Never a material colour; also the star fill. */
export const WHITE = 0xffffff;

/**
 * **FLOOR — the ground the play-field is drawn on** *(ratified 2026-08-07 by the
 * developer off the backdrop compositor: "i like floor")*.
 *
 * `#010204`. Not a seventh hue and not a replacement for {@link PALETTE.vacuum}:
 * it is the *same cool blue-black* at a much lower value — hue 220° against
 * Vacuum's 217.5°, luma 1.9 against Vacuum's 15.5. The distinction is what each
 * one is FOR:
 *
 *  - **Vacuum `#0D1015`** stays the material colour. It is the dark endpoint of
 *    the value ramp (`palette.ts` `shade()`), the HUD panel fill, the tone every
 *    derived shade is mixed toward, and the reference the §1 contrast rule is
 *    quoted against. Nothing about it moves.
 *  - **Floor `#010204`** is the *backdrop*, and only the backdrop: the ground the
 *    void star-field and its nebula are composited over (`./backdrop`). Nothing
 *    else in the game is ever painted Floor.
 *
 * Darker ground is strictly better for the one legibility worry it raises, and
 * this was measured rather than argued: `rockBody #484E57` reads **2.27:1**
 * against Vacuum and **2.47:1** against Floor — 8.9% *more* contrast. Space is
 * black and the asteroids are grey; a lower ground raises contrast for anything
 * lighter than it, which is everything. No rim light, contrast floor, or other
 * compensation is warranted, and none was added.
 */
export const FLOOR = 0x010204;

/**
 * The 8-slot player identity roster (style-guide §3.1 — ratified, supersedes the
 * boards' cyan/red/gold slots). Identity is an additive trim layer over the steel
 * fleet, always paired with the hull-number decal so no player is read by hue
 * alone. Every slot sits clear of ore yellow and danger red.
 */
export const PLAYER_ROSTER = [
  0x3d7bff, // P1 Azure
  0x22d3c5, // P2 Cyan
  0x3dd68c, // P3 Spring
  0x9b5de5, // P4 Violet
  0xf15bb5, // P5 Magenta
  0xff8a3d, // P6 Orange
  0xdce3ec, // P7 Chalk
  0x5c6ce0, // P8 Slate-Blue
] as const;

// ---------------------------------------------------------------------------
// 2. Material vocabulary — steel / ice / ember / void
// ---------------------------------------------------------------------------
//
// The four families the direction names. Every one of the six palette colours
// belongs to exactly one, which is what lets a form brief say "a steel highlight"
// or "an ice glow" and mean something precise. This is a *conceptual* grouping
// for authoring; the RESERVED-rule enforcement in compliance.ts groups colours
// by their exact palette base, independently of this map.

/** The four material families of Cold Vacuum. */
export type MaterialName = 'steel' | 'ice' | 'ember' | 'void';

/** A board-observed tone: a hex plus where it appears. Reference, not allow-list. */
export interface BoardShade {
  readonly hex: number;
  readonly where: string;
}

export interface MaterialFamily {
  /** Which of the six anchor this family. */
  readonly bases: readonly PaletteKey[];
  /** One line: what this material says on screen. */
  readonly reads: string;
  /** The tones the boards actually draw this material across. Reference only. */
  readonly shades: readonly BoardShade[];
}

/**
 * The material vocabulary. `shades` are the boards' observed tones — the a2 form
 * briefs render toward these. The shipped generator reaches most of them through
 * the value ramp in `palette.ts` (`DERIVED`), which keeps them inside the six-
 * colour "no seventh hue" rule; where a ramp shade and its board tone visibly
 * diverge (oceans, most notably) GAP-ANALYSIS.md ranks the fix.
 */
export const MATERIALS = {
  /** Industrial metal and its oxidation — the fleet, turrets, rock, wrecks. */
  steel: {
    bases: ['hullSteel', 'patina'],
    reads:
      'Gunmetal hulls and the teal patina they corrode into — "an old machine in vacuum, not a cave." Ships, turrets, asteroids and wrecks all live here; patina is steel gone green with age (corrosion, continents, the repair channel).',
    shades: [
      { hex: 0x8f99a6, where: 'Lit top plating on hulls and turrets' },
      { hex: 0x6e7987, where: 'Wing / underside plating and cannon barrels' },
      { hex: 0x5a6470, where: 'Thruster wells and turret skirts' },
      { hex: 0x454e59, where: 'Asteroid mineral body' },
      { hex: 0x3e4750, where: 'Asteroid satellite facets / shadow rock' },
      { hex: 0x262c34, where: 'The universal ink outline on every sprite' },
    ],
  },
  /** Cold blue light — the only cool glow in the game. */
  ice: {
    bases: ['plasma'],
    reads:
      'The cold cutting-torch blue: the plasma torch, cockpit glass, shield sheen and the frost veins on an ice-cored asteroid. Also the register the steel-blue ocean sits in. Energy reads cold here — never a warm spark.',
    shades: [
      { hex: 0xdff4ff, where: 'Bright inner pass of the plasma torch' },
      { hex: 0xc6cdd6, where: 'Cold off-white ("bone"): rail barrels, wreck struts, HUD text and HP-bar frames' },
      { hex: 0x2e6e9e, where: 'Earthlike ocean on the boards — reads bluer than the shipped grey-blue; see GAP-ANALYSIS' },
    ],
  },
  /** The only warmth in the vacuum — and it always means something. */
  ember: {
    bases: ['signalYellow', 'threatRed'],
    reads:
      'The two warm signals, both load-bearing: signal yellow = ore and the station core ("this matters"), threat red = damage, alarm and enemy fire ("this hurts"). Warmth is rationed to meaning — there is no decorative amber in Cold Vacuum (both hues are RESERVED, §2).',
    shades: [
      { hex: 0xfff6c8, where: 'The hot lit centre of the station core' },
      { hex: 0xffd9d3, where: 'Bright inner pass of enemy-fire / the alarm tell' },
    ],
  },
  /** The dark that every entity contrasts against. */
  void: {
    bases: ['vacuum'],
    reads:
      'Near-black space and the HUD panels that recede into it. There is no lighter backdrop; every entity must read against the void on its own (§1 contrast rule).',
    shades: [
      { hex: 0x10141c, where: 'HUD panel fill' },
      { hex: 0x252d3a, where: 'HUD hairline / divider rule' },
      { hex: 0x8b95a5, where: 'Secondary (muted) HUD label text' },
    ],
  },
} as const satisfies Record<MaterialName, MaterialFamily>;

// ---------------------------------------------------------------------------
// 3. Line weights — the ink language (concept-board scale)
// ---------------------------------------------------------------------------

/**
 * Stroke weights, in px at the concept-board reference scale (a hero ship ≈ 90px
 * wide, a station ≈ 130px across — ui-mockup viewBox 1280×720, element studies
 * 230×130). Generators express these relative to sprite size; a form brief scales
 * from the ratios below. Cold Vacuum's read comes from a crisp, consistent ink
 * outline, not from detail — so the weight scale is short on purpose.
 */
export const LINE = {
  /** Reference scale the px weights below are quoted at. */
  referenceScale: 'hero ship ≈ 90px wide · station ≈ 130px across',
  /** Callout leaders, minimap rings, faint interior detail. */
  hairline: 1,
  /** UI element strokes, HP-bar frame, small turret detail. */
  detail: 1.6,
  /** The universal entity outline — ships, turrets, ore — drawn in the ink tone. */
  sprite: 2.5,
  /** Asteroid and wreck bodies: heavier, so a rock reads as a solid mineral mass. */
  rock: 3,
  /** Ownership beacon ring, in the player's colour. Always visible. */
  beacon: 4,
  /** Hazard-ring shield (dashed yellow-on-void). The thickest line in the game. */
  shield: 6,
} as const;

// ---------------------------------------------------------------------------
// 4. Glow language — brighter, not blurrier
// ---------------------------------------------------------------------------

/**
 * How Cold Vacuum glows. The winning board dropped the neon gaussian bloom of the
 * early exploration: every entity is a flat fill inside a crisp ink silhouette,
 * and "glow" is a **brighter inner pass on the same shape** — a hot core over a
 * cooler body. It stays cheap, instances cleanly, and survives the 24px read.
 * A form brief that wants an effect to feel energised adds an inner tint; it does
 * not add a blur.
 */
export const GLOW = {
  principle:
    'No bloom. Glow is a brighter inner pass on a crisp silhouette, never a gaussian blur — so effects stay cheap, instanced and legible at 24px on the void.',
  /** Weapon fire, torch, cockpit: a plasma body with a white-tinted inner core. */
  energy: { base: 'plasma', innerTowardWhite: 0.45, inner: 0xdff4ff },
  /** Station core: signal-yellow disc, hot near-white centre. Obeys RESERVED (§2). */
  core: { base: 'signalYellow', innerTowardWhite: 0.35, inner: 0xfff6c8 },
  /** Frost veins on an ice-cored asteroid, brightening toward the break. */
  frost: { base: 'plasma' },
  /**
   * The under-attack tell: a threat-red edge that pulses — slow near 50% core HP,
   * fast near 25% (element studies HP bar). Pairs with the audible alarm (GDD §3.6);
   * the station-death beat then goes quiet (§8).
   */
  alarm: { base: 'threatRed', behaviour: 'edge-pulse', pulseSlowAt: 0.5, pulseFastAt: 0.25 },
} as const;

// ---------------------------------------------------------------------------
// 5. Silhouette rules — shape carries class, colour carries player
// ---------------------------------------------------------------------------

/**
 * The readability contract for hulls (style-guide §3, §4, §9). Silhouette carries
 * *class* identity and colour carries *player* identity, so a colourblind player
 * still reads what (shape) and who (hull-number decal) with colour removed.
 */
export const SILHOUETTE = {
  /** Every hull must be unambiguous at this size, greyed, on the void (§4, §9). */
  legibilitySizePx: 24,
  /** The grey-out test paints the hull flat steel with player colour removed. */
  greyTest: 'hullSteel',
  /** Nose points +x; the weapon emitter sits on the nose / prow and is marked. */
  facing: 'right',
  /** The four week-one hulls and the shape each silhouette must telegraph (§4). */
  classes: {
    interceptor: { hull: 'Quadfin', intent: 'Narrow, swept, four canted fins — the fastest, lightest read.' },
    vanguard: { hull: 'Anvil', intent: 'Faceted arrowhead brick — the neutral, symmetric baseline shape.' },
    excavator: { hull: 'Pincer', intent: 'Forked prongs framing the muzzle — reads as a mining tool up front.' },
    hauler: { hull: 'Hammerhead', intent: 'Widest, blunt hammerhead mass — visibly the heavy, slow, tanky hull.' },
  },
  /** Player colour appears only on trim; the hull body stays steel (§3). */
  trimOnly: ['wing tips', 'cockpit glass', 'engine flame', 'weapon tint', 'beacon ring', 'HP bar'],
} as const;

// ---------------------------------------------------------------------------
// 6. Type scale — Audiowide display, Oxanium HUD (style-guide §7)
// ---------------------------------------------------------------------------

/**
 * The two faces and the UI type scale. Both are OFL and self-hosted under
 * `assets/` — no CDN, no Google Fonts call, offline-first (§7). Sizes are px at
 * the 1280×720 reference (ui-mockup); a mobile layout scales down but must keep
 * the HUD above the legibility floor.
 */
export const TYPE = {
  /** Wordmark, headings, menu confirmations, class names — the arcade half of the tone. */
  display: { family: 'Audiowide', weights: [400] },
  /** HUD numerals and body text. Holds at 12px; the practical HUD face. */
  hud: { family: 'Oxanium', weights: [500, 700, 800] },
  hosting: 'Both OFL, self-hosted under assets/ — no CDN, offline-first (§7).',
  /** px at the 1280×720 reference. `face` selects `display` or `hud` above. */
  scale: {
    wordmark: { px: 44, face: 'display', tracking: 0.02 },
    h1: { px: 34, face: 'display' },
    h2: { px: 22, face: 'display' },
    hudLabel: { px: 15, face: 'hud', weight: 800 },
    hudValue: { px: 16, face: 'hud', weight: 800 },
    caption: { px: 12, face: 'hud' },
    /** The legibility floor: Oxanium must stay readable here, at mobile thumb-scale (§7, §9). */
    min: { px: 12, face: 'hud' },
  },
  /** Letter-spacing for the uppercase eyebrow / room tag. */
  eyebrowTracking: 0.26,
  rules: [
    'Never set HUD numerals in Audiowide; never set the wordmark in Oxanium (§7).',
    'Verify Oxanium at 12px on the mobile thumb-scale layout, not just desktop (§7, §9).',
  ],
} as const;
