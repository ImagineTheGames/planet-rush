import { it } from 'vitest';
import { turretSprite, shieldSprite, type TurretState } from '/lanes/lane-1/src/art/buildings';
import { shipSprite } from '/lanes/lane-1/src/art/ships';
import { shotSprite, SHOT_MAX_TIER } from '/lanes/lane-1/src/art/vfx/shots';
import { asteroidSprite } from '/lanes/lane-1/src/art/asteroids';
import { ShipClass } from '/lanes/lane-1/src/shared/types';

it('prints', () => {
  let t = 0;
  for (let owner = 0; owner < 8; owner++)
    for (let tier = 0; tier <= 3; tier++)
      for (const st of ['idle', 'tracking', 'firing', 'building'] as TurretState[])
        t = Math.max(t, turretSprite({ playerId: owner, state: st, tier }).extent);
  console.log('TURRET max extent', t);

  let sh = 0;
  for (const c of Object.values(ShipClass)) {
    if (typeof c !== 'number' && typeof c !== 'string') continue;
    try { sh = Math.max(sh, shipSprite({ shipClass: c as never, playerId: 0 }).extent); } catch (e) { /* */ }
  }
  console.log('SHIP max extent', sh, 'classes', Object.values(ShipClass));

  let s = 0;
  for (let tier = 0; tier <= SHOT_MAX_TIER; tier++) for (const f of ['own','enemy'] as const) s = Math.max(s, shotSprite(f, tier).extent);
  console.log('SHOT max extent', s, 'SHOT_MAX_TIER', SHOT_MAX_TIER);

  let a = 0;
  for (let seed = 0; seed < 60; seed++) for (let stage = 0; stage <= 2; stage++) a = Math.max(a, asteroidSprite({ seed, crackStage: stage, richness: 0.5 }).extent);
  console.log('ROCK max extent', a);

  let sb = 0;
  for (const strength of ['full','weakened','failing'] as const)
    for (let stack = 0; stack < 2; stack++)
      sb = Math.max(sb, shieldSprite({ playerId: 0, strength, stackIndex: stack, gauge: false }).extent);
  console.log('SHIELD max extent', sb);
});
