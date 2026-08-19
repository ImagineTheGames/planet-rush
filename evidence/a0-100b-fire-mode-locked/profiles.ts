/**
 * evidence/a0-100b-fire-mode-locked/profiles.ts — the two screens the brief asks
 * for. OWNER: UI Engineer (a0-100b).
 *
 * "The locked row on a phone and a desktop" is two claims, so there are exactly
 * two profiles, and both are ones this repo already uses rather than widths
 * chosen to flatter a frame: the phone is the developer's own screenshot size
 * (798x384 landscape — the narrowest width supported, where the settings screen
 * wraps into two columns and the row is 372px wide), and the desktop is the
 * golden suite's control width.
 *
 * `dpr: 2` on both, because these frames exist to be READ: the finding is that a
 * dim label and a dim value are legible as *unavailable* before anybody presses
 * them, and a 1x frame is a frame whose greys have to be taken on trust.
 */
export interface Profile {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
}

export const PROFILES: readonly Profile[] = [
  {
    id: 'phone-798x384',
    label: "phone landscape 798x384 (dpr 2, touch) — the developer's own screenshot size",
    width: 798,
    height: 384,
    dpr: 2,
    touch: true,
  },
  {
    id: 'desktop-1280x800',
    label: "desktop 1280x800 (dpr 2, pointer) — the golden suite's control width",
    width: 1280,
    height: 800,
    dpr: 2,
    touch: false,
  },
];
