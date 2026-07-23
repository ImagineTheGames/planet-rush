/**
 * src/ui/ — HUD and menus. OWNER: UI Engineer (GDD §3.7).
 *
 * Ore squares + banked total, the asteroid-wave clock, the under-attack alarm
 * and screen-edge arrow, over-ship hull bars, the device-aware controls strip,
 * the radial build menu, upgrade panel, minimap, lobby, settings (incl. the
 * fire-mode toggle), end-of-match/rematch, and the onboarding prompts (§2.10).
 * Thumb-scale layout and safe-area anchoring for touch.
 *
 * Day-1 surface (GDD §4.6): the in-play {@link Hud} — ore-at-a-glance + banked
 * total, the asteroid-wave clock, the desktop controls strip, and the first two
 * onboarding prompts. The Platform Engineer constructs {@link Hud} on the Pixi
 * stage and calls {@link Hud.update} each frame with a {@link HudFrame}.
 */

export { Hud } from './hud';
export type { HudFrame } from './hud';

export { Onboarding, PromptId, resolvePromptText } from './onboarding';
export type { OnboardingSignals } from './onboarding';

export { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
export type { WaveClock } from './wave-clock';

export { oreHudModel, oreFlashOn } from './ore-hud';
export type { OreHudModel } from './ore-hud';

export { controlsStripRows, showControlsStrip } from './controls-strip';
