/**
 * tests/mobile/layout.spec.ts — LAYOUT-CONTRACT suite. OWNER: QA Agent.
 *
 * The executable form of the standing directive "if something is supposed to
 * appear somewhere, it appears there" (see src/platform/layout-registry.ts).
 * Where emulation.spec.ts proves affordances are *drawn* (pixels), this suite
 * proves they are drawn *in the right place*: for EVERY element the app
 * registers this frame at `window.__planetRush.layout` (exposed under `?debug=1`),
 * it asserts the element's actual rendered `bounds` sit inside its declared
 * `anchor` region — mechanically, on every device profile, in both orientations
 * where the element applies. Drift (a HUD corner that slid, a stick pinned to
 * the wrong half) fails here instead of being eyeballed in a screenshot.
 *
 * Two failure modes, both named in the brief and both caught here:
 *   1. registered but OUT OF REGION  → the element's bounds escape its anchor
 *      zone. Fails naming id + expected region + actual bounds + resolved zone.
 *   2. declared-for-profile but MISSING → an element we expect on this profile
 *      never registered. Fails naming the id + its expected region.
 * Plus a guard that touch-only affordances never leak onto the desktop control.
 *
 * The check reads the registry's OWN verdict (`__planetRush.placement()`, i.e.
 * `LayoutRegistry.withinAnchor`) and its OWN resolver (`resolveAnchor`), so the
 * test asserts the exact same "should" geometry the registry publishes — it does
 * not re-implement the anchor vocabulary. `?freeze=1` pins the seeded sim so the
 * layout is deterministic across boots (freeze.ts).
 *
 * WHAT THE REGISTRY EXPOSES TODAY (M1): the local ship and the touch controls
 * register precise self-computed bounds. The HUD-owned elements (ore HUD, banked
 * total, wave clock, controls strip, onboarding prompt) join the moment the UI
 * lands its public `Hud.describeLayout()` seam — see the PR notes and the PENDING
 * block below. They are intentionally NOT asserted here yet: this suite guards
 * what the registry can actually see, and lights the rest up with no change here.
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';

// --- Profiles --------------------------------------------------------------

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

/** An element we require the app to register on a given profile, and where. */
interface Declared {
  readonly id: string;
  readonly region: string;
}

/**
 * The declared registry contract, per profile kind. An id here that fails to
 * register on its profile is a MISSING failure; anything that DOES register is
 * additionally checked for region containment (so unlisted elements are still
 * placement-checked, they just aren't required to exist).
 *
 * Touch defaults to Auto-aim (GDD §2.4): the right half is the hold-to-FIRE
 * button, so `touch-fire-button` is the declared right-half affordance and
 * `touch-aim-stick` (its Manual-mode alternative) is absent by default.
 */
const DECLARED_TOUCH: readonly Declared[] = [
  { id: 'ship-local', region: 'center' },
  { id: 'touch-left-stick', region: 'left-half-bottom' },
  { id: 'touch-fire-button', region: 'right-half-bottom' },
];

const DECLARED_DESKTOP: readonly Declared[] = [
  // The camera keeps the local ship centred (GDD §2.2). The desktop controls
  // strip is a HUD-owned element and is NOT yet in the registry (PENDING below).
  { id: 'ship-local', region: 'center' },
];

// PENDING — HUD-owned elements the registry will expose once the UI Engineer
// lands `Hud.describeLayout()` (LayoutContributor seam, layout-registry.ts). They
// are documented, not asserted, so this suite stays green and honest about what
// the registry can currently see. Add them to the DECLARED tables above when the
// seam lands — no other change is needed here.
//   desktop-only : { id: 'controls-strip', region: 'bottom-strip' }
//   all profiles : { id: 'ore-hud',      region: 'top-left'   }
//                  { id: 'banked-total', region: 'top-left'   }
//                  { id: 'wave-clock',   region: 'top-center' }
//                  { id: 'onboarding',   region: 'center'     }

// --- Registry probe --------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProbeEntry {
  id: string;
  region: string;
  margin: number;
  bounds: Rect;
  /** The resolved "should" zone for this entry's anchor (registry's resolver). */
  zone: Rect;
  /** The registry's own verdict: does `bounds` sit inside `zone`? */
  within: boolean;
}

interface Probe {
  present: boolean;
  viewport: { width: number; height: number };
  frozen: boolean;
  entries: ProbeEntry[];
}

/**
 * Boot the real preview build with the debug registry + deterministic freeze,
 * wait until at least one element has registered, then read the whole current
 * frame's placement out of `window.__planetRush` in one shot. Everything the
 * assertions need — bounds, resolved zone, and the registry's own within-anchor
 * verdict — is computed browser-side against the live viewport.
 */
async function probeLayout(page: Page): Promise<Probe> {
  await page.goto('/?debug=1&freeze=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // The registry refreshes every rendered frame; wait for the hook and a
  // populated frame rather than guessing a fixed delay.
  await page.waitForFunction(
    () => {
      const pr = (window as unknown as { __planetRush?: { layout?: unknown[] } }).__planetRush;
      return !!pr && Array.isArray(pr.layout) && pr.layout.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );

  return page.evaluate((): Probe => {
    interface Anchor {
      region: string;
      margin?: number;
    }
    interface Entry {
      id: string;
      anchor: Anchor;
      bounds: Rect;
    }
    interface PlanetRush {
      layout: Entry[];
      viewport: { width: number; height: number };
      frozen: boolean;
      resolveAnchor(a: Anchor): Rect;
      placement(): Array<{ id: string; ok: boolean }>;
    }
    const pr = (window as unknown as { __planetRush?: PlanetRush }).__planetRush;
    if (!pr) return { present: false, viewport: { width: 0, height: 0 }, frozen: false, entries: [] };

    const okById = new Map(pr.placement().map((p) => [p.id, p.ok]));
    const entries: ProbeEntry[] = pr.layout.map((e) => ({
      id: e.id,
      region: e.anchor.region,
      margin: e.anchor.margin ?? 0,
      bounds: e.bounds,
      zone: pr.resolveAnchor(e.anchor),
      within: okById.get(e.id) ?? false,
    }));
    return { present: true, viewport: pr.viewport, frozen: pr.frozen, entries };
  });
}

/** Swap the viewport's width/height — turns a portrait phone to landscape. */
async function rotate(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp) await page.setViewportSize({ width: vp.height, height: vp.width });
}

const fmtRect = (r: Rect): string =>
  `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;

/**
 * Run the full layout contract for the current viewport orientation. Returns the
 * list of human-readable violations (empty = pass). One aggregated assertion in
 * the caller reports them all at once, each naming id + region + bounds.
 */
function contractViolations(probe: Probe, declared: readonly Declared[], label: string): string[] {
  const problems: string[] = [];

  if (!probe.present) {
    problems.push(`[${label}] window.__planetRush absent — is the build served with ?debug=1?`);
    return problems;
  }
  if (!probe.frozen) {
    problems.push(`[${label}] expected a frozen sim (?freeze=1) for a deterministic layout`);
  }
  if (probe.entries.length === 0) {
    problems.push(`[${label}] registry exposed zero elements this frame`);
  }

  const byId = new Map(probe.entries.map((e) => [e.id, e]));

  // (2) declared-for-profile but MISSING.
  for (const d of declared) {
    if (!byId.has(d.id)) {
      problems.push(
        `[${label}] MISSING: "${d.id}" is declared for this profile (expected region "${d.region}") ` +
          `but was not registered this frame`,
      );
    }
  }

  // (1) registered but OUT OF REGION — every element the registry exposes, not
  //     just the declared ones, so an unexpected drifted element is caught too.
  for (const e of probe.entries) {
    const declaredRegion = declared.find((d) => d.id === e.id)?.region;
    if (declaredRegion && declaredRegion !== e.region) {
      problems.push(
        `[${label}] REGION MISMATCH: "${e.id}" registered under "${e.region}" ` +
          `but the contract declares "${declaredRegion}"`,
      );
    }
    if (!e.within) {
      problems.push(
        `[${label}] OUT OF REGION: "${e.id}" (declared region "${e.region}"${
          e.margin ? `, margin ${e.margin}` : ''
        }) — actual bounds ${fmtRect(e.bounds)} escape its anchor zone ${fmtRect(e.zone)} ` +
          `for viewport ${probe.viewport.width}×${probe.viewport.height}`,
      );
    }
  }

  return problems;
}

// ===========================================================================
// Touch profiles — both orientations (touch-only affordances + the local ship)
// ===========================================================================

test('layout contract: portrait-held phone reports a landscape logical viewport, anchors hold', async ({
  page,
}, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only (portrait is the native touch orientation)');
  budgetTest({
    work: 'portrait boot of the frozen build → one registry probe → contract check over every registered element',
    measuredSeconds: 6,
  });

  // Field report v0.1.1 (ratified, Platform Engineer): the game IS landscape on
  // mobile, always. A phone held in portrait is rotated to landscape and the
  // layout registry reports the LOGICAL (landscape) viewport — so even though the
  // DEVICE booted portrait, the viewport the contract resolves against is landscape
  // (w > h), and every registered element still sits inside its anchor.
  const probe = await probeLayout(page); // touch projects boot portrait; the lock rotates them
  expect(probe.viewport.width, 'logical viewport is landscape under the lock (w > h)').toBeGreaterThan(
    probe.viewport.height,
  );

  const problems = contractViolations(probe, DECLARED_TOUCH, `${testInfo.project.name}/portrait-locked`);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('layout contract: every registered element within its anchor — landscape', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');
  budgetTest({
    work: 'rotate to landscape → boot the frozen build → one registry probe → contract check',
    measuredSeconds: 6,
  });

  await rotate(page); // portrait → landscape before boot
  const probe = await probeLayout(page);
  expect(probe.viewport.width, 'landscape viewport (w > h)').toBeGreaterThan(probe.viewport.height);

  const problems = contractViolations(probe, DECLARED_TOUCH, `${testInfo.project.name}/landscape`);
  expect(problems, problems.join('\n')).toEqual([]);
});

// ===========================================================================
// Desktop control — the strip is desktop-only; touch affordances must NOT leak
// ===========================================================================

test('layout contract: desktop elements within anchors, no touch affordances leak', async ({ page }, testInfo) => {
  test.skip(isTouchProject(testInfo.project.name), 'desktop control only');
  budgetTest({
    work: 'desktop boot of the frozen build → one registry probe → contract check + touch-affordance leak guard',
    measuredSeconds: 3,
  });

  const probe = await probeLayout(page);
  const problems = contractViolations(probe, DECLARED_DESKTOP, `${testInfo.project.name}/desktop`);

  // Touch-only affordances (ids prefixed `touch-`) must never register on the
  // desktop control — writeAffordanceRects returns null rects off-touch.
  for (const e of probe.entries) {
    if (e.id.startsWith('touch-')) {
      problems.push(`[${testInfo.project.name}/desktop] LEAK: touch affordance "${e.id}" registered on desktop`);
    }
  }

  expect(problems, problems.join('\n')).toEqual([]);
});
