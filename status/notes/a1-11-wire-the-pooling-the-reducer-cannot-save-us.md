# a1-11-wire-the-pooling-the-reducer-cannot-save-us.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

**Read `status/notes/a1-10-the-pooling-that-never-pooled.md` first.** a1-11 is
the follow-up it recommended (§6 B), with the golden constraint lifted.

## BUILT
<!-- what is actually finished, with the commit that did it -->

Branch `agent/platform/a1-11-wire-atlas-pooling`, cut from `main` @ `7465d70`,
with `origin/agent/platform/a1-10-atlas-pooling-measured` merged in for the
instrument (PR #372 is still open, so the rig is not on main and the DoD needs
the before/after on the *same* rig).

In progress — see NEXT.

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The two decisions a1-10 said this brief had to take, taken:**

1. **The bake resolution.** Bake each look at exactly the pixels-per-unit the
   direct path already rasterised at (`ROCK_ART_SCALE` 64, `TURRET_ART_SCALE` 48,
   `SHOT_ART_SCALE` 16), i.e. `size = round(2 · extent · ART_SCALE)`, and set the
   sprite's scale to `2 · extent · radius / size` — which is *exactly* the
   `radius / ART_SCALE` the Graphics path used. Every entity is therefore
   **minified**, never magnified: a rock is 128 texture px for at most 92 screen
   px (`ASTEROID.maxRadius` 46), a turret 110 for 24, a shot ~80 for ~10. The
   device pixel ratio rides on the cache's `resolution` (capped at 2, the same
   cap `main.ts` already uses for the VFX cache).
2. **The headless render tests keep their headlessness, and there is still only
   ONE draw path.** `Renderer` always draws pooled `Sprite`s. What is injected is
   the *baker*: production passes `app.renderer`, and with no baker the renderer
   bakes correctly-sized **blank** textures (`TextureSource` is pure JS — no
   WebGL). So CI asserts the scene graph it ships — same node count, same
   positions, same scales, same visibility — and only the pixels are absent,
   which is the one thing a headless suite never asserted anyway. The pixels are
   asserted by the Playwright goldens, on the real bundle. That is deliberately
   *not* the "two paths, CI tests one and players see the other" failure a1-10
   refused (`8ae9121`).

**A third decision a1-10 did not see: the bake must be FRAMED.**
`SpriteTextureCache` bakes with `generateTexture({target})`, which crops to the
target's local bounds — so the texture is centred on the art's *bounding box*,
not on its origin, and a rock whose silhouette is not symmetric would be drawn
~1 px off where it collides. `src/render/` wraps the baker and passes an explicit
symmetric `frame` (plus 8% margin so a stroke that overhangs its declared extent
is not clipped). That is a wrapper around Art's cache, not an edit to it.

**What could NOT be wired through `src/art/atlas.ts`, and why.**

- **Rocks go through `atlas.asteroidTexture`** — it is exactly right.
- **Turrets do not.** `atlas.turretTexture(cache, owner, state, size)` has no
  `tier`, so it would key every Mk I/II/III barrel onto the Mk I silhouette —
  a *visible* regression, which this brief forbids outright. The turret and
  scaffold keys therefore live in `src/render/` and mirror the atlas's own
  discipline. **Recommended to Art: add `tier` to `turretTexture`.**
- **Shots do not.** `atlas.ts` has no shot entry at all; `shotSprite` lives in
  `src/art/vfx/shots.ts`. **Recommended to Art: `shotTexture(cache, family,
  tier, size)`.**
  `src/art/atlas.ts` is the Art agent's file and was not edited.

**Not in scope, deliberately:** ships, stations, beacons, damage rings, shields,
ore chunks. a1-10 §6B costs those separately (they would take the frame from ~34
draw calls to ~10); the brief names rocks, turrets and shots and nothing else.
The VFX layer (a2-07) and the reducer's behaviour (r9-01) are untouched.

## NEXT
<!-- what remains, in order, and anything blocking -->

1. Wire the three layers in `src/render/index.ts`; inject the baker in `main.ts`.
2. `npx tsc --noEmit`, `npm test -- --run`.
3. Re-measure on the a1-10 rig; re-baseline the goldens in the container.
4. Doc + PR with the before/after table and the per-image justification.

Nothing is blocked.
