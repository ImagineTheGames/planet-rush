/**
 * src/ui/sfx.ts — the narrow sound seam the UI controls call. OWNER: UI.
 *
 * ── WHY THIS FILE EXISTS (field report v0.2.4+) ─────────────────────────────
 * *"UI has no sound FX — the voices exist, nothing calls them."* The a3-02 SFX
 * refresh shipped the UI voices (a press tick, a confirm chime, a rejected
 * buzz — they live in `src/art/audio`'s bank), but the CALL SITES were unowned:
 * the sound agent cannot touch `src/ui`, and no UI brief had claimed them.
 *
 * This is the exact shape {@link ../platform/haptics} already solved. The UI
 * names an EVENT — a press landed, the sim confirmed a spend, a disabled control
 * was pressed — and the audio module behind the seam decides EVERYTHING else:
 * which sound, the SFX-slider gain, the death-hush ducking, rapid-repeat jitter
 * (`src/art/audio` {@link AudioEngine.cue}). The UI never reaches into a synth.
 *
 * ── ONE CALL SITE, EVERYTHING INHERITS ──────────────────────────────────────
 * The seam is fed into the ONE shared control component — {@link ./press-feedback}
 * `PressFeedback`, the same driver that holds the press/reject/confirm VISUAL
 * tell — so a control's sound is fired from the identical state its motion is:
 * `press()` sounds `press` (ready) or `reject` (disabled), and a `confirm()` that
 * the sim actually landed sounds `confirm`. Every wheel/menu control that routes
 * through that driver gets its voice for free, keyed to what the player sees.
 *
 * The three cues are a subset of the audio module's `AudioCue` vocabulary, so the
 * platform wires this seam with a one-liner: `sfx: (cue) => audio.cue(cue)`.
 */

/** A UI sound event. One-to-one with the first three `AudioCue` names in
 *  `src/art/audio` (`bank.ts`), so the platform wires the seam straight through.
 *   - `press`   — a live control was pressed (the lightest tick).
 *   - `confirm` — the SIM confirmed a spend: a purchase or a repair landed.
 *   - `reject`  — a disabled control was pressed (the buzzer; no haptic twin). */
export type UiCue = 'press' | 'confirm' | 'reject';

/** The narrow seam a UI control calls to make a sound. The audio module decides
 *  the rest (sound, volume, ducking); the UI only names the event. */
export type UiSfx = (cue: UiCue) => void;

/** The silent seam — used when no audio module is wired (Node, the QA harness,
 *  a headless unit test), so a control is byte-for-byte unchanged when muted. */
export const NO_UI_SFX: UiSfx = () => {};
