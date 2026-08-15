/**
 * a0-46 — what the laser bolt costs the shot layer, on the GDD §4.3 scene.
 *
 * The brief asks for two numbers and one claim:
 *
 *  - **draw calls should not move.** The brief's expectation, and it is nearly
 *    right: the layer is still one pooled `Sprite` per live shot over a texture
 *    keyed `${family}:${tier}`, still eight textures, still one batch. But the
 *    submitted COUNT does move, **66 → 99** on the desktop window, and the
 *    reason is the point of the change rather than a regression: the cull's
 *    reach grew with the extent, so a shot 40 radii outside the window — which
 *    on main could not contribute a pixel — is now painting its tail across it.
 *    Culling those would be the screen-edge pop `cull.ts` exists to prevent.
 *    Measured rather than assumed, because "cannot move" is what a1-09 said
 *    about the atlas.
 *  - **overdraw, before and after.** The bolt's quad is much larger than the
 *    disc's: a shot's texture is `2 · extent · SHOT_ART_SCALE` px, and `extent`
 *    went 1.48 → 11.672. That is the real cost of this change and it belongs in
 *    a number rather than in a shrug.
 *
 * Method. The scene is `stressWorld()` — 300 seeded projectiles, the §4.3
 * budget line — rendered headless through the real `Renderer` at the desktop
 * gate's 1280×800 window. Headless the baker returns a blank `TextureSource` of
 * exactly the size the browser would bake, so every quad below is the size it
 * has on screen (this is the same property `cull.test.ts` leans on). "Overdraw"
 * here is **quad area submitted ÷ viewport area** for the shots layer: how many
 * times over the layer covers the screen, counting transparent texels, which is
 * what the fragment stage actually pays for on a `blendMode = 'add'` layer.
 *
 * BEFORE is computed rather than rendered, from the sprite `main` shipped —
 * `circle(0, 0, halo)` over `circle(0, 0, 0.62)` at `halo = 1 + tier · 0.16` —
 * pushed through the renderer's own quad arithmetic, over main's own cull reach
 * on the same world and window. That arithmetic is not asserted: `measure()`
 * recovers each submitted shot's rung by matching its LIVE quad against the same
 * formula and throws if any is off by more than a hundredth of a pixel, so every
 * before-number here comes from a rule proven on this build.
 *
 * Run: npx vite-node evidence/a0-46-pierce-laser-shot/overdraw.ts
 */
import { Container } from 'pixi.js';
import { stressWorld, STRESS_SCENE } from '../../harness/perf';
import { Renderer } from '../../src/render';
import { shotSprite, SHOT_FAMILIES, SHOT_TIERS } from '../../src/art/vfx/shots';
import type { Viewport } from '../../src/platform/camera';

/** The desktop gate's window (GDD §4.3). */
const DESKTOP: Viewport = { width: 1280, height: 800, originX: 0, originY: 0 };
/** The landscape-phone profile from the same config — the tighter gate. */
const PHONE: Viewport = { width: 844, height: 390, originX: 0, originY: 0 };

/** `src/render/index.ts` — the shot layer's bake density and the bake margin. */
const SHOT_ART_SCALE = 16;
const BAKE_MARGIN = 1.08;

/** The renderer's own quad arithmetic: `lookUnits` bakes at `2 · extent · px`
 *  and `CenteredBaker` frames it to `ceil(size · margin / 2) · 2` texels, then
 *  the sprite scales by `radius / px`. */
function quadSide(extent: number, radius: number): number {
  const size = 2 * extent * SHOT_ART_SCALE;
  const texels = Math.ceil((size * BAKE_MARGIN) / 2) * 2;
  return (texels * radius) / SHOT_ART_SCALE;
}

/** main's shot sprite, for the BEFORE column: a soft halo over a bright core,
 *  the halo growing a fifth per DAMAGE rung. Only its extent matters here. */
const beforeExtent = (tier: number): number => 1 + Math.min(Math.max(tier, 0), 3) * 0.16;

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  console.log(s);
};

say('a0-46 — shot-layer fill, before and after the laser bolt');
say('='.repeat(70));
say(`scene: stressWorld() — ${STRESS_SCENE.projectiles} seeded projectiles (GDD §4.3)`);
say('');
say('sprite extent, per DAMAGE rung (unit space; 1 = the collision radius)');
say('  rung       before      after      quad px @ r=4 (before → after)');
for (const tier of SHOT_TIERS) {
  const b = beforeExtent(tier);
  const a = shotSprite('own', tier).extent;
  say(
    `  Mk ${['I', 'II', 'III', 'IV'][tier]!.padEnd(4)}   ${b.toFixed(3).padStart(7)}   ${a.toFixed(3).padStart(8)}      ` +
      `${quadSide(b, 4).toFixed(1)}² → ${quadSide(a, 4).toFixed(1)}²  ` +
      `(×${((quadSide(a, 4) / quadSide(b, 4)) ** 2).toFixed(1)} area)`,
  );
}
say('');

/** One submitted shot, as the frame sees it. The RUNG is recovered from the
 *  measured quad rather than recomputed: `shotTier` is private to the renderer,
 *  and matching the quad against each rung's own arithmetic proves the formula
 *  on the same run it is used in. */
interface Submitted {
  readonly radius: number;
  readonly side: number;
  readonly tier: number;
}

function measure(viewport: Viewport): { shots: Submitted[]; world: ReturnType<typeof stressWorld> } {
  const stage = new Container();
  const world = stressWorld();
  new Renderer(stage, viewport).draw(world, { cameraTarget: 0, muzzles: [] });
  const layer = stage.getChildByLabel('shots', true) as Container;

  const shots: Submitted[] = [];
  layer.children.forEach((child, i) => {
    if (!child.visible) return;
    const c = child as Container;
    const side = c.getLocalBounds().width * Math.abs(c.scale.x);
    const radius = world.projectiles[i]!.radius;
    let tier = 0;
    let best = Infinity;
    for (const t of SHOT_TIERS) {
      const err = Math.abs(quadSide(shotSprite('own', t).extent, radius) - side);
      if (err < best) {
        best = err;
        tier = t;
      }
    }
    if (best > 0.01) throw new Error(`quad ${side} matches no rung (radius ${radius})`);
    shots.push({ radius, side, tier });
  });
  return { shots, world };
}

for (const [name, vp] of [
  ['desktop 1280×800', DESKTOP],
  ['phone 844×390', PHONE],
] as const) {
  const { shots, world } = measure(vp);
  const screen = vp.width * vp.height;
  // The cull's reach grew with the extent, so the submitted COUNT moves too — a
  // shot 40 radii off the edge is now painting its tail on screen where before
  // it could contribute nothing. Count what main's 1.48 would have kept, from
  // the same world and the same window, so the draw-call claim is measured and
  // not assumed.
  const target = world.ships.find((s) => s.id === 0)!;
  const box = {
    left: target.pos.x - vp.width / 2,
    right: target.pos.x + vp.width / 2,
    top: target.pos.y - vp.height / 2,
    bottom: target.pos.y + vp.height / 2,
  };
  let beforeCull = 0;
  for (const p of world.projectiles) {
    if (!p.active) continue;
    const reach = p.radius * 1.48 * 1.08;
    if (
      p.pos.x + reach >= box.left && p.pos.x - reach <= box.right &&
      p.pos.y + reach >= box.top && p.pos.y - reach <= box.bottom
    ) {
      beforeCull++;
    }
  }
  // Priced over the shots MAIN would have submitted, at main's own quad size —
  // the honest before, not this branch's larger set re-priced.
  const before = beforeCull * quadSide(beforeExtent(0), 4) ** 2;
  const after = shots.reduce((sum, s) => sum + s.side ** 2, 0);
  // The scene's seeded shots all fire at the base rung. The ceiling matters more
  // than the sample, so price the same set at Mk IV as well.
  const ceiling = shots.reduce((sum, s) => sum + quadSide(shotSprite('own', 3).extent, s.radius) ** 2, 0);
  const rungs = SHOT_TIERS.map((t) => shots.filter((s) => s.tier === t).length).join('/');

  say(name);
  say(
    `  shots submitted (= this layer's draw-call contribution): ` +
      `${beforeCull} → ${shots.length}, of ${STRESS_SCENE.projectiles} live`,
  );
  say(`  rungs on screen (Mk I/II/III/IV): ${rungs}`);
  if (shots.length === 0) {
    say('  nothing on screen — the §4.3 scene seeds its shots around the eight-station');
    say('  ring, and none fall inside this window from ship 0. No fill either way.');
    say('');
    continue;
  }
  say(`  quad area   before ${(before / 1e3).toFixed(1)}k px²    after ${(after / 1e3).toFixed(1)}k px²`);
  say(
    `  OVERDRAW    before ${(before / screen).toFixed(4)}×   after ${(after / screen).toFixed(4)}×` +
      `   (×${(after / before).toFixed(1)})`,
  );
  say(
    `  ...if every one of them were Mk IV: ${(ceiling / screen).toFixed(4)}× ` +
      `(${(ceiling / 1e3).toFixed(1)}k px²)`,
  );
  say('');
}

say('families × rungs baked (the pool, unchanged): ' + SHOT_FAMILIES.length * SHOT_TIERS.length);
