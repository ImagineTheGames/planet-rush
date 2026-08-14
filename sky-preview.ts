/**
 * sky-preview.ts — **the review surface that made a0-40 visible.** OWNER: Art Agent.
 *
 * Dev-server only (`sky-preview.html`; it is not imported by `src/main.ts` and is
 * not in the shipped bundle). It stays in the repo, deliberately, because it is
 * the thing that was missing for six reports: **a place where the design and the
 * game are next to each other, at the same size, measured the same way.**
 *
 * ## What it puts on screen
 *
 * Three full backdrops, side by side, each from its **real** source — that is the
 * whole trick, and it is why this settled an argument five briefs could not:
 *
 *  1. **mockup** — the design's own numbers ({@link MOCKUP_REFERENCE}), painted
 *     with canvas radial gradients by {@link paintMockupPanel}. It shares no code
 *     with the game's drawing path at all, so it is a genuine second opinion and
 *     not the game agreeing with itself.
 *  2. **game today** — the actual {@link VoidBackdrop}, through its real
 *     `configure`/`update` API, on the real Pixi path, with its own ramp texture
 *     and its own blend modes. Nothing is re-implemented; if the game is wrong,
 *     this panel is wrong in exactly the same way.
 *  3. **ported** — the design's numbers emitted as the game's own `Shape`s and
 *     painted by the game's own `drawSprite`. The control that separates *"the
 *     renderer is broken"* from *"the numbers are wrong"*.
 *
 * Before a0-40, columns 1 and 3 agreed and column 2 was five times darker than
 * both. That is the entire finding: **the renderer was always fine.**
 *
 * ## The instrument
 *
 * {@link measure} is the number in the brief. A **320×180 point-sample grid**
 * over the panel; `lift` is the mean luma **above that panel's own ground**, so
 * the two grounds cannot confound a comparison between them; `p99` is the 99th
 * percentile of the same samples, which is the honest measure of a star field
 * (a peak is one pixel and a mean is mostly ground — the percentile is what
 * "are there stars in it" actually asks).
 *
 * Point-sampled rather than box-averaged on purpose: it is what the design's own
 * measurement did, and box-averaging a 0.4 px star into a 2 px cell answers a
 * question about downsampling rather than about the art.
 *
 * ## Running it
 *
 * ```sh
 * npm run dev            # then open /sky-preview.html
 * ```
 *
 * The measured table prints under the panels and to the console. `backdrop.test.ts`
 * holds the same numbers in CI, so this page is for eyes and the test is the gate
 * — neither substitutes for the other.
 */

import { Application, Container, Graphics } from 'pixi.js';
import {
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  VOID_SEED,
  VoidBackdrop,
  groundSprite,
  nebulaSprite,
  starFieldSprite,
  STAR_LAYERS,
  type NebulaId,
} from './src/art/backdrop';
import {
  MOCKUP_GROUND,
  MOCKUP_PANEL,
  MOCKUP_REFERENCE,
  MOCKUP_SKY_IDS,
  MOCKUP_STARS,
  mockupBlobs,
  starAlpha,
  starBlooms,
  starHaloAlpha,
  starColorFor,
  starMagnitude,
  starRadius,
  starTemperature,
  type MockupSkyId,
} from './src/art/mockup-reference';
import { falloffProfile, haloProfile, inkAlphaAt, type Shape } from './src/art/shapes';
import { drawSprite } from './src/art/textures';
import { hex } from './src/art/palette';
import { mulberry32 } from './src/shared/types';

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/** The design's own sample grid. Not the panel's resolution — its sample count. */
export const SAMPLE = { cols: 320, rows: 180 } as const;

/** What one panel measures to. Every number is luma Y′ on 0..255. */
export interface PanelMeasurement {
  /** The panel's own ground, so `lift` is comparable across different grounds. */
  readonly ground: number;
  readonly mean: number;
  /** `mean − ground`. **The number the brief is about.** */
  readonly lift: number;
  /** 99th percentile of the samples — the star field's honest peak. */
  readonly p99: number;
  /** The single brightest sample. */
  readonly peak: number;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function unpack(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** The luma of a packed colour — the ground row of every table below. */
export function colorLuma(color: number): number {
  const [r, g, b] = unpack(color);
  return luma(r, g, b);
}

/** Reduce a grid of luma samples to the table's four numbers. */
export function measure(samples: readonly number[] | Float64Array, ground: number): PanelMeasurement {
  const n = samples.length;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    sum += samples[i]!;
    if (samples[i]! > peak) peak = samples[i]!;
  }
  const sorted = Float64Array.from(samples).sort();
  const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))]!;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const mean = sum / n;
  return { ground: r2(ground), mean: r2(mean), lift: r2(mean - ground), p99: r2(p99), peak: r2(peak) };
}

// ---------------------------------------------------------------------------
// Panel 1 — the design, from its own numbers, on its own code path
// ---------------------------------------------------------------------------

/**
 * The design's blobs and stars composited on the CPU, with no `Shape`, no
 * `inkAlphaAt` and no Pixi anywhere in it — the arithmetic written out longhand
 * so that agreement with the game means something.
 */
export function sampleMockup(
  id: MockupSkyId | 'none',
  seed: number,
  width: number,
  height: number,
  opts: { stars?: boolean } = {},
): Float64Array {
  const sky = id === 'none' ? null : MOCKUP_REFERENCE[id];
  const blobs = sky ? mockupBlobs(sky, seed, width, height, 1, width, height) : [];
  const stars = opts.stars === false ? [] : mockupStarPoints(seed, width, height);
  const [gr, gg, gb] = unpack(MOCKUP_GROUND);
  const out = new Float64Array(SAMPLE.cols * SAMPLE.rows);

  for (let row = 0; row < SAMPLE.rows; row++) {
    const y = ((row + 0.5) / SAMPLE.rows - 0.5) * height;
    for (let col = 0; col < SAMPLE.cols; col++) {
      const x = ((col + 0.5) / SAMPLE.cols - 0.5) * width;
      let r = gr;
      let g = gg;
      let b = gb;
      // Light sits behind the stars; dust sits in front of them and takes them
      // out of the frame. That ordering IS Coalsack's look.
      const paintSky = (): void => {
        if (!sky) return;
        for (const blob of blobs) {
          const dx = x - blob.cx;
          const dy = y - blob.cy;
          const c = Math.cos(blob.angle);
          const s = Math.sin(blob.angle);
          const ex = (dx * c + dy * s) / blob.rx;
          const ey = (-dx * s + dy * c) / blob.ry;
          const t = Math.hypot(ex, ey);
          if (t >= 1) continue;
          const a = blob.alpha * (1 - t * t) * (1 - t * t);
          const [br, bg, bb] = unpack(blob.color);
          if (sky.additive) {
            r = Math.min(255, r + br * a);
            g = Math.min(255, g + bg * a);
            b = Math.min(255, b + bb * a);
          } else {
            r = r * (1 - a) + br * a;
            g = g * (1 - a) + bg * a;
            b = b * (1 - a) + bb * a;
          }
        }
      };
      const paintStars = (): void => {
        for (const st of stars) {
          const d = Math.hypot(x - st.x, y - st.y);
          let a = 0;
          if (d <= st.r) a = st.alpha;
          else if (st.halo > 0 && d <= st.halo) {
            // The design's halo: an ABSOLUTE peak (the same on every bloomed
            // star) on the design's own three-stop curve (a0-44).
            a = starHaloAlpha() * haloProfile(d / st.halo);
          }
          if (a <= 0) continue;
          const [sr, sg, sb] = unpack(st.color);
          r = r * (1 - a) + sr * a;
          g = g * (1 - a) + sg * a;
          b = b * (1 - a) + sb * a;
        }
      };
      if (sky?.dust) {
        paintStars();
        paintSky();
      } else {
        paintSky();
        paintStars();
      }
      out[row * SAMPLE.cols + col] = luma(r, g, b);
    }
  }
  return out;
}

interface MockupStar {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly alpha: number;
  /** Halo radius, or 0 for a star that does not bloom. */
  readonly halo: number;
  readonly mag: number;
  /** The star's own temperature — {@link MOCKUP_STARS}`.temperature` (a0-45). */
  readonly temp: number;
  /** The star's colour, from that temperature and from nothing else. It paints
   *  the point, the halo gradient and the cross, exactly as the design does. */
  readonly color: number;
}

/** The design's star field over one panel — {@link MOCKUP_STARS}, longhand. */
export function mockupStarPoints(seed: number, width: number, height: number): MockupStar[] {
  const rng = mulberry32((seed ^ 0x57a25) >>> 0);
  const count = Math.max(
    1,
    Math.round((MOCKUP_STARS.count * width * height) / (MOCKUP_PANEL.w * MOCKUP_PANEL.h)),
  );
  const out: MockupStar[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * width;
    const y = (rng.next() - 0.5) * height;
    const mag = starMagnitude(rng.next());
    // Two independent properties, drawn in the design's own order: magnitude
    // decides how bright and how big, temperature decides what colour (a0-45).
    const temp = starTemperature(rng);
    const r = starRadius(mag);
    out.push({
      x,
      y,
      r,
      alpha: starAlpha(mag),
      halo: starBlooms(mag) ? r * MOCKUP_STARS.bloom.radius : 0,
      mag,
      temp,
      color: starColorFor(temp),
    });
  }
  return out;
}

/** Paint the design panel into a 2D canvas, with radial gradients — for eyes. */
export function paintMockupPanel(
  ctx: CanvasRenderingContext2D,
  id: MockupSkyId | 'none',
  seed: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = hex(MOCKUP_GROUND);
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  const sky = id === 'none' ? null : MOCKUP_REFERENCE[id];

  const paintSky = (): void => {
    if (!sky) return;
    ctx.save();
    ctx.globalCompositeOperation = sky.additive ? 'lighter' : 'source-over';
    for (const blob of mockupBlobs(sky, seed, width, height, 1, width, height)) {
      ctx.save();
      ctx.translate(blob.cx, blob.cy);
      ctx.rotate(blob.angle);
      ctx.scale(1, blob.ry / blob.rx);
      // `(1 − t²)²` as five gradient stops: the curve's own values, so the page
      // and the measurement cannot drift apart by more than the interpolation.
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, blob.rx);
      const c = hex(blob.color);
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        grad.addColorStop(t, withAlpha(c, blob.alpha * falloffProfile(t)));
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, blob.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  const paintStars = (): void => {
    for (const st of mockupStarPoints(seed, width, height)) {
      if (st.halo > 0) {
        // **The design's own three stops, written the way the design writes
        // them** — `0 → 0.42·inten`, `0.35 → 0.13·inten`, `1 → 0` — rather than
        // a curve sampled five times. Canvas interpolates stops linearly, so
        // this panel now paints the design's glow exactly and not a fit of it.
        const grad = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.halo);
        const knee = MOCKUP_STARS.bloom.knee;
        grad.addColorStop(0, withAlpha(hex(st.color), starHaloAlpha()));
        grad.addColorStop(knee.at, withAlpha(hex(st.color), knee.alpha));
        grad.addColorStop(1, withAlpha(hex(st.color), 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.halo, 0, Math.PI * 2);
        ctx.fill();
        // The diffraction cross — the same population as the halo.
        const len = st.r * MOCKUP_STARS.spike.length;
        ctx.strokeStyle = withAlpha(hex(st.color), st.alpha * MOCKUP_STARS.spike.intensity);
        ctx.lineWidth = MOCKUP_STARS.spike.width;
        ctx.beginPath();
        ctx.moveTo(st.x - len, st.y);
        ctx.lineTo(st.x + len, st.y);
        ctx.moveTo(st.x, st.y - len);
        ctx.lineTo(st.x, st.y + len);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha(hex(st.color), st.alpha);
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  if (sky?.dust) {
    paintStars();
    paintSky();
  } else {
    paintSky();
    paintStars();
  }
  ctx.restore();
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `${color}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Panel 3 — the game's own Shape pipeline, given the design's numbers
// ---------------------------------------------------------------------------

/**
 * The game's `Shape` stack for one panel, in composite order, sampled on the same
 * grid — so panel 3's number and panel 1's number are the same question asked of
 * two independent implementations.
 */
export function sampleShapes(
  shapes: readonly Shape[],
  additive: boolean,
  ground: number,
  width: number,
  height: number,
): Float64Array {
  const [gr, gg, gb] = unpack(ground);
  const out = new Float64Array(SAMPLE.cols * SAMPLE.rows);
  for (let row = 0; row < SAMPLE.rows; row++) {
    const y = ((row + 0.5) / SAMPLE.rows - 0.5) * height;
    for (let col = 0; col < SAMPLE.cols; col++) {
      const x = ((col + 0.5) / SAMPLE.cols - 0.5) * width;
      let r = gr;
      let g = gg;
      let b = gb;
      for (const s of shapes) {
        if (!s.fill || !coversPoint(s, x, y)) continue;
        const a = inkAlphaAt(s.fill, x, y);
        if (a <= 0) continue;
        const [sr, sg, sb] = unpack(s.fill.color);
        if (additive) {
          r = Math.min(255, r + sr * a);
          g = Math.min(255, g + sg * a);
          b = Math.min(255, b + sb * a);
        } else {
          r = r * (1 - a) + sr * a;
          g = g * (1 - a) + sg * a;
          b = b * (1 - a) + sb * a;
        }
      }
      out[row * SAMPLE.cols + col] = luma(r, g, b);
    }
  }
  return out;
}

/** Point-in-shape for the sampler. Fills only — a backdrop is fills. */
function coversPoint(shape: Shape, x: number, y: number): boolean {
  if (shape.path.kind === 'circle') {
    const dx = x - shape.path.cx;
    const dy = y - shape.path.cy;
    return dx * dx + dy * dy <= shape.path.r * shape.path.r;
  }
  if (!shape.path.closed) return false;
  const p = shape.path.points;
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!;
    const yi = p[i + 1]!;
    const xj = p[j]!;
    const yj = p[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The game's own sky shapes for one panel, at the ported numbers. */
export function gameSkyShapes(id: NebulaId, seed: number, width: number, height: number): Shape[] {
  return [...nebulaSprite(id, seed, width, height, 1, width, height).shapes];
}

/** The game's own star shapes for one panel, all three parallax layers. */
export function gameStarShapes(seed: number, width: number, height: number): Shape[] {
  return STAR_LAYERS.flatMap((spec) => [...starFieldSprite(spec, seed, width, height).shapes]);
}

/** The whole game stack for one panel, in composite order. */
export function gamePanelShapes(id: NebulaId, seed: number, width: number, height: number): Shape[] {
  const sky = gameSkyShapes(id, seed, width, height);
  const stars = gameStarShapes(seed, width, height);
  return NEBULAE[id].occludes ? [...stars, ...sky] : [...sky, ...stars];
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One row of the comparison the brief is built on. */
export interface PreviewRow {
  readonly sky: string;
  readonly mockup: PanelMeasurement;
  readonly ported: PanelMeasurement;
  /** The design's own declared lift, for the two columns to be read against. */
  readonly designLift: number;
}

/**
 * The measured comparison, headless — the same table the page prints, available
 * to a test and to a terminal. Nebula only: the stars are measured separately
 * (their number is a percentile, not a mean), so a sky's `lift` is the sky's.
 */
export function previewTable(seed = VOID_SEED): PreviewRow[] {
  const { w, h } = MOCKUP_PANEL;
  const ground = colorLuma(MOCKUP_GROUND);
  return MOCKUP_SKY_IDS.map((id) => {
    const mockup = measure(sampleMockup(id, seed, w, h, { stars: false }), ground);
    const ported = measure(
      sampleShapes(gameSkyShapes(id, seed, w, h), NEBULAE[id].additive, MOCKUP_GROUND, w, h),
      ground,
    );
    return { sky: NEBULAE[id].name, mockup, ported, designLift: MOCKUP_REFERENCE[id].lift };
  });
}

/** The star field's own row: the percentile the design states, both ways. */
export function starTable(seed = VOID_SEED): {
  mockup: PanelMeasurement;
  ported: PanelMeasurement;
} {
  const { w, h } = MOCKUP_PANEL;
  const ground = colorLuma(MOCKUP_GROUND);
  return {
    mockup: measure(sampleMockup('none', seed, w, h), ground),
    ported: measure(sampleShapes(gameStarShapes(seed, w, h), false, MOCKUP_GROUND, w, h), ground),
  };
}

/** The table as fixed-width text — what the page prints and the console shows. */
export function formatTable(seed = VOID_SEED): string {
  const rows = previewTable(seed);
  const stars = starTable(seed);
  const head = `${'sky'.padEnd(14)}${'design'.padStart(8)}${'mockup'.padStart(9)}${'ported'.padStart(9)}`;
  const body = rows.map(
    (r) =>
      `${r.sky.padEnd(14)}${r.designLift.toFixed(2).padStart(8)}` +
      `${r.mockup.lift.toFixed(2).padStart(9)}${r.ported.lift.toFixed(2).padStart(9)}`,
  );
  const starRow =
    `${'stars p99'.padEnd(14)}${`${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}`.padStart(8)}` +
    `${stars.mockup.p99.toFixed(1).padStart(9)}${stars.ported.p99.toFixed(1).padStart(9)}`;
  return [
    `ground  ${hex(MOCKUP_GROUND)}  Y′ ${colorLuma(MOCKUP_GROUND).toFixed(2)}`,
    '',
    head,
    ...body,
    '',
    starRow,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const PANEL_LABELS = ['mockup', 'game today', 'ported'] as const;

/**
 * Mount the three-column review surface. Called by `sky-preview.html`; safe to
 * call once per page.
 */
export async function mountSkyPreview(root: HTMLElement): Promise<void> {
  const { w, h } = MOCKUP_PANEL;
  const seed = VOID_SEED;
  const skyOf = new Map<NebulaId, string>();
  for (const [map, id] of Object.entries(MAP_NEBULA)) skyOf.set(id as NebulaId, map);

  const pre = document.createElement('pre');
  pre.className = 'table';
  pre.textContent = formatTable(seed);
  root.appendChild(pre);
  // eslint-disable-next-line no-console
  console.log(`\n${formatTable(seed)}\n`);

  // **One WebGL context for the whole page.** Twelve `Application`s — two Pixi
  // panels per sky — is over Chrome's per-page context limit on some machines
  // and right at it on the rest, and a review surface that silently drops half
  // its panels is worse than no review surface. So the two Pixi columns render
  // through a single off-screen app and get blitted into plain 2D canvases.
  const app = new Application();
  await app.init({ width: w, height: h, background: 0x000000, antialias: true });

  /** Render `build`'s container through the shared app and blit it into `host`. */
  const blit = (host: HTMLElement, stage: Container): void => {
    app.stage.removeChildren();
    app.stage.addChild(stage);
    app.render();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(app.canvas, 0, 0);
    host.appendChild(canvas);
    app.stage.removeChildren();
  };

  for (const id of NEBULA_IDS) {
    const spec = NEBULAE[id];
    const row = document.createElement('section');
    row.className = 'row';
    const title = document.createElement('h2');
    title.textContent = `${spec.name} — ${skyOf.get(id) ?? 'unassigned'}`;
    row.appendChild(title);

    const strip = document.createElement('div');
    strip.className = 'strip';
    row.appendChild(strip);
    root.appendChild(row);

    for (const label of PANEL_LABELS) {
      const cell = document.createElement('figure');
      cell.className = 'cell';
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      const host = document.createElement('div');
      host.className = 'panel';
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      cell.append(host, cap);
      strip.appendChild(cell);

      if (label === 'mockup') {
        // The design, on canvas gradients — no game code anywhere in it.
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        host.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (ctx) paintMockupPanel(ctx, id === 'none' ? 'none' : (id as MockupSkyId), seed, w, h);
      } else if (label === 'game today') {
        // The real class, through its real API — nothing re-implemented.
        const backdrop = new VoidBackdrop(seed);
        backdrop.setMap(skyOf.get(id));
        backdrop.configure(w, h, w, h);
        backdrop.update(0, 0, w, h);
        blit(host, backdrop.view);
      } else {
        // The design's numbers as the game's own Shapes, through drawSprite.
        const stage = new Container();
        const groundGfx = new Graphics();
        drawSprite(groundGfx, groundSprite(w, h), 1);
        groundGfx.position.set(w / 2, h / 2);
        const skyGfx = new Graphics();
        drawSprite(skyGfx, nebulaSprite(id, seed, w, h, 1, w, h), 1);
        if (spec.additive) skyGfx.blendMode = 'add';
        skyGfx.position.set(w / 2, h / 2);
        const starGfx = new Graphics();
        for (const layer of STAR_LAYERS) drawSprite(starGfx, starFieldSprite(layer, seed, w, h), 1);
        starGfx.position.set(w / 2, h / 2);
        stage.addChild(groundGfx);
        if (spec.occludes) stage.addChild(starGfx, skyGfx);
        else stage.addChild(skyGfx, starGfx);
        blit(host, stage);
      }
    }
  }
}
