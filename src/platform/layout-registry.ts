/**
 * src/platform/layout-registry.ts — the LAYOUT REGISTRY. OWNER: Platform Engineer.
 *
 * The executable form of a standing directive: **"if something is supposed to
 * appear somewhere, it appears there."** After a run of positional bugs (a HUD
 * element drifting out of its corner, a touch stick pinned to the wrong half),
 * the developer asked that placement stop being a thing we eyeball in a
 * screenshot and start being a thing a test can assert. This module is that.
 *
 * Every positioned visual element registers, once per frame, a
 * {@link LayoutEntry}:
 *
 *   - `id`     — a stable name (e.g. `"ore-hud"`, `"touch-fire-button"`).
 *   - `anchor` — the **declared region spec**: where the element is *supposed*
 *                to be (the design intent), expressed in the anchor vocabulary
 *                below plus a margin.
 *   - `bounds` — the **actual rendered rect** in screen space (CSS pixels), as
 *                the element was really drawn this frame.
 *
 * A tool (or a test, or the developer at the console) can then ask a single
 * question per element: does the *actual* rect sit inside the *declared* region?
 * — {@link LayoutRegistry.withinAnchor}. Drift is caught mechanically instead of
 * by eye. The registry is refreshed every frame and exposed **read-only** at
 * `window.__planetRush.layout`, and **only under `?debug=1`** — it is a
 * developer instrument, off and zero-cost in a normal build (see `main.ts`).
 *
 * This module is pure and DOM-free: the hot core ({@link LayoutRegistry}) never
 * touches a browser global, and the debug hook installer takes an injectable
 * target, so the whole thing unit-tests headless.
 *
 * ===========================================================================
 * THE ANCHOR VOCABULARY — a ratified contract (change only via the Director)
 * ===========================================================================
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * same convention the touch layer and the orientation overlay use (touch.ts
 * PointerSample, orientation.ts). The Application's `autoDensity` maps CSS px to
 * device px, so registrants and readers both speak CSS px.
 *
 * An {@link AnchorSpec} is a `region` name plus an optional `margin` (px inset
 * from whichever viewport edges the region touches). A region names a
 * rectangular **zone** of the viewport `W×H` that the element must live inside.
 * The zones (before margin) are:
 *
 *   Horizontal bands: left = x∈[0, W/2],  right = x∈[W/2, W],
 *                     h-center = x∈[W/3, 2W/3].
 *   Vertical bands:   top = y∈[0, H/3],   bottom = y∈[2H/3, H],
 *                     v-center = y∈[H/3, 2H/3].
 *
 *   | region             | zone (before margin inset)                        |
 *   |--------------------|---------------------------------------------------|
 *   | `top-left`         | left  ∩ top      — corner HUD (ore, banked total) |
 *   | `top-center`       | h-center ∩ top   — the asteroid-wave clock        |
 *   | `top-right`        | right ∩ top      — own-planet HP (day 2+)          |
 *   | `bottom-left`      | left  ∩ bottom                                    |
 *   | `bottom-right`     | right ∩ bottom   — minimap (day 2+)               |
 *   | `bottom-center`    | h-center ∩ bottom                                 |
 *   | `bottom-strip`     | full width, y∈[H−STRIP, H] — the controls strip   |
 *   | `left-half-bottom` | x∈[0, W/2], y∈[H/2, H] — the left thrust stick     |
 *   | `right-half-bottom`| x∈[W/2, W], y∈[H/2, H] — aim stick / FIRE button  |
 *   | `center`           | v-center ∩ h-center — the local ship, prompts     |
 *   | `full`             | the whole viewport (overlays)                     |
 *
 * `margin` insets the zone edges that coincide with a viewport edge (so a
 * `top-left` element with margin 16 must clear 16px from the top and left, but
 * the interior edges at W/2 and H/3 are unchanged). Interior-only regions
 * (`center`, `top-center`) inset all four edges by the margin, since none of
 * their edges is a hard screen edge to hug.
 *
 * `bottom-strip`'s STRIP height is a parameter of the resolver
 * ({@link ResolveOptions.stripHeight}, default {@link DEFAULT_STRIP_HEIGHT}) so
 * the thin bottom band can match the real controls-strip height.
 */

// ---------------------------------------------------------------------------
// Vocabulary types
// ---------------------------------------------------------------------------

/** The declared anchor regions (see the file header table). Ratified contract. */
export type AnchorRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-strip'
  | 'left-half-bottom'
  | 'right-half-bottom'
  | 'center'
  | 'full';

/** A declared placement: a region plus an optional edge margin (CSS px). */
export interface AnchorSpec {
  readonly region: AnchorRegion;
  /** Inset from the viewport edges the region touches. Default 0. */
  readonly margin?: number;
}

/** An axis-aligned rectangle in screen space, CSS px, origin top-left, y-down. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The current drawable viewport, CSS px. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** One element's registration for a frame: where it should be, where it is. */
export interface LayoutEntry {
  /** Stable element id (e.g. `"ore-hud"`, `"touch-fire-button"`). */
  readonly id: string;
  /** Declared region — the design intent. */
  readonly anchor: AnchorSpec;
  /** Actual rendered rect this frame, screen space. */
  readonly bounds: Rect;
}

// ---------------------------------------------------------------------------
// Anchor resolution — the "supposed to appear there" made executable
// ---------------------------------------------------------------------------

/** Default thin-band height for `bottom-strip`, CSS px (≈ controls-strip band). */
export const DEFAULT_STRIP_HEIGHT = 48;

/** Options for {@link resolveAnchor} / {@link LayoutRegistry.resolveAnchor}. */
export interface ResolveOptions {
  /** Height of the `bottom-strip` band, CSS px. Default {@link DEFAULT_STRIP_HEIGHT}. */
  readonly stripHeight?: number;
}

/**
 * Resolve an {@link AnchorSpec} to the concrete screen zone the element must
 * live inside, for a given viewport. This is the executable half of the
 * directive: the returned rect is exactly "where it is supposed to appear," and
 * {@link withinAnchor} checks the actual bounds against it.
 *
 * Pure; allocates one Rect (fine — this is a dev-tool path, not the sim hot loop).
 */
export function resolveAnchor(anchor: AnchorSpec, viewport: Viewport, opts?: ResolveOptions): Rect {
  const W = viewport.width;
  const H = viewport.height;
  const m = Math.max(0, anchor.margin ?? 0);
  const strip = Math.max(0, opts?.stripHeight ?? DEFAULT_STRIP_HEIGHT);

  // Band edges.
  const left0 = 0;
  const halfX = W / 2;
  const thirdX = W / 3;
  const twoThirdX = (2 * W) / 3;
  const top0 = 0;
  const thirdY = H / 3;
  const twoThirdY = (2 * H) / 3;

  // Build the pre-margin zone, then inset the edges that touch a screen edge.
  // `edges` marks which sides hug a hard viewport edge (and so get the margin).
  let r: Rect;
  let insetLeft = false;
  let insetRight = false;
  let insetTop = false;
  let insetBottom = false;

  switch (anchor.region) {
    case 'top-left':
      r = { x: left0, y: top0, width: halfX, height: thirdY };
      insetLeft = insetTop = true;
      break;
    case 'top-center':
      r = { x: thirdX, y: top0, width: twoThirdX - thirdX, height: thirdY };
      // Interior region: inset all four so it never hugs the top edge either.
      insetLeft = insetRight = insetTop = insetBottom = true;
      break;
    case 'top-right':
      r = { x: halfX, y: top0, width: W - halfX, height: thirdY };
      insetRight = insetTop = true;
      break;
    case 'bottom-left':
      r = { x: left0, y: twoThirdY, width: halfX, height: H - twoThirdY };
      insetLeft = insetBottom = true;
      break;
    case 'bottom-center':
      r = { x: thirdX, y: twoThirdY, width: twoThirdX - thirdX, height: H - twoThirdY };
      insetLeft = insetRight = insetBottom = true;
      break;
    case 'bottom-right':
      r = { x: halfX, y: twoThirdY, width: W - halfX, height: H - twoThirdY };
      insetRight = insetBottom = true;
      break;
    case 'bottom-strip':
      r = { x: left0, y: H - strip, width: W, height: strip };
      insetLeft = insetRight = insetBottom = true;
      break;
    case 'left-half-bottom':
      r = { x: left0, y: H / 2, width: halfX, height: H / 2 };
      insetLeft = insetBottom = true;
      break;
    case 'right-half-bottom':
      r = { x: halfX, y: H / 2, width: W - halfX, height: H / 2 };
      insetRight = insetBottom = true;
      break;
    case 'center':
      r = { x: thirdX, y: thirdY, width: twoThirdX - thirdX, height: twoThirdY - thirdY };
      insetLeft = insetRight = insetTop = insetBottom = true;
      break;
    case 'full':
      r = { x: left0, y: top0, width: W, height: H };
      insetLeft = insetRight = insetTop = insetBottom = true;
      break;
  }

  if (m > 0) {
    if (insetLeft) {
      r.x += m;
      r.width -= m;
    }
    if (insetRight) r.width -= m;
    if (insetTop) {
      r.y += m;
      r.height -= m;
    }
    if (insetBottom) r.height -= m;
  }
  // Never hand back a negative extent (a tiny viewport with a big margin).
  if (r.width < 0) r.width = 0;
  if (r.height < 0) r.height = 0;
  return r;
}

/** True if `inner` sits entirely within `outer`, allowing `tolerance` px slop
 *  on every side (so sub-pixel rounding never trips a placement assertion). */
export function rectContains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Internal record: the entry plus the frame it was last (re-)registered on. */
interface Record {
  id: string;
  region: AnchorRegion;
  margin: number;
  bounds: Rect;
  seen: number;
}

/**
 * The per-frame layout registry. Elements call {@link register} once per frame
 * from wherever they render; {@link beginFrame} advances the frame counter so
 * that entries which were *not* re-registered (an element that isn't drawn this
 * frame — the FIRE button in Manual mode, an inactive onboarding prompt) drop
 * out of {@link entries}.
 *
 * Registration is allocation-light on the steady path: an id already present is
 * updated in place (its stored Rect is overwritten), so a stable set of elements
 * registering every frame allocates nothing after warm-up.
 */
export class LayoutRegistry {
  private readonly records = new Map<string, Record>();
  private frame = 0;

  /** Begin a new frame. Call once before the frame's {@link register} calls. */
  beginFrame(): void {
    this.frame++;
  }

  /**
   * Register (or refresh) an element's placement for the current frame. `bounds`
   * is copied into the registry's own storage, so the caller may reuse a scratch
   * rect across elements without aliasing what the registry holds.
   */
  register(id: string, anchor: AnchorSpec, bounds: Rect): void {
    const existing = this.records.get(id);
    if (existing) {
      existing.region = anchor.region;
      existing.margin = anchor.margin ?? 0;
      existing.bounds.x = bounds.x;
      existing.bounds.y = bounds.y;
      existing.bounds.width = bounds.width;
      existing.bounds.height = bounds.height;
      existing.seen = this.frame;
      return;
    }
    this.records.set(id, {
      id,
      region: anchor.region,
      margin: anchor.margin ?? 0,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      seen: this.frame,
    });
  }

  /** The entries registered on the current frame, as fresh plain objects. Stale
   *  entries (not re-registered this frame) are excluded. */
  entries(): LayoutEntry[] {
    const out: LayoutEntry[] = [];
    for (const rec of this.records.values()) {
      if (rec.seen === this.frame) out.push(toEntry(rec));
    }
    return out;
  }

  /** The current-frame entry for `id`, or `undefined` if absent/stale. */
  get(id: string): LayoutEntry | undefined {
    const rec = this.records.get(id);
    if (!rec || rec.seen !== this.frame) return undefined;
    return toEntry(rec);
  }

  /** Resolve an element's declared zone for a viewport (see {@link resolveAnchor}). */
  resolveAnchor(anchor: AnchorSpec, viewport: Viewport, opts?: ResolveOptions): Rect {
    return resolveAnchor(anchor, viewport, opts);
  }

  /**
   * Does the element's *actual* bounds sit inside its *declared* anchor zone for
   * this viewport? The one question the whole registry exists to answer. Returns
   * `undefined` if the id isn't registered this frame.
   */
  withinAnchor(id: string, viewport: Viewport, opts?: ResolveOptions & { tolerance?: number }): boolean | undefined {
    const rec = this.records.get(id);
    if (!rec || rec.seen !== this.frame) return undefined;
    const zone = resolveAnchor({ region: rec.region, margin: rec.margin }, viewport, opts);
    return rectContains(zone, rec.bounds, opts?.tolerance);
  }

  /** Drop everything (e.g. a hard viewport/scene reset). */
  clear(): void {
    this.records.clear();
  }
}

/**
 * The coordination seam for elements this agent does **not** render (chiefly the
 * UI Engineer's `Hud`, GDD §3.7). Rather than reach into `src/ui` internals to
 * read the ore-HUD / wave-clock / controls-strip / onboarding-prompt bounds, the
 * layout host calls this *public* method if the object implements it, and
 * registers whatever it returns. A UI element opts into the registry by
 * exposing `describeLayout(viewport)` — the registry is ready to receive HUD
 * entries the moment that lands, with no change here (see this PR's notes).
 */
export interface LayoutContributor {
  /** The element's own {@link LayoutEntry}s for the given viewport (screen px). */
  describeLayout(viewport: Viewport): LayoutEntry[];
}

/** Duck-type guard: does `x` publicly expose {@link LayoutContributor}? */
export function isLayoutContributor(x: unknown): x is LayoutContributor {
  return typeof x === 'object' && x !== null && typeof (x as { describeLayout?: unknown }).describeLayout === 'function';
}

/** Copy an internal record to a plain, standalone {@link LayoutEntry}. */
function toEntry(rec: Record): LayoutEntry {
  return {
    id: rec.id,
    anchor: { region: rec.region, margin: rec.margin },
    bounds: { x: rec.bounds.x, y: rec.bounds.y, width: rec.bounds.width, height: rec.bounds.height },
  };
}

// ---------------------------------------------------------------------------
// The read-only debug hook — window.__planetRush.layout, under ?debug=1 only
// ---------------------------------------------------------------------------

/** Dev-only flags parsed from the URL query (see {@link parseDebugFlags}). */
export interface DebugFlags {
  /** `?debug=1` — expose `window.__planetRush` and the layout registry. */
  readonly debug: boolean;
  /** `?freeze=1` (only honoured with `debug`) — pause the sim at a seeded tick. */
  readonly freeze: boolean;
}

/**
 * Parse the dev flags from a URL query string (`location.search`, with or
 * without the leading `?`). `freeze` is gated behind `debug`: `?freeze=1` alone,
 * without `?debug=1`, does nothing — the freeze instrument is part of the debug
 * surface (per brief: "?freeze=1 (with debug)").
 */
export function parseDebugFlags(search: string): DebugFlags {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const debug = params.get('debug') === '1';
  const freeze = debug && params.get('freeze') === '1';
  return { debug, freeze };
}

/** The read-only shape exposed at `window.__planetRush` under `?debug=1`. */
export interface PlanetRushDebug {
  /** The current frame's layout entries — deep-frozen copies, safe to read. */
  readonly layout: readonly LayoutEntry[];
  /** Resolve an anchor to its zone for the live viewport (the "should" rect). */
  resolveAnchor(anchor: AnchorSpec, opts?: ResolveOptions): Rect;
  /** Whether each registered element's actual bounds sit in its declared zone. */
  placement(opts?: ResolveOptions & { tolerance?: number }): Array<{ id: string; ok: boolean }>;
  /** The live viewport the registry is resolving against, CSS px. */
  readonly viewport: Viewport;
  /** True when the sim is frozen at a seeded tick for deterministic screenshots. */
  readonly frozen: boolean;
  /** The tick the sim is frozen at, or `null` when running live. */
  readonly freezeTick: number | null;
  /** A stable hash of the frozen world (deterministic across boots), or `null`. */
  readonly worldHash: string | null;
}

/** State the hook reads live each access — the host updates these fields. */
export interface LayoutHookState {
  readonly registry: LayoutRegistry;
  /** Read the live viewport at access time (so it tracks resize/orientation). */
  viewport(): Viewport;
  /** Freeze status, read live. */
  frozen(): boolean;
  freezeTick(): number | null;
  worldHash(): string | null;
  /** Resolver options (e.g. the real controls-strip height), read live. */
  resolveOptions?(): ResolveOptions;
}

/** Anything with a settable `__planetRush` property — a `Window`, or a test double. */
export interface HookTarget {
  __planetRush?: PlanetRushDebug;
}

/**
 * Install the read-only `__planetRush` debug surface on `target` (default
 * `globalThis`, i.e. `window` in the browser). Call **only** when
 * {@link DebugFlags.debug} is true — `main.ts` guards this behind `?debug=1`.
 *
 * The exposed object is frozen and its `layout` getter hands back deep-frozen
 * snapshots, so console/tool code can inspect placement but cannot mutate the
 * registry or corrupt a frame. Returns the installed surface (handy for tests).
 */
export function installLayoutHook(
  state: LayoutHookState,
  target: HookTarget = globalThis as unknown as HookTarget,
): PlanetRushDebug {
  const surface: PlanetRushDebug = Object.freeze({
    get layout(): readonly LayoutEntry[] {
      return Object.freeze(state.registry.entries().map(freezeEntry));
    },
    resolveAnchor(anchor: AnchorSpec, opts?: ResolveOptions): Rect {
      return resolveAnchor(anchor, state.viewport(), { ...state.resolveOptions?.(), ...opts });
    },
    placement(opts?: ResolveOptions & { tolerance?: number }): Array<{ id: string; ok: boolean }> {
      const vp = state.viewport();
      const merged = { ...state.resolveOptions?.(), ...opts };
      return state.registry.entries().map((e) => ({
        id: e.id,
        ok: state.registry.withinAnchor(e.id, vp, merged) ?? false,
      }));
    },
    get viewport(): Viewport {
      return Object.freeze({ ...state.viewport() });
    },
    get frozen(): boolean {
      return state.frozen();
    },
    get freezeTick(): number | null {
      return state.freezeTick();
    },
    get worldHash(): string | null {
      return state.worldHash();
    },
  });
  target.__planetRush = surface;
  return surface;
}

/** Deep-freeze a layout entry so a reader can't mutate registry-adjacent state. */
function freezeEntry(e: LayoutEntry): LayoutEntry {
  Object.freeze(e.anchor);
  Object.freeze(e.bounds);
  return Object.freeze(e);
}
