/**
 * evidence/a0-104-follow-the-arrow/profiles.ts — the two screens a0-104 is
 * looked at on. OWNER: UI Engineer (a0-104).
 *
 * The same two profiles a0-99 used, unchanged and for that reason: this brief
 * exists because of a0-99's pair of frames, and a re-capture on a different
 * ruler is not a re-capture. The phone is the developer's own screenshot size
 * (798x384 landscape, the narrowest width anyone has photographed this HUD at)
 * and the desktop is the golden suite's control width. `dpr: 2` on both, because
 * these frames exist to be READ — the finding is one sentence in the band and
 * one triangle on an edge.
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
