/**
 * evidence/a0-74-viewport/profiles.ts — the screens the three reports are about.
 * OWNER: UI Engineer (a0-74).
 *
 * Every number here is either a screen the developer named, a profile QA's own
 * `DEVICE_MATRIX` already carries, or one of the three aspect ratios the brief's
 * Definition of Done asks for by name (16:9, 21:9, 32:9). Nothing is invented to
 * make a point.
 */

export interface Profile {
  /** File-safe id — used for the screenshot names and the audit rows. */
  readonly id: string;
  /** What it is, in words, for the audit. */
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
}

/**
 * The **view-width** profiles: what a desktop player sees against what a phone
 * player sees. The desktop is the developer's own session (a0-70/a0-71 pinned it
 * at 1707×898); the phones are QA's matrix profiles held in landscape, which is
 * how the game is played under the orientation lock.
 */
export const VIEW_PROFILES: readonly Profile[] = [
  { id: 'desktop-1707x898', label: "desktop — the developer's own session", width: 1707, height: 898, dpr: 1, touch: false },
  { id: 'desktop-1280x800', label: 'desktop — the golden suite\'s control', width: 1280, height: 800, dpr: 1, touch: false },
  { id: 'phone-798x384', label: 'phone landscape — the size named in the report', width: 798, height: 384, dpr: 3, touch: true },
  { id: 'phone-844x390', label: 'phone landscape — iPhone profile (DEVICE_MATRIX)', width: 844, height: 390, dpr: 3, touch: true },
  { id: 'phone-portrait-390x844', label: 'phone PORTRAIT held — landscape-locked to 844×390', width: 390, height: 844, dpr: 3, touch: true },
];

/**
 * The **HUD-fit** profiles: the three aspect ratios the DoD names. 1920×1080 is
 * 16:9 (the control — the content box is the whole viewport there and nothing
 * moves), 2560×1080 is 21:9 and 3840×1080 is 32:9.
 *
 * All three share a height on purpose. The content box's cap is an aspect, so a
 * fixed height makes the box the *same* 1920 px in all three and the only thing
 * that changes between the frames is how much world is either side of it — which
 * is exactly the claim the screenshots have to settle.
 */
export const FIT_PROFILES: readonly Profile[] = [
  { id: 'fit-16x9-1920x1080', label: '16:9 — the control', width: 1920, height: 1080, dpr: 1, touch: false },
  { id: 'fit-21x9-2560x1080', label: '21:9 ultrawide', width: 2560, height: 1080, dpr: 1, touch: false },
  { id: 'fit-32x9-3840x1080', label: '32:9 super-ultrawide', width: 3840, height: 1080, dpr: 1, touch: false },
];
