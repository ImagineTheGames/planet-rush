/**
 * evidence/a0-123-fewer-blooms-loose-crosses/dump-field.ts — every star point in
 * the field, as JSON, for the byte-identity check. OWNER: Art Agent.
 *
 * Copied into a `main` worktree and run there by {@link ./audit.ts}, so the two
 * sides of the comparison are the two trees rather than one tree and a memory of
 * the other. It uses only backdrop API that exists on both.
 */
import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';

const dump = STAR_LAYERS.map((l) =>
  starFieldSprite(l, VOID_SEED, 2400, 1600)
    .shapes.filter((s) => s.path.kind === 'circle' && !s.fill?.falloff)
    .map((s) =>
      s.path.kind === 'circle'
        ? `${s.path.cx},${s.path.cy},${s.path.r},${s.fill!.alpha},${s.fill!.color}`
        : '',
    ),
);
// eslint-disable-next-line no-console
console.log(JSON.stringify(dump));
