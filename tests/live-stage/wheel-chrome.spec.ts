/**
 * tests/live-stage/wheel-chrome.spec.ts — the Build wheel spends NO HUE on its
 * chrome, on the REAL booted client, at all three form factors. OWNER: UI (u11-01).
 *
 * ── WHY A PIXEL TEST, AND WHY HERE ─────────────────────────────────────────
 * u11-01 is a colour brief: the wheel's STRUCTURE was ratified by u7-02 and is
 * not in question — the four-line stack, the cap counts, `OPEN ▸`, the cost
 * numeral in both of its ratified colours. What had not moved was the palette:
 * the hub's CLOSE chevron was still drawn in **plasma `#4DC3FF`**, the pre-Gantry
 * accent, which made the loudest thing inside the hub a hue that Gantry/Bone
 * spends nowhere on chrome (`src/ui/instrument.ts`, style-guide §2.1's closing
 * line: *"everything else in the Gantry/Bone direction is deliberately hueless"*).
 *
 * `src/ui/instrument.test.ts` pins which TOKEN each piece of wheel chrome takes,
 * and that is the right layer for "which constant". What a token test cannot
 * reach is the thing this project has been bitten by twice — a model green while
 * the shipped bundle drew something else. So this reads the **actual pixels the
 * real client presented**, inside the hub disc the client itself registered, after
 * a **real press on the drawn station** opened the wheel.
 *
 * ── WHY THE HUB, AND ONLY THE HUB ──────────────────────────────────────────
 * The wheel's own rule is that the world reads THROUGH it (no plates over
 * gameplay), so most of the disc is legitimately full of whatever the fight is
 * doing — a player's identity trim, a beam, ore. A "no cyan here" assertion over
 * the wedge ring would be asserting about the WORLD, not about the chrome.
 *
 * The hub is the one part of the wheel that is nearly opaque by ratified design
 * (`PALETTE.vacuum` at 0.95 — `build-wheel-view.ts` `drawRings`), so ~5% of the
 * world leaks through it and everything else in it is chrome the wheel drew: the
 * ore total, its caption, the hairline, the chevron and the CLOSE word. It is
 * also exactly where the defect was. The client hands back its bounds under
 * `wheel-hub-back` (the layout registry entry `hud.ts` pushes for the thumb-sized
 * BACK affordance), so the crop is the client's own geometry rather than a
 * number this file guessed.
 *
 * Press/confirm overlays are NOT asserted here on purpose: they last 0.16 s and
 * 0.55 s (`press-feedback.ts`), which is shorter than a screenshot on a
 * software-GL runner, so a pixel assertion on them would be a flake generator.
 * Their tokens are pinned in `instrument.test.ts` and they show in the goldens.
 *
 * Every press below is a REAL browser input event — `page.mouse.click` on a
 * desktop, `page.touchscreen.tap` on a phone — at the CLIENT point the client
 * itself mapped its logical geometry to (`__pressStage.clientPoint`, the exact
 * inverse of the `toLogical` every real pointer crosses). No debug method opens
 * the wheel; the staging seam only parks the ship at its own station and banks
 * it, which is the precondition, not the act.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface Vec2 {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stageStationWheel(): { stationPoint: Vec2 } | null;
  wheelState(): { open: boolean; panelOpen: boolean };
}
interface PressStage {
  clientPoint(x: number, y: number): Vec2;
  setOre(ore: number): number | null;
  wedges(): Array<{ id: string; costLabel: string; costPaint: string }>;
}
declare const window: Window & {
  __tapCommanderStage?: TapCommanderStage;
  __pressStage?: PressStage;
  __planetRush?: { layout: Array<{ id: string; bounds: Rect }> };
};

// ---------------------------------------------------------------------------
// The three form factors the developer judges this on
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
}

/** The same three the wheel's goldens are shot at, so the evidence and the
 *  baselines are talking about the same screens. `phone-portrait` is HELD in
 *  portrait: the landscape lock rotates the whole game root, which is why every
 *  point below goes through the client's own logical→client mapping. */
const PROFILES: readonly Profile[] = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1, touch: false },
  { name: 'phone-landscape', width: 844, height: 390, dpr: 3, touch: true },
  { name: 'phone-portrait', width: 390, height: 844, dpr: 3, touch: true },
];

/** Four ore banked: RADAR's 6 cannot be paid, TURRET and SHIELD are `FULL`. The
 *  frame therefore carries BOTH halves of the style-guide §2.1 carve-out — a
 *  numeral in threat red and the hub's total in signal yellow — which is what
 *  makes "no other hue anywhere" a statement with something to lose. */
const WHEEL_ORE = 4;

// ---------------------------------------------------------------------------
// The rule, as a pixel predicate
// ---------------------------------------------------------------------------

/**
 * Is this pixel the OLD accent — plasma `#4DC3FF` or anything in its family?
 *
 * Stated as a distance rather than an equality because the chevron was a 1.5 px
 * antialiased stroke: its edge pixels are the accent at partial coverage, and a
 * test that only caught the fully-covered core would pass on a 1 px hairline of
 * the same mistake.
 *
 * The threshold is chosen against what Bone can legitimately produce. Bone is a
 * value ramp on hull steel `#7E8894`, whose blue channel leads its red by 22;
 * the ramp's extremes (`bone` +20, `boneLo` +20, white 0) never exceed that. The
 * pre-Gantry accent leads by 178. A gap of 60 sits three times above every legal
 * Bone tone and three times below plasma, so neither a rounding nor a composite
 * can walk across it.
 */
function isOldAccent(r: number, g: number, b: number): boolean {
  return b - r >= 60 && b >= 90 && g > r;
}

/** Is this pixel signal yellow — the ore total, the one hue the hub is allowed?
 *  Warm and bright: the exact opposite corner from {@link isOldAccent}. */
function isSignalYellow(r: number, g: number, b: number): boolean {
  return r >= 150 && g >= 120 && r - b >= 60;
}

interface HubScan {
  readonly sampled: number;
  readonly oldAccent: number;
  readonly signalYellow: number;
  /** The worst offender's colour, for a failure message that names the pixel. */
  readonly worst: { x: number; y: number; hex: string } | null;
}

/**
 * Scan the DISC inscribed in `rect` (device pixels) of a decoded screenshot.
 *
 * A disc rather than the rect: the hub's bounding box has four corners that fall
 * OUTSIDE the hub ring, into the wedge band where the world legitimately reads
 * through — and a hue found there would be the fight, not the chrome. 0.92 of
 * the radius keeps the sample clear of the ring stroke itself.
 */
function scanHub(png: PNG, rect: Rect): HubScan {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const radius = (Math.min(rect.width, rect.height) / 2) * 0.92;
  const r2 = radius * radius;
  let sampled = 0;
  let oldAccent = 0;
  let signalYellow = 0;
  let worst: HubScan['worst'] = null;
  let worstLead = 0;

  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(png.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(png.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * png.width + x) << 2;
      const r = png.data[i] ?? 0;
      const g = png.data[i + 1] ?? 0;
      const b = png.data[i + 2] ?? 0;
      sampled++;
      if (isSignalYellow(r, g, b)) signalYellow++;
      if (isOldAccent(r, g, b)) {
        oldAccent++;
        if (b - r > worstLead) {
          worstLead = b - r;
          worst = { x, y, hex: `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}` };
        }
      }
    }
  }
  return { sampled, oldAccent, signalYellow, worst };
}

// ---------------------------------------------------------------------------
// Booting one client, and opening the wheel the way a player does
// ---------------------------------------------------------------------------

/** Frames, not milliseconds: the honest unit on a software-GL runner, where a
 *  flat wait can buy no drawn frames at all (the same helper `prompt-band.spec.ts`
 *  uses, and for the same reason). */
async function frames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (left-- <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

interface Client {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly errors: string[];
}

async function boot(browser: Browser, profile: Profile, baseURL: string): Promise<Client> {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    baseURL,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Live, not ?freeze: the wheel's docking gate is re-evaluated every tick, so a
  // frozen client would be proving a propped-up pose rather than a played one.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__tapCommanderStage?.stageStationWheel === 'function' &&
      typeof window.__pressStage?.clientPoint === 'function',
    undefined,
    { timeout: 30_000 },
  );
  return { page, context, errors };
}

/** A REAL browser input event at a LOGICAL screen point — a mouse click on a
 *  desktop, a thumb tap on a phone — routed through the client's own
 *  logical→client mapping so a portrait-held phone under the landscape lock is
 *  pressed where the thing is actually DRAWN, not where its logical point would
 *  be if the root were not rotated. */
async function realPress(page: Page, profile: Profile, at: Vec2): Promise<void> {
  const p = await page.evaluate((q) => window.__pressStage!.clientPoint(q.x, q.y), at);
  if (profile.touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

for (const profile of PROFILES) {
  test(`the open Build wheel's hub spends no hue but ore — ${profile.name}`, async ({
    browser,
    baseURL,
  }) => {
    const { page, context, errors } = await boot(browser, profile, baseURL!);
    try {
      // Park the ship at its own station in the tap scheme. This is the
      // PRECONDITION (you can only build at your station, GDD §2.5) — the seam
      // never opens the wheel, and asserts as much before the press.
      await page.evaluate(() => window.__tapCommanderStage!.setScheme('tap'));
      const staged = await page.evaluate(() => window.__tapCommanderStage!.stageStationWheel());
      expect(staged, 'the stage docked the ship and reported where its station is drawn').not.toBeNull();
      expect(
        (await page.evaluate(() => window.__tapCommanderStage!.wheelState())).open,
        'the wheel is CLOSED before the press — the press is what opens it',
      ).toBe(false);

      // --- The real press on the drawn station opens the wheel -----------------
      await realPress(page, profile, staged!.stationPoint);
      await page.waitForFunction(() => window.__tapCommanderStage!.wheelState().open === true, undefined, {
        timeout: 10_000,
      });

      // Re-price so the frame carries BOTH ratified cost colours, then let the
      // open-pop finish and the re-priced wedges redraw.
      await page.evaluate((ore) => window.__pressStage!.setOre(ore), WHEEL_ORE);
      await frames(page, 12);

      // The frame is only worth scanning if it still carries what it is evidence
      // OF — the same discipline the goldens' boot helper uses.
      const wedges = await page.evaluate(() => window.__pressStage!.wedges());
      expect(
        wedges.find((w) => w.id === 'satellite')?.costPaint,
        'the unaffordable RADAR cost is painted in threat red (style-guide §2.1)',
      ).toBe('refused');
      expect(
        wedges.find((w) => w.id === 'upgrade')?.costLabel,
        'UPGRADE SHIP still signposts the screen it opens',
      ).toBe('OPEN ▸');

      // --- Evidence, then the scan --------------------------------------------
      const shot = await page.screenshot({
        path: `tests/live-stage/wheel-chrome-${profile.name}-evidence.png`,
      });

      const hub = await page.evaluate(
        () => window.__planetRush!.layout.find((e) => e.id === 'wheel-hub-back')?.bounds ?? null,
      );
      expect(hub, 'the client registered the hub BACK affordance it drew').not.toBeNull();

      // Logical → client → device pixels. The lock is a pure rotation, so a
      // length survives it unchanged and only the CENTRE has to be mapped.
      const centre = await page.evaluate(
        (b: Rect) => window.__pressStage!.clientPoint(b.x + b.width / 2, b.y + b.height / 2),
        hub!,
      );
      const side = Math.min(hub!.width, hub!.height) * profile.dpr;
      const deviceRect: Rect = {
        x: centre.x * profile.dpr - side / 2,
        y: centre.y * profile.dpr - side / 2,
        width: side,
        height: side,
      };

      const scan = scanHub(PNG.sync.read(shot), deviceRect);

      // The crop landed on the hub — a mis-aimed rect that sampled empty void
      // would otherwise pass the real assertion by finding nothing at all.
      expect(scan.sampled, 'the hub crop has pixels in it').toBeGreaterThan(500);
      expect(
        scan.signalYellow,
        'the hub is drawing the live ore total in signal yellow — the crop is on target',
      ).toBeGreaterThan(20);

      // THE RULE. Bone spends no colour on chrome; the hub's only hue is ore.
      expect(
        scan.oldAccent,
        `the hub still draws ${scan.oldAccent}/${scan.sampled} px of the pre-Gantry accent` +
          (scan.worst ? ` (worst ${scan.worst.hex} at ${scan.worst.x},${scan.worst.y})` : ''),
      ).toBe(0);

      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
