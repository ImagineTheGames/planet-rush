/**
 * evidence/a0-100c-settings-two-places-only/profiles.ts — the two screens the
 * brief asks for. OWNER: UI Engineer (a0-100c).
 *
 * "The doors screen before and after, on a phone and a desktop" is two claims,
 * so there are exactly two profiles, and both are the ones a0-100b used one
 * brief ago rather than widths chosen to flatter a frame: the phone is the
 * developer's own screenshot size (798x384 landscape, the narrowest width
 * supported), and the desktop is the golden suite's control width.
 *
 * `dpr: 2` on both, because the finding here is about a FOOTER BEAM — what is
 * on it, and what the beam looks like once one plate is gone. A 1x frame is a
 * frame whose plate edges have to be taken on trust.
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
