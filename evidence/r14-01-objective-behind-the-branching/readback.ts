/**
 * evidence/r14-01-objective-behind-the-branching/readback.ts — a0-33's six
 * readings, re-run with a0-34's OBJECTIVE prompt in place.
 *
 *   npx vite-node evidence/r14-01-objective-behind-the-branching/readback.ts \
 *     > evidence/r14-01-objective-behind-the-branching/readback.json
 *
 * #405 branched before #404 landed. a0-33 made the LESSON branch on the control
 * scheme and the fire mode; a0-34 added a prompt that fires FIRST and names the
 * objective. Both are ratified developer asks from the same conversation, and
 * the rescue's job is that both survive — so this is the same readback a0-33
 * produced (`evidence/a0-33-scheme-aware-onboarding/readback.ts`, left untouched
 * as that brief's record), re-run against the merged module.
 *
 * Four sections:
 *
 *  1. **`sixReadings`** — THE deliverable the brief asks for: the whole prompt
 *     set, in {@link PROMPT_ORDER}, as a player reads it in each of the six
 *     configurations they can be in (Sticks+Manual, Sticks+Auto-aim, Tap
 *     Commander × desktop / 390 px phone). The objective is the second row of
 *     every one of them — behind only the siege, which fires on nothing in a
 *     quiet opening — and it reads the same in all six, because it names a goal
 *     rather than a gesture.
 *  2. **`readings`** — the exhaustive grid a0-33 printed (every prompt × device ×
 *     fire mode × scheme), so nothing hides between the six.
 *  3. **`phone`** — the same sentences LAID OUT on a 390×844 handset: wrap width,
 *     line count at the HUD's own scaled type, panel height against
 *     `promptMaxHeight`'s cap. §4.7, "length is part of clarity" — and the
 *     objective is now the longest string the game authors, ahead of a0-33's Tap
 *     Commander haul sentence, so this is where it has to be measured.
 *  4. **`firstMatch`** — the trigger walk through the real `Onboarding` machine,
 *     with the clock fed (which a0-33's walk did not do): what a first-time
 *     player on the shipped defaults is told, in order, objective first.
 *
 * No Pixi, no `window`: the copy and the trigger machine are pure.
 */

import { Onboarding, PromptId, resolvePromptText } from '../../src/ui/onboarding';
import type { OnboardingSignals } from '../../src/ui/onboarding';
import type { ControlScheme } from '../../src/ui/settings';
import { FireMode } from '../../src/platform/actions';
import type { DeviceKind } from '../../src/platform/actions';
import { promptWrapWidth, promptBounds, promptPad, promptMaxHeight } from '../../src/ui/hud-geometry';
import { hudMetrics, hudType } from '../../src/ui/instrument';

// ---------------------------------------------------------------------------
// Which copy is ratified, and which brief wrote the rest
// ---------------------------------------------------------------------------

/**
 * GDD §2.10 has ratified words for exactly one configuration — **Sticks +
 * Manual** — and for exactly four prompts. Everything else on screen is copy a
 * build-time brief wrote and the developer has yet to approve, so each reading
 * says which brief to blame.
 */
function provenance(prompt: PromptId, device: DeviceKind, text: string): string {
  if (prompt === PromptId.Objective) return 'NEW (a0-34)';
  if (prompt === PromptId.Controls) return 'NEW (a0-33)';
  return text === resolvePromptText(prompt, device, FireMode.Manual, 'sticks')
    ? 'GDD §2.10'
    : 'NEW (a0-33)';
}

// ---------------------------------------------------------------------------
// 1. The six readings — the brief's deliverable
// ---------------------------------------------------------------------------

/** The six configurations the brief names, each with the device a player is on. */
const SIX: ReadonlyArray<{
  readonly name: string;
  readonly device: DeviceKind;
  readonly mode: FireMode;
  readonly scheme: ControlScheme;
}> = [
  { name: 'desktop · Sticks + Manual', device: 'keyboard', mode: FireMode.Manual, scheme: 'sticks' },
  { name: 'desktop · Sticks + Auto-aim', device: 'keyboard', mode: FireMode.AutoAim, scheme: 'sticks' },
  { name: 'desktop · Tap Commander', device: 'keyboard', mode: FireMode.AutoAim, scheme: 'tap' },
  { name: '390 px phone · Sticks + Manual', device: 'touch', mode: FireMode.Manual, scheme: 'sticks' },
  { name: '390 px phone · Sticks + Auto-aim', device: 'touch', mode: FireMode.AutoAim, scheme: 'sticks' },
  { name: '390 px phone · Tap Commander', device: 'touch', mode: FireMode.AutoAim, scheme: 'tap' },
];

/** Priority order, as the module iterates it — printed so the objective's PLACE
 *  is visible in the evidence rather than asserted in prose. */
const ORDER: readonly PromptId[] = [
  PromptId.UnderAttack,
  PromptId.Objective,
  PromptId.Mine,
  PromptId.HaulHome,
  PromptId.Spend,
  PromptId.Controls,
];

const sixReadings = SIX.map((cfg) => ({
  configuration: cfg.name,
  device: cfg.device,
  fireMode: cfg.mode,
  scheme: cfg.scheme,
  prompts: ORDER.map((id, rank) => {
    const text = resolvePromptText(id, cfg.device, cfg.mode, cfg.scheme);
    return { rank: rank + 1, prompt: id, text, copy: provenance(id, cfg.device, text) };
  }),
}));

/** The objective, isolated: one sentence, six configurations, one answer. It
 *  goes THROUGH the branch (three declared slots, resolved by `lessonFor`) and
 *  the branch's honest output for a prompt with no gesture is the same line. */
const objectiveAcrossTheSix = {
  distinctSentences: [...new Set(SIX.map((c) => resolvePromptText(PromptId.Objective, c.device, c.mode, c.scheme)))],
  perConfiguration: SIX.map((c) => ({
    configuration: c.name,
    text: resolvePromptText(PromptId.Objective, c.device, c.mode, c.scheme),
  })),
  beats: (() => {
    const t = resolvePromptText(PromptId.Objective, 'keyboard', FireMode.Manual, 'sticks');
    return {
      'last station alive': /last station standing/i.test(t),
      'mine ore': /mine ore/i.test(t),
      'spend on defenses / upgrade your ship': /build defenses/i.test(t) && /upgrade your ship/i.test(t),
      'attack when you see fit': /attack when you judge it right/i.test(t),
    };
  })(),
};

// ---------------------------------------------------------------------------
// 2. The exhaustive grid (a0-33's section 1, unchanged in shape)
// ---------------------------------------------------------------------------

const DEVICES: readonly DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
const MODES: readonly FireMode[] = [FireMode.Manual, FireMode.AutoAim];
const SCHEMES: readonly ControlScheme[] = ['sticks', 'tap'];

interface Reading {
  readonly prompt: string;
  readonly device: DeviceKind;
  readonly fireMode: string;
  readonly scheme: ControlScheme;
  readonly text: string;
  readonly copy: string;
}

const readings: Reading[] = [];
for (const prompt of Object.values(PromptId)) {
  for (const scheme of SCHEMES) {
    for (const device of DEVICES) {
      for (const mode of MODES) {
        const text = resolvePromptText(prompt, device, mode, scheme);
        readings.push({ prompt, device, fireMode: mode, scheme, text, copy: provenance(prompt, device, text) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The same sentences on a 390 px phone
// ---------------------------------------------------------------------------

/** iPhone-ish, the profile the mobile suite runs (390×844, dpr 3), landscape-
 *  locked the way the client locks it (`src/platform/orientation.ts`). */
const PHONE = { width: 844, height: 390 };
/** The home-indicator crop a real handset reports — a0-24's second clip. */
const PHONE_INSETS = { bottom: 34 };
/** The over-estimating advance `hud-geometry.test.ts` measures with: it wraps
 *  onto MORE lines than the real face takes, so a fit here is a fit on glass. */
const ADVANCE = 0.85;

const phonePx = hudType(16, hudMetrics(PHONE.width, PHONE.height));
const phoneWrap = promptWrapWidth(PHONE.width, PHONE.height, true, PHONE_INSETS);
const phoneCap = promptMaxHeight(PHONE.height, true, PHONE_INSETS);
const phonePadY = promptPad(PHONE.width, PHONE.height).y;

const phone = readings
  .filter((r) => r.device === 'touch')
  .map((r) => {
    const lines = Math.max(1, Math.ceil((r.text.length * phonePx * ADVANCE) / phoneWrap));
    const height = lines * Math.ceil(phonePx * 1.3) + phonePadY;
    const bounds = promptBounds(PHONE.width, PHONE.height, 10_000, height - phonePadY, true, PHONE_INSETS);
    return {
      prompt: r.prompt,
      scheme: r.scheme,
      fireMode: r.fireMode,
      text: r.text,
      chars: r.text.length,
      lines,
      panelHeight: Math.round(height),
      capHeight: Math.round(phoneCap),
      fits: height <= phoneCap,
      bottomEdge: Math.round(bounds.y + bounds.height),
      visibleBottom: PHONE.height - PHONE_INSETS.bottom,
    };
  });

// ---------------------------------------------------------------------------
// 4. The first match, walked — with the clock fed
// ---------------------------------------------------------------------------

function sig(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return { nearAsteroid: false, cargo: 0, cargoCap: 2, ...over };
}

/** One tick: advance the machine and record what a player on `scheme` reads. */
function tick(
  ob: Onboarding,
  what: string,
  signals: OnboardingSignals,
  device: DeviceKind,
  mode: FireMode,
  scheme: ControlScheme,
): { moment: string; scheme: ControlScheme; prompt: string; text: string } {
  const active = ob.update(signals);
  return {
    moment: what,
    scheme,
    prompt: active ?? '(none)',
    text: active === null ? '' : resolvePromptText(active, device, mode, scheme),
  };
}

/**
 * A first-time player on the SHIPPED DEFAULTS (a0-30: Tap Commander + Auto-aim),
 * on a phone, with `world.time` fed as the real HUD feeds it. The objective is
 * the first thing the game says; it holds the band for its 8-second dwell and
 * then hands over to the verb lessons, in a0-33's Tap Commander wording. The
 * player switches to the sticks mid-prompt, exactly as a0-33's walk did.
 */
const ob = new Onboarding();
const firstMatch = [
  tick(ob, 't=0 — the match opens', sig({ time: 0 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=3 — drifts into asteroid range, still reading', sig({ nearAsteroid: true, time: 3 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=9 — the objective is read, and retires for the career', sig({ nearAsteroid: true, time: 9 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=10 — SWITCHES to the sticks with the prompt on screen', sig({ nearAsteroid: true, time: 10 }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 't=14 — chips off a first ore, MINE is learned', sig({ nearAsteroid: true, cargo: 1, time: 14 }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 't=30 — the hold fills', sig({ cargo: 2, cargoCap: 2, time: 30 }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 't=34 — switches BACK to Tap Commander, hold still full', sig({ cargo: 2, cargoCap: 2, time: 34 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=50 — banks in the collection field, HAUL is learned', sig({ cargo: 0, cargoCap: 2, time: 50 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=52 — opens the Build wheel', sig({ wheelOpen: true, time: 52 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=55 — buys a turret, SPEND is learned; the settings tip takes the band', sig({ wheelOpen: true, hasSpent: true, time: 55 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=63 — 8 s of shown time: the settings tip is read, and retires', sig({ time: 63 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=70 — the station is sieged', sig({ underAttack: true, time: 70 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=95 — the siege is survived; every lesson is behind the player', sig({ time: 95 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 't=300 — near a rock, hold full, wheel open: nothing re-fires', sig({ nearAsteroid: true, cargo: 2, cargoCap: 2, wheelOpen: true, time: 300 }), 'touch', FireMode.AutoAim, 'tap'),
];

/**
 * The two dwell-retired prompts, on one clock and one accumulator (the fold this
 * rescue made): the objective at the top of the order, the settings tip at the
 * bottom, both retiring on being read, neither retiring while a siege has the
 * band.
 */
const dwellOb = new Onboarding();
const dwells = [
  tick(dwellOb, 'the match opens — the objective takes the band', sig({ time: 0 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+2 s', sig({ time: 2 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+3 s — a siege interrupts the read', sig({ time: 3, underAttack: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+40 s — still under siege; the dwell has not moved', sig({ time: 40, underAttack: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+41 s — survived; the objective is owed its read', sig({ time: 41 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+47 s — 8 s of SHOWN time; read, and retired', sig({ time: 47 }), 'touch', FireMode.AutoAim, 'tap'),
];

console.log(
  JSON.stringify(
    {
      what: 'r14-01 — a0-33\'s six readings, re-run with a0-34\'s OBJECTIVE prompt in place',
      order: ORDER,
      phoneProfile: { ...PHONE, note: 'iPhone-ish 390×844, landscape-locked as the client locks it', insets: PHONE_INSETS },
      sixReadings,
      objectiveAcrossTheSix,
      readings,
      phone,
      firstMatch,
      dwells,
      allCompleted: { firstMatch: ob.allCompleted() },
    },
    null,
    2,
  ),
);
