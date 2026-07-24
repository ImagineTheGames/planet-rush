/**
 * src/platform/gl-probe.ts — IS THERE A GPU TO DRAW ON? OWNER: Platform Engineer.
 *
 * The incident this exists for: the developer's Chrome GPU process wedged on a
 * machine with an RTX 4090 — no WebGL at all — and Planet Rush died to a **black
 * screen** with nothing but a cryptic renderer stack in the console
 * (`autoDetectRenderer: CanvasRenderer is not yet implemented`). A player, or the
 * developer on a phone, has no way to read that. There is nothing wrong with the
 * hardware and nothing wrong with the build; the browser simply cannot hand out a
 * GL context, and the only honest thing to do is *say so*.
 *
 * So: probe **before** Pixi is initialised, cheaply, and let `main.ts` route a
 * failure to the friendly DOM screen in `boot-error.ts` instead of into Pixi's
 * internals. The probe is deliberately dumb — one throwaway canvas, one
 * `getContext` walk, no Pixi import — so it cannot itself be the thing that
 * breaks, and it works identically on desktop and on a phone.
 *
 * Everything here is a pure function of an injected canvas factory, so the whole
 * decision table (context missing, `getContext` returning null, `getContext`
 * throwing, no `document` at all) unit-tests headless with no browser and no
 * jsdom.
 */

/** Which flavour of WebGL the browser handed us. Pixi wants WebGL2 and falls
 *  back to WebGL1; either one means the game can draw. */
export type GlApi = 'webgl2' | 'webgl';

/**
 * Why the probe failed — the machine-readable half of the diagnosis.
 *
 *  - `no-canvas`  — no `document` (node/SSR) or `createElement` gave us nothing.
 *  - `no-context` — a canvas exists but every context id returned `null`. This is
 *                   the wedged-GPU / `--disable-webgl` case, i.e. the incident.
 *  - `threw`      — `createElement`/`getContext` threw outright (some hardened
 *                   or privacy-hardened builds do this instead of returning null).
 */
export type GlFailure = 'no-canvas' | 'no-context' | 'threw';

/** WebGL is available; `api` is the best flavour on offer. */
export interface GlProbeOk {
  readonly ok: true;
  readonly api: GlApi;
}

/** WebGL is not available, with enough detail to print in a bug report. */
export interface GlProbeFail {
  readonly ok: false;
  readonly failure: GlFailure;
  /** Human-readable specifics — the per-context-id outcomes, or the thrown
   *  message. Shown verbatim on the error screen: cryptic beats absent, as long
   *  as it is *underneath* a plain-words explanation. */
  readonly detail: string;
}

export type GlProbeResult = GlProbeOk | GlProbeFail;

/**
 * Context ids to try, best first. `experimental-webgl` is the ancient alias that
 * a handful of old mobile browsers still answer to; asking costs one call and
 * the phone is a first-class target (GDD §4.3b risk 7).
 */
export const GL_CONTEXT_IDS = ['webgl2', 'webgl', 'experimental-webgl'] as const;

export type GlContextId = (typeof GL_CONTEXT_IDS)[number];

/** Which {@link GlApi} a context id represents. */
export function apiForContextId(id: GlContextId): GlApi {
  return id === 'webgl2' ? 'webgl2' : 'webgl';
}

/**
 * Attributes for the probe context. Two deliberate choices:
 *
 *  - **`failIfMajorPerformanceCaveat: false`** — software rendering (SwiftShader,
 *    llvmpipe) still draws Planet Rush, just slower, and the "reduce VFX" escape
 *    hatch exists for exactly that (GDD §4.3b risk 5). A slow game is playable;
 *    a black screen is not. The probe answers "can we draw at all", never "is it
 *    fast" — the performance gate is a different question, asked elsewhere.
 *  - **no depth/stencil/alpha** — this context is thrown away immediately, so ask
 *    for the cheapest one the driver can make.
 */
export const PROBE_CONTEXT_ATTRIBUTES = {
  alpha: false,
  depth: false,
  stencil: false,
  antialias: false,
  failIfMajorPerformanceCaveat: false,
} as const;

/** The slice of `HTMLCanvasElement` the probe touches — small enough that a test
 *  can fake it in three lines (structurally satisfied by the real element). */
export interface CanvasLike {
  getContext(id: string, attributes?: unknown): unknown;
}

/** Injectable deps (defaulted in production use). */
export interface GlProbeOptions {
  /** Makes the throwaway canvas. Defaults to `document.createElement('canvas')`,
   *  or `null` where there is no `document` at all. */
  readonly createCanvas?: () => CanvasLike | null;
}

/**
 * Ask the browser for a WebGL context on a throwaway canvas.
 *
 * Cheap by construction: one detached canvas that is never inserted into the
 * document, one context that is released again the moment it answers (see
 * {@link releaseProbeContext} — Safari's WebGL memory limits are tight and
 * contexts are a scarce resource on mobile, GDD §4.3b risk 7). Never throws:
 * every failure path returns a {@link GlProbeFail}, because a probe that can
 * itself crash boot would be worse than no probe.
 */
export function probeWebGl(opts: GlProbeOptions = {}): GlProbeResult {
  const createCanvas = opts.createCanvas ?? defaultCanvasFactory;

  let canvas: CanvasLike | null;
  try {
    canvas = createCanvas();
  } catch (e) {
    return { ok: false, failure: 'threw', detail: `createElement('canvas') threw: ${thrownText(e)}` };
  }
  if (!canvas) {
    return { ok: false, failure: 'no-canvas', detail: 'no <canvas> element (no document in this environment)' };
  }

  // Walk the ids best-first, recording *why* each one said no. The transcript is
  // what turns "it didn't work" into a filable report.
  const attempts: string[] = [];
  let threw = false;
  for (const id of GL_CONTEXT_IDS) {
    try {
      const ctx = canvas.getContext(id, PROBE_CONTEXT_ATTRIBUTES);
      if (ctx) {
        releaseProbeContext(ctx);
        return { ok: true, api: apiForContextId(id) };
      }
      attempts.push(`${id}: null`);
    } catch (e) {
      threw = true;
      attempts.push(`${id}: threw ${thrownText(e)}`);
    }
  }

  return {
    ok: false,
    // A browser that threw on every id is a different (rarer) beast from one that
    // politely returned null, and the distinction survives into the bug report.
    failure: threw ? 'threw' : 'no-context',
    detail: attempts.join('; '),
  };
}

/**
 * Hand the probe context straight back to the driver via `WEBGL_lose_context`.
 * Best-effort: the extension is optional, and a browser that will not release it
 * is not a reason to fail boot — GC gets it eventually.
 */
export function releaseProbeContext(ctx: unknown): void {
  try {
    const gl = ctx as { getExtension?: (name: string) => unknown };
    const ext = gl.getExtension?.('WEBGL_lose_context') as { loseContext?: () => void } | null | undefined;
    ext?.loseContext?.();
  } catch {
    /* Releasing a throwaway context is hygiene, never a boot requirement. */
  }
}

/**
 * The error thrown when the probe says no. Carries the {@link GlProbeFail} so the
 * error screen can print the transcript, and is a plain `Error` so it travels
 * through the one `catch` in `main.ts` like any other boot failure.
 */
export class WebGlUnavailableError extends Error {
  readonly probe: GlProbeFail;

  constructor(probe: GlProbeFail) {
    super(`WebGL unavailable (${probe.failure}) — ${probe.detail}`);
    this.name = WEBGL_UNAVAILABLE_ERROR_NAME;
    this.probe = probe;
  }
}

/** `Error.name` of {@link WebGlUnavailableError}. Compared by value as well as by
 *  `instanceof` so the check survives bundling (two module copies, one class
 *  identity each — a real hazard once a service worker is caching chunks). */
export const WEBGL_UNAVAILABLE_ERROR_NAME = 'WebGlUnavailableError';

/** True when `err` is the no-WebGL failure rather than a generic boot error. */
export function isWebGlUnavailable(err: unknown): err is WebGlUnavailableError {
  if (err instanceof WebGlUnavailableError) return true;
  return err instanceof Error && err.name === WEBGL_UNAVAILABLE_ERROR_NAME;
}

/**
 * Probe, and throw {@link WebGlUnavailableError} if there is no WebGL — the form
 * `boot()` uses, so "no GPU" arrives at the error screen through the same single
 * `catch` as every other init failure. One presentation path, no second code path
 * to forget about.
 */
export function requireWebGl(opts: GlProbeOptions = {}): GlProbeOk {
  const result = probeWebGl(opts);
  if (!result.ok) throw new WebGlUnavailableError(result);
  return result;
}

/** `document.createElement('canvas')`, or `null` where there is no document
 *  (node, the QA harness, the match server — none of which draw). */
function defaultCanvasFactory(): CanvasLike | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

/** Best available text for something thrown at us (which need not be an Error). */
function thrownText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}
