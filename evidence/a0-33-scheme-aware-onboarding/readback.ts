/**
 * evidence/a0-33-scheme-aware-onboarding/readback.ts — the prompt set as it
 * reads under EVERY configuration a player can be in, off the shipped modules.
 *
 *   npx vite-node evidence/a0-33-scheme-aware-onboarding/readback.ts \
 *     > evidence/a0-33-scheme-aware-onboarding/readback.json
 *
 * The brief asks for the words themselves, so the developer can check them:
 * *"The prompt set as it reads under each configuration — Sticks+Manual,
 * Sticks+Auto-aim, Tap Commander — on desktop and on a 390 px phone."*
 *
 * Three sections, and nothing here is typed by hand:
 *
 *  1. **`readings`** — every prompt × every device × every fire mode × both
 *     control schemes, resolved through `resolvePromptText` exactly as
 *     `Hud.updateOnboarding` resolves it. `new` marks a sentence a0-33 wrote
 *     (GDD §2.10 has ratified words only for Sticks+Manual), so the developer
 *     can see at a glance what they are being asked to approve.
 *  2. **`phone`** — the same sentences LAID OUT on a 390×844 handset: the wrap
 *     width the HUD gives them, the lines they take at the HUD's own scaled
 *     type, and the panel height against `promptMaxHeight`'s cap. §4.7 —
 *     "length is part of clarity" — and the new Tap Commander haul sentence is
 *     the longest string the game authors.
 *  3. **`firstMatch`** — the trigger walk, driven through the real `Onboarding`
 *     machine: what a first-time Tap Commander player is told, in order, with
 *     the mid-match switch to the sticks happening while a prompt is up.
 *
 * No Pixi, no `window`: the prompt copy and the trigger machine are pure, which
 * is the whole reason this can be read back in node.
 */

import { Onboarding, PromptId, resolvePromptText } from '../../src/ui/onboarding';
import type { OnboardingSignals } from '../../src/ui/onboarding';
import type { ControlScheme } from '../../src/ui/settings';
import { FireMode } from '../../src/platform/actions';
import type { DeviceKind } from '../../src/platform/actions';
import { promptWrapWidth, promptBounds, promptPad, promptMaxHeight } from '../../src/ui/hud-geometry';
import { hudMetrics, hudType } from '../../src/ui/instrument';

// ---------------------------------------------------------------------------
// 1. The readings
// ---------------------------------------------------------------------------

const DEVICES: readonly DeviceKind[] = ['keyboard', 'gamepad', 'touch'];
const MODES: readonly FireMode[] = [FireMode.Manual, FireMode.AutoAim];
const SCHEMES: readonly ControlScheme[] = ['sticks', 'tap'];

/**
 * Is this reading a sentence the GDD already has words for?
 *
 * The ratified baseline is **Sticks + Manual** — the one configuration §2.10 was
 * written for — on the same device, because the binding inside it is the action
 * layer's business and was never in question. A reading that comes out identical
 * to that baseline is the ratified copy; anything else is a0-33's, and needs the
 * developer's eye. The CONTROLS tip has no baseline at all: the whole prompt is
 * new (the developer's third ask).
 */
function isRatified(prompt: PromptId, device: DeviceKind, text: string): boolean {
  if (prompt === PromptId.Controls) return false;
  return text === resolvePromptText(prompt, device, FireMode.Manual, 'sticks');
}

interface Reading {
  readonly prompt: string;
  readonly device: DeviceKind;
  readonly fireMode: string;
  readonly scheme: ControlScheme;
  readonly text: string;
  readonly copy: 'GDD §2.10' | 'NEW (a0-33)';
}

const readings: Reading[] = [];
for (const prompt of Object.values(PromptId)) {
  for (const scheme of SCHEMES) {
    for (const device of DEVICES) {
      for (const mode of MODES) {
        const text = resolvePromptText(prompt, device, mode, scheme);
        readings.push({
          prompt,
          device,
          fireMode: mode,
          scheme,
          text,
          copy: isRatified(prompt, device, text) ? 'GDD §2.10' : 'NEW (a0-33)',
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. The same sentences on a 390 px phone
// ---------------------------------------------------------------------------

/** iPhone-ish, the profile the mobile suite runs (390×844, dpr 3), landscape-
 *  locked the way the client locks it (`src/platform/orientation.ts`), because
 *  that is the viewport the HUD actually lays out in. */
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
// 3. The first match, walked
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
 * on a phone — switching schemes twice, mid-prompt, which is the mid-match case
 * the brief asks about. No clock is fed here on purpose, so the CONTROLS tip's
 * dwell cannot expire and shorten the walk; the dwell has its own section below.
 */
const ob = new Onboarding();
const firstMatch = [
  tick(ob, 'drifts into asteroid range', sig({ nearAsteroid: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'still by the rock, nothing mined', sig({ nearAsteroid: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'SWITCHES to the sticks with the prompt on screen', sig({ nearAsteroid: true }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 'chips off a first ore — MINE is learned', sig({ nearAsteroid: true, cargo: 1 }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 'the hold fills', sig({ cargo: 2, cargoCap: 2 }), 'touch', FireMode.AutoAim, 'sticks'),
  tick(ob, 'switches BACK to Tap Commander, hold still full', sig({ cargo: 2, cargoCap: 2 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'banks in the collection field — HAUL is learned', sig({ cargo: 0, cargoCap: 2 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'opens the Build wheel', sig({ wheelOpen: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'buys a turret — SPEND is learned', sig({ wheelOpen: true, hasSpent: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'the station is sieged', sig({ underAttack: true }), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'the siege is survived', sig(), 'touch', FireMode.AutoAim, 'tap'),
  tick(ob, 'back near a rock, hold full, wheel open — nothing re-fires', sig({ nearAsteroid: true, cargo: 2, cargoCap: 2, wheelOpen: true }), 'touch', FireMode.AutoAim, 'tap'),
];

/**
 * The CONTROLS tip's dwell, at a match-clock cadence: it takes the band once the
 * loop is flown and holds it for {@link CONTROLS_TIP_SECONDS} of *shown* time,
 * then retires for good — through the same memory every other lesson uses.
 */
const dwellOb = new Onboarding();
dwellOb.update(sig({ nearAsteroid: true, cargo: 1, time: 0 }));
dwellOb.update(sig({ cargo: 2, cargoCap: 2, time: 0 }));
const controlsDwell = [
  tick(dwellOb, 'the hold is emptied — one whole loop flown', sig({ cargo: 0, cargoCap: 2, time: 0 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+2 s', sig({ time: 2 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+5 s', sig({ time: 5 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+7 s', sig({ time: 7 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+8 s — read', sig({ time: 8 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 't+9 s', sig({ time: 9 }), 'touch', FireMode.AutoAim, 'tap'),
  tick(dwellOb, 'the rest of this match, and every later one', sig({ time: 600 }), 'touch', FireMode.AutoAim, 'tap'),
];

console.log(
  JSON.stringify(
    {
      what: 'a0-33 — the onboarding prompt set under every control scheme, fire mode and device',
      phoneProfile: { ...PHONE, note: 'iPhone-ish 390×844, landscape-locked as the client locks it', insets: PHONE_INSETS },
      readings,
      phone,
      firstMatch,
      controlsDwell,
      allCompleted: { firstMatch: ob.allCompleted(), dwellWalk: dwellOb.isCompleted(PromptId.Controls) },
    },
    null,
    2,
  ),
);
