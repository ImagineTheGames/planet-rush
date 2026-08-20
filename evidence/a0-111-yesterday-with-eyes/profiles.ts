/**
 * evidence/a0-111-yesterday-with-eyes/profiles.ts — the two screens a0-111 has to
 * be looked at on. OWNER: QA Manager (a0-111).
 *
 * Deliberately the SAME two profiles a0-96 and a0-99 used, unchanged, so that a
 * finding here and a finding there are comparable rather than two different
 * rulers: the phone is the developer's own screenshot size (798x384 landscape,
 * the narrowest supported width) and the desktop is the golden suite's control
 * width.
 *
 * `dpr: 2` on both. These frames exist to be READ — four headlines and the
 * sentence under each, a settings row's chip, a browse list's two lines — and a
 * 1x desktop frame is a frame whose words have to be taken on trust.
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
