/**
 * evidence/a0-99-wheel-and-hud/profiles.ts — the two screens a0-99 has to be
 * looked at on. OWNER: QA Manager (a0-99).
 *
 * Deliberately the SAME two profiles a0-96 used, unchanged, so that a finding
 * here and a finding there are comparable rather than two different rulers: the
 * phone is the developer's own screenshot size (798x384 landscape, the narrowest
 * supported width) and the desktop is the golden suite's control width.
 *
 * `dpr: 2` on both. These frames exist to be READ — five wedge labels, four
 * lines per wedge, an ore counter and a controls strip — and a 1x desktop frame
 * is a frame whose numbers have to be taken on trust.
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
