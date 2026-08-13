/**
 * evidence/a0-37-scheme-aware-controls-strip/readback.ts — the controls strip as
 * it READS, under every configuration a player can be seated in, off the shipped
 * modules.
 *
 *   npx vite-node evidence/a0-37-scheme-aware-controls-strip/readback.ts \
 *     > evidence/a0-37-scheme-aware-controls-strip/readback.json
 *
 * The brief asks for the words themselves: *"The strip as it reads under each
 * combination — Sticks+Manual, Sticks+Auto-aim, Tap Commander — on desktop and
 * gamepad, quoted verbatim."* Nothing below is typed by hand: every line is
 * `controlsStripView(...)`, the same call `Hud.updateControlsStrip` makes, joined
 * the way `Hud.rebuildStrip` lays it out (key glyph, then action, left→right).
 *
 * Four sections:
 *
 *  1. **`developerFrame`** — the acceptance test, alone at the top: PC + Tap
 *     Commander + Auto-aim (the a0-30 defaults), `before` as build `75ec737`
 *     drew it and `after` as this branch draws it.
 *  2. **`strip`** — every device × fire mode × scheme, docked and away, with the
 *     pre-a0-37 line beside each so a reader can see exactly what moved. `touch`
 *     is included and marked: the strip is NOT drawn there (§2.2/§2.4) — those
 *     rows are the map that feeds onboarding/settings copy.
 *  3. **`liveBindings`** — what each scheme's rows CLAIM, checked against what
 *     `src/main.ts` `sampleInput` actually leaves live. This is the section that
 *     makes "no thrust row under tap" a measurement rather than an opinion.
 *  4. **`width`** — the drawn width of the longest line against the viewport, at
 *     the HUD's own scaled type, so the new Auto-aim label is shown to fit on a
 *     desktop and on a 390 px handset's landscape lock.
 *
 * No Pixi and no `window`: the binding map and the strip model are pure, which is
 * the whole reason this can be read back in node.
 */

import { controlsStripView, showControlsStrip } from '../../src/ui/controls-strip';
import type { StripRow } from '../../src/ui/controls-strip';
import { describeBindings, FireMode } from '../../src/platform/actions';
import type { ControlScheme, DeviceKind } from '../../src/platform/actions';
import { hudMetrics, hudSpace, hudType } from '../../src/ui/instrument';

// ---------------------------------------------------------------------------
// Reading a strip the way the player reads it
// ---------------------------------------------------------------------------

const DEVICES: readonly DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
const MODES: readonly FireMode[] = [FireMode.Manual, FireMode.AutoAim];
const SCHEMES: readonly ControlScheme[] = ['sticks', 'tap'];

/** The strip as one line, exactly as `Hud.rebuildStrip` lays it out: the key
 *  glyph then the action, rows separated by air. A dimmed row prints no key at
 *  all (it drops its binding), so it reads as its hint alone. */
function read(rows: readonly StripRow[]): string {
  return rows.map((r) => (r.binding === null ? r.label : `${r.binding} ${r.label}`)).join('    ');
}

/**
 * The strip as build `75ec737` drew it — a FROZEN copy of the old
 * `describeBindings` table, verbatim, which is the only honest way to print a
 * "before" column: the shipped function no longer has that behaviour to call, and
 * the `'sticks'` branch is not it either (a0-37 also re-worded the Auto-aim fire
 * row). Its output for the developer's own seat is the line `red-before.txt`
 * captured from the real shipped code at commit `62b759b`, so this copy is
 * checked, not remembered.
 *
 * Nothing reads this but the evidence. It is dead the moment it is printed.
 */
function before(device: DeviceKind, mode: FireMode, docked: boolean): string {
  const auto = mode === FireMode.AutoAim;
  const thrust: Record<DeviceKind, string> = {
    keyboard: 'WASD',
    gamepad: 'Left stick',
    touch: 'Left stick',
  };
  const aim: Record<DeviceKind, string> = {
    keyboard: 'Mouse',
    gamepad: 'Right stick',
    touch: 'Right stick',
  };
  const fireManual: Record<DeviceKind, string> = {
    keyboard: 'Left mouse',
    gamepad: 'Right trigger',
    touch: 'Right stick',
  };
  const fireAuto: Record<DeviceKind, string> = {
    keyboard: 'Left mouse',
    gamepad: 'Right trigger',
    touch: 'FIRE button',
  };
  const build: Record<DeviceKind, string> = { keyboard: 'E', gamepad: 'Y / △', touch: 'BUILD' };

  const rows: StripRow[] = [
    { action: 'thrust', label: 'Thrust', binding: thrust[device], dimmed: false },
  ];
  if (!auto) rows.push({ action: 'aim', label: 'Aim', binding: aim[device], dimmed: false });
  rows.push({
    action: 'fire',
    label: 'Fire / Mine',
    binding: (auto ? fireAuto : fireManual)[device],
    dimmed: false,
  });
  // The Build row was contextual on docking then too (field report v0.2.2).
  rows.push(
    docked
      ? { action: 'build', label: 'Build & Upgrade', binding: build[device], dimmed: false }
      : {
          action: 'build',
          label: 'Build & Upgrade — get closer to your station',
          binding: null,
          dimmed: true,
        },
  );
  return read(rows);
}

// ---------------------------------------------------------------------------
// 1. The developer's own frame — the acceptance test
// ---------------------------------------------------------------------------

const developerLine = read(controlsStripView('keyboard', FireMode.AutoAim, false, true, 'tap'));

const developerFrame = {
  who: 'the developer, on PC, with Tap Commander + Auto-aim (the a0-30 defaults)',
  theirWords: 'these need to change to instead display the presses needed to play',
  before: before('keyboard', FireMode.AutoAim, true),
  after: developerLine,
  /** The brief's acceptance test, stated as the check it is. */
  passes: !developerLine.includes('WASD') && !developerLine.includes('Left mouse Fire / Mine'),
  /** The same player if they switch to the sticks mid-match — the strip re-labels
   *  on the next frame, because the scheme rides `HudFrame` and the rebuild
   *  signature. Shown so the fix is visibly a branch, not a replacement. */
  ifTheySwitchToSticks: read(controlsStripView('keyboard', FireMode.AutoAim, false, true, 'sticks')),
};

// ---------------------------------------------------------------------------
// 2. Every combination
// ---------------------------------------------------------------------------

interface Reading {
  readonly scheme: ControlScheme;
  readonly device: DeviceKind;
  readonly fireMode: string;
  readonly docked: boolean;
  /** What the strip says now. Empty on touch — no strip is drawn there. */
  readonly strip: string;
  /** What build `75ec737` said in the same seat. */
  readonly was: string;
  readonly changed: boolean;
  /** Touch draws no strip (GDD §2.2, §2.4); these rows feed copy elsewhere. */
  readonly drawn: boolean;
  /** The same rows as the map returns them, strip or no strip. */
  readonly rows: readonly { action: string; binding: string; label: string }[];
}

const strip: Reading[] = [];
for (const scheme of SCHEMES) {
  for (const device of DEVICES) {
    for (const mode of MODES) {
      for (const docked of [true, false]) {
        const isTouch = device === 'touch';
        const now = read(controlsStripView(device, mode, isTouch, docked, scheme));
        const was = isTouch ? '' : before(device, mode, docked);
        strip.push({
          scheme,
          device,
          fireMode: mode,
          docked,
          strip: now,
          was,
          changed: now !== was,
          drawn: showControlsStrip(isTouch),
          rows: describeBindings(device, mode, scheme).map((r) => ({
            action: r.action,
            binding: r.binding,
            label: r.label,
          })),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. What the scheme actually leaves live (src/main.ts `sampleInput`)
// ---------------------------------------------------------------------------

/**
 * The measurement the "no thrust row under tap" decision rests on, stated as
 * data so a reader can check it against the wiring:
 *
 *   const tap = controlScheme === 'tap';
 *   if (tap) {
 *     merged.thrust.x = 0; merged.thrust.y = 0;
 *     merged.aim = null;   merged.fire = false;
 *     …the pilot writes thrust/aim/fire from the standing order…
 *   }
 *   // `merged.build` is NOT touched.
 *
 * So in Tap Commander a device's thrust, aim and fire reach the sim as zero, and
 * build reaches it as the device wrote it. A row is honest only if the scheme
 * leaves its binding live.
 */
const LIVE_IN_SCHEME: Record<ControlScheme, Record<string, boolean>> = {
  sticks: { thrust: true, aim: true, fire: true, build: true, command: false },
  tap: { thrust: false, aim: false, fire: false, build: true, command: true },
};

const liveBindings = SCHEMES.map((scheme) => {
  const claimed = describeBindings('keyboard', FireMode.AutoAim, scheme).map((r) => r.action);
  return {
    scheme,
    rowsClaimed: claimed,
    liveInScheme: Object.entries(LIVE_IN_SCHEME[scheme])
      .filter(([, live]) => live)
      .map(([action]) => action),
    /** No row may name a binding the scheme zeroes — the whole bug, as a check. */
    everyRowLive: claimed.every((a) => LIVE_IN_SCHEME[scheme][a]),
    /** …and nothing live is left unnamed, except `aim`, which folds away in
     *  Auto-aim by design (GDD §2.4) — so this is read at Auto-aim and `aim` is
     *  expected to be missing on the sticks. */
    unnamedButLive: Object.entries(LIVE_IN_SCHEME[scheme])
      .filter(([action, live]) => live && !claimed.includes(action as never))
      .map(([action]) => action),
  };
});

// ---------------------------------------------------------------------------
// 4. Does the longest line fit?
// ---------------------------------------------------------------------------

/** Mirrors `Hud`'s own drawing constants (`STRIP_PAD` 12, `TYPE.stripKey` 13,
 *  `TYPE.stripLabel` 12, key gap 6, row gap 18) — the same mirror-the-constant
 *  discipline `hud-geometry.ts` uses for `PROMPT_STRIP_RESERVE`. */
const STRIP_PAD = 12;
const KEY_PX = 13;
const LABEL_PX = 12;
const KEY_GAP = 6;
const ROW_GAP = 18;
/** The over-estimating advance `hud-geometry.test.ts` measures with: it comes out
 *  WIDER than the real face, so a fit here is a fit on glass. */
const ADVANCE = 0.85;

/** Desktop, and a 390×844 handset on the client's landscape lock — the two
 *  profiles the mobile suite runs. The handset draws no strip (§2.4); it is
 *  measured anyway, so the answer does not depend on that rule holding. */
const VIEWPORTS = [
  { name: 'desktop 1280×720', width: 1280, height: 720 },
  { name: 'phone 390×844, landscape-locked', width: 844, height: 390 },
];

const width = VIEWPORTS.flatMap((vp) => {
  const m = hudMetrics(vp.width, vp.height);
  const keyPx = hudType(KEY_PX, m);
  const labelPx = hudType(LABEL_PX, m);
  const gapKey = hudSpace(KEY_GAP, m);
  const gapRow = hudSpace(ROW_GAP, m);
  return SCHEMES.flatMap((scheme) =>
    MODES.map((mode) => {
      const rows = controlsStripView('keyboard', mode, false, true, scheme);
      const drawn =
        STRIP_PAD +
        rows.reduce(
          (x, r) =>
            x +
            (r.binding ? r.binding.length * keyPx * ADVANCE + gapKey : 0) +
            r.label.length * labelPx * ADVANCE +
            gapRow,
          0,
        ) -
        gapRow;
      return {
        viewport: vp.name,
        scheme,
        fireMode: mode,
        line: read(rows),
        drawnWidth: Math.round(drawn),
        viewportWidth: vp.width,
        fits: drawn <= vp.width - STRIP_PAD,
      };
    }),
  );
});

console.log(
  JSON.stringify({ developerFrame, strip, liveBindings, width }, null, 2),
);
