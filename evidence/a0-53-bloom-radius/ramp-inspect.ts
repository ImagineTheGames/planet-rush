/**
 * evidence/a0-53-bloom-radius/ramp-inspect.ts — **what does the ramp texture
 * actually look like, inside the process drawing the frame?** OWNER: Art Agent.
 *
 * `rampMatrix` divides by the literal `RAMP_SIZE` (256) while Pixi normalises the
 * matrix it is handed by the texture's OWN reported size. If those two ever
 * disagree — a different `resolution` on the source, a frame that is not the
 * whole texture — the halo is laid out over the wrong number of pixels and every
 * model test still passes, because the model never sees a texture.
 *
 * Read out of the booted client and out of the field probe: 256², resolution 1,
 * full frame, `uvs` 0..1, identical in both. That is what rules the texture out.
 */
import { falloffRamp } from '../../src/art/textures';

export function inspectRamp(): void {
  const out: Record<string, unknown> = {};
  for (const curve of ['halo', 'smooth'] as const) {
    const t = falloffRamp(curve) as unknown as {
      width: number;
      height: number;
      frame: { x: number; y: number; width: number; height: number };
      uvs: Record<string, number>;
      source: {
        width: number;
        height: number;
        pixelWidth: number;
        pixelHeight: number;
        resolution: number;
        autoGenerateMipmaps: boolean;
        scaleMode?: string;
        addressMode?: string;
      };
    };
    out[curve] = {
      texture: { w: t.width, h: t.height },
      frame: { x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height },
      uvs: t.uvs,
      source: {
        w: t.source.width,
        h: t.source.height,
        pixelW: t.source.pixelWidth,
        pixelH: t.source.pixelHeight,
        resolution: t.source.resolution,
        mipmaps: t.source.autoGenerateMipmaps,
        scaleMode: t.source.scaleMode,
        addressMode: t.source.addressMode,
      },
    };
  }
  (window as unknown as { __a0_53_ramp?: unknown }).__a0_53_ramp = out;
}
