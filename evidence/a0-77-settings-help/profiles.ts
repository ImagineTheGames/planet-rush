/**
 * evidence/a0-77-settings-help/profiles.ts — the screens a0-77 has to hold up on.
 * OWNER: UI Engineer (a0-77).
 *
 * Three, and the brief names all three: the phone in the developer's screenshot
 * (798×384 landscape — the tightest supported width and the whole reason the `?`
 * leads the row rather than trailing it), a portrait phone (which the landscape
 * lock rotates to 844×390, so the settings screen wraps into two columns), and a
 * desktop width. Nothing is invented to make a point; the desktop is the golden
 * suite's own control profile.
 */

export interface Profile {
  /** File-safe id — the screenshot names and the audit rows use it. */
  readonly id: string;
  /** What it is, in words, for the audit. */
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
  /** The logical viewport the screen lays out in, after the landscape lock. A
   *  portrait phone is rotated, so the model sees its axes swapped — stated here
   *  because the audit's numbers are logical and its frames are physical. */
  readonly logical: { readonly width: number; readonly height: number };
}

export const PROFILES: readonly Profile[] = [
  {
    id: 'phone-landscape-798x384',
    label: "phone landscape 798×384 — the developer's screenshot, the narrowest supported width",
    width: 798,
    height: 384,
    dpr: 3,
    touch: true,
    logical: { width: 798, height: 384 },
  },
  {
    id: 'phone-portrait-390x844',
    label: 'phone PORTRAIT held — landscape-locked, so the screen lays out at 844×390',
    width: 390,
    height: 844,
    dpr: 3,
    touch: true,
    logical: { width: 844, height: 390 },
  },
  {
    id: 'desktop-1280x800',
    label: "desktop 1280×800 — the golden suite's control width",
    width: 1280,
    height: 800,
    dpr: 1,
    touch: false,
    logical: { width: 1280, height: 800 },
  },
];
