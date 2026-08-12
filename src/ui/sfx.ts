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

/** A UI sound event. One-to-one with `AudioCue` names in `src/art/audio`
 *  (`bank.ts`), so the platform wires the seam straight through.
 *   - `press`   — a live control was pressed (the lightest tick).
 *   - `confirm` — the SIM confirmed a spend: a purchase or a repair landed.
 *   - `reject`  — a disabled control was pressed (the buzzer; no haptic twin).
 *   - `detent`  — a SELECTION stepped one notch: the build wheel's thumb crossing
 *     a wedge boundary (u16-01), the same event a menu row or a lobby seat
 *     already fires. Nothing was pressed and nothing was bought, which is why it
 *     is its own cue and not a quiet press.
 *
 * `detent` was in the ratified bank long before this seam carried it — one note,
 * an octave above the click, fixed pitch and deliberately UNDETUNED because "a
 * wobbling detent reads as a fault" (`src/art/audio/ui-cues.ts`, the handoff's
 * own audio table). The developer's standing ruling is *"modern/sci-fi and not
 * retro/toony"*, and this adds no sound: it calls one that was already ratified,
 * already mixed and already used by three other selections in the game. */
export type UiCue = 'press' | 'confirm' | 'reject' | 'detent';

/** The narrow seam a UI control calls to make a sound. The audio module decides
 *  the rest (sound, volume, ducking); the UI only names the event. */
export type UiSfx = (cue: UiCue) => void;

/** The silent seam — used when no audio module is wired (Node, the QA harness,
 *  a headless unit test), so a control is byte-for-byte unchanged when muted. */
export const NO_UI_SFX: UiSfx = () => {};
