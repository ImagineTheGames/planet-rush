/**
 * evidence/a0-96-settings-screen/profiles.ts — the two screens a0-96 has to be
 * looked at on. OWNER: QA Manager (a0-96).
 *
 * The brief asks for "a phone-shaped viewport and a desktop one", so there are
 * exactly two, and both are profiles this repo already uses rather than widths
 * invented to make a point: the phone is the developer's own screenshot size
 * (798x384 landscape, the narrowest supported width, the one a0-77's `?` had to
 * survive), and the desktop is the golden suite's control width.
 *
 * `dpr: 2` on both: these frames exist to be READ — six labels, six values, and a
 * paragraph of help copy — and a 1x desktop frame is a frame whose words have to
 * be taken on trust.
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
