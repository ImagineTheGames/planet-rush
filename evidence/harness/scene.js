/**
 * evidence/harness/scene.js — QA p11 render harness. OWNER: QA Manager.
 *
 * This is NOT game code and NOT a test. It is a QA instrument that renders the
 * SHIPPED game modules (src/sim `createWorld`/`step`, src/render `Renderer`,
 * src/bots brain) into a canvas so the QA Manager can photograph p11 states the
 * shipped CLIENT cannot currently reach through the boot path or a ?debug=1 seam:
 *   - ore abundance SCARCE vs RICH  (the offline boot never threads `abundance`,
 *     so `createWorld` defaults to STANDARD — the shipped client cannot select a
 *     level; there is no in-app knob yet, n1-05);
 *   - the enemy threat-red shot-tier ramp (no seam sets a bot's Power tier);
 *   - the besieged core+shield RING grammar with shields present (a fresh home
 *     has no shields and no seam grants one);
 *   - a bot re-siting off a contested field with its `brain.mineSite` intent
 *     readable (bots are not exposed on window.__planetRush).
 *
 * Every pixel is drawn by the real `Renderer`; every number returned is read
 * straight off the real `World`. The QA Manager LOOKS at each PNG and attests in
 * evidence/manifest.json. Served by `vite dev` (TS + @-aliases resolve on the
 * fly); driven by evidence/capture-p11.mjs via page.evaluate + screenshot.
 */
import { Application, Container, Text, Graphics } from 'pixi.js';
import {
  createWorld,
  step,
  ABUNDANCE,
  SHIP_WEAPON,
  TICK_DT,
  SPAWN_PROTECTION_S,
  WAVE_COUNT,
} from '/src/sim/index.ts';
import { Renderer } from '/src/render/index.ts';
import { createBots, botInputs } from '/src/bots/index.ts';
import { SHOT_TIER_COLORS } from '/src/art/vfx/shots.ts';
import { ShipClass, UpgradeTrack } from '/src/shared/types.ts';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1000);
const H = Number(params.get('h') ?? 1000);
const DPR = Number(params.get('dpr') ?? 2);

const app = new Application();
await app.init({ background: 0x0d1015, width: W, height: H, antialias: true, resolution: DPR, autoDensity: true });
document.body.appendChild(app.canvas);
app.ticker.stop(); // we render explicitly so a frame is a still, deterministic shot

const stage = new Container();
app.stage.addChild(stage);
const overlay = new Container(); // screen-space captions, unscaled, on top
app.stage.addChild(overlay);

const viewport = { width: W, height: H, originX: 0, originY: 0 };
const renderer = new Renderer(stage, viewport);

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

function clearOverlay() {
  overlay.removeChildren();
}
function label(text, x, y, { size = 20, color = 0xcfe8ff, mono = true } = {}) {
  const t = new Text({
    text,
    style: { fontFamily: mono ? 'monospace' : 'sans-serif', fontSize: size, fill: color, fontWeight: '600' },
  });
  t.x = x;
  t.y = y;
  overlay.addChild(t);
  return t;
}

/** Draw `world` then pan/zoom so world point `center` lands at screen centre at
 *  `scale` px/unit. Returns a world→screen projector for caption placement. */
function frame(world, center, scale, cameraTarget = 0) {
  renderer.draw(world, { cameraTarget, muzzles: [] });
  const root = stage.children[0]; // the Renderer's private worldRoot (its only child)
  root.x = -center.x;
  root.y = -center.y;
  stage.scale.set(scale);
  stage.x = W / 2;
  stage.y = H / 2;
  return (p) => ({ x: W / 2 + scale * (p.x - center.x), y: H / 2 + scale * (p.y - center.y) });
}
function render() {
  app.renderer.render(app.stage);
}

// ---------------------------------------------------------------------------
// Scene: ore abundance — SCARCE (shipped default) vs RICH, same seed & map
// ---------------------------------------------------------------------------
const ABUNDANCE_SEED = 20250728;
function abundanceWorld(level) {
  return createWorld({
    seed: ABUNDANCE_SEED,
    players: Array.from({ length: 8 }, (_, i) => ({ id: i, shipClass: ShipClass.Vanguard })),
    abundance: level, // 'scarce' | 'standard' | 'rich'
  });
}
function abundance(level) {
  const world = abundanceWorld(level);
  const totalOre = world.asteroids.reduce((s, a) => s + a.ore, 0);
  const c = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  const scale = (Math.min(W, H) * 0.96) / world.bounds.width;
  clearOverlay();
  frame(world, c, scale, 0);
  const isScarce = level === 'scarce';
  label(`ABUNDANCE: ${level.toUpperCase()}${isScarce ? '   (p11 default)' : ''}`, 22, 18, {
    size: 30,
    color: isScarce ? 0xffd23f : 0xcfe8ff,
  });
  const m = ABUNDANCE[level];
  label(`multipliers  totalOre ×${m.totalOre}   density ×${m.density}   respawn ×${m.respawnInterval}`, 22, 58, { size: 19 });
  label(`field now    ${world.asteroids.length} rocks   ${Math.round(totalOre)} ore total   (economy.abundance = ${world.economy.abundance})`, 22, 84, { size: 19 });
  render();
  return {
    level,
    rocks: world.asteroids.length,
    totalOre: Math.round(totalOre),
    econ: world.economy.abundance,
    fieldYield: Math.round(world.economy.fieldYield),
    homeCount: world.economy.homeCount,
    asteroidsPerWave: world.economy.asteroidsPerWave,
  };
}

// ---------------------------------------------------------------------------
// Scene: siege RING grammar — owner-colour ring, red grows as core drops, a
// shield layer that reddens and dies BEFORE the core starts.
// ---------------------------------------------------------------------------
function siege(shieldHp, shieldMax, coreHp, frameLabel = '') {
  const world = createWorld({
    seed: 3,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
    bounds: { width: 2000, height: 2000 },
    asteroidCount: 0,
  });
  const planet = world.planets.find((p) => p.owner === 0);
  // Centre the home and shove its ship off-screen so the shot is just the ring.
  planet.pos = { x: 1000, y: 1000 };
  planet.spawnProtect = 0;
  planet.sinceDamage = 999;
  planet.coreHp = coreHp;
  planet.shields = shieldMax > 0 ? [{ id: 1, hp: shieldHp, maxHp: shieldMax, radius: planet.radius + 30 }] : [];
  for (const s of world.ships) s.pos = { x: -9000, y: -9000 };

  const c = { x: planet.pos.x, y: planet.pos.y };
  const outerR = planet.radius + 30 + 8; // shield ring + margin
  const scale = (Math.min(W, H) * 0.32) / outerR; // leave a top band for the caption
  clearOverlay();
  frame(world, { x: c.x, y: c.y - 40 / scale }, scale, 0); // nudge ring down; viewer=0 → own ring, no sensor gate
  const shieldTxt = shieldMax > 0 ? `${shieldHp}/${shieldMax}` : 'gone';
  if (frameLabel) label(frameLabel, 26, 24, { size: 26, color: 0xffffff });
  label(`shield ${shieldTxt}`, 26, 60, { size: 22, color: shieldMax > 0 && shieldHp > 0 ? 0x9fc7ff : 0xff6a5a });
  label(`core   ${Math.round(planet.coreHp)}/${planet.maxCoreHp}`, 26, 90, {
    size: 22,
    color: planet.coreHp >= planet.maxCoreHp ? 0x9fc7ff : 0xff6a5a,
  });
  render();
  return { coreHp: planet.coreHp, maxCoreHp: planet.maxCoreHp, shieldHp: shieldMax > 0 ? shieldHp : 0, shieldMax };
}

// ---------------------------------------------------------------------------
// Scene: shot-tier colour ramp — own (plasma) and enemy (threat-red) families,
// tiers 0/1/2, in one frame. Teams make 0/1/2 all allies (own) or all enemies.
// ---------------------------------------------------------------------------
function shots() {
  const world = createWorld({
    seed: 9,
    players: [
      // Viewer's team (own → plasma family), one ship per DAMAGE tier.
      { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
      { id: 1, shipClass: ShipClass.Vanguard, team: 0 },
      { id: 2, shipClass: ShipClass.Vanguard, team: 0 },
      // Enemy team (enemy → threat-red family), one ship per DAMAGE tier.
      { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
      { id: 4, shipClass: ShipClass.Vanguard, team: 1 },
      { id: 5, shipClass: ShipClass.Vanguard, team: 1 },
    ],
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  for (const s of world.ships) s.pos = { x: -9000, y: -9000 }; // hide hulls; show only shots
  for (const pl of world.planets) pl.pos = { x: -9000, y: -9000 }; // hide homes + halos too
  // Owner i wears Power tier (i % 3). shotTier() reads owner.tiers[Power].
  const tierOf = (id) => id % 3;
  for (const s of world.ships) s.tiers[UpgradeTrack.Power] = tierOf(s.id);

  const rad = (SHIP_WEAPON && SHIP_WEAPON.radius) || 5;
  const cx = 2000;
  const cy = 2000;
  const dx = 90; // world-unit spacing between tiers
  const dy = 120; // between families
  world.projectiles.length = 0;
  const shooters = [
    { id: 0, row: 0, col: 0 },
    { id: 1, row: 0, col: 1 },
    { id: 2, row: 0, col: 2 },
    { id: 3, row: 1, col: 0 },
    { id: 4, row: 1, col: 1 },
    { id: 5, row: 1, col: 2 },
  ];
  const centers = {};
  for (const sh of shooters) {
    const pos = { x: cx + (sh.col - 1) * dx, y: cy + (sh.row - 0.5) * dy };
    centers[sh.id] = pos;
    world.projectiles.push({
      id: sh.id + 1,
      active: true,
      owner: sh.id,
      pos: { x: pos.x, y: pos.y },
      vel: { x: 0, y: 0 },
      damage: 10,
      radius: rad,
      life: 5,
      kind: 'ship',
    });
  }
  const c = { x: cx, y: cy };
  const scale = 3.4;
  clearOverlay();
  const project = frame(world, c, scale, 0); // viewer = player 0
  // Captions under each shot + family labels.
  const ownCols = SHOT_TIER_COLORS.own;
  const enCols = SHOT_TIER_COLORS.enemy;
  const screenCenters = {};
  for (const sh of shooters) {
    const sp = project(centers[sh.id]);
    screenCenters[sh.id] = { x: Math.round(sp.x), y: Math.round(sp.y) };
    const t = tierOf(sh.id);
    label(`tier ${t}`, sp.x - 26, sp.y + 30, { size: 18, color: sh.row === 0 ? ownCols[t] : enCols[t] });
  }
  label('OWN fire — plasma family', project({ x: cx - dx, y: cy - 0.5 * dy }).x - 30, project({ x: cx, y: cy - 0.5 * dy }).y - 70, {
    size: 20,
    color: ownCols[3],
  });
  label('ENEMY fire — threat-red family', project({ x: cx - dx, y: cy + 0.5 * dy }).x - 30, project({ x: cx, y: cy + 0.5 * dy }).y + 60, {
    size: 20,
    color: enCols[3],
  });
  label('DAMAGE-tier shot ramp (p11-06): brighter = stronger', 22, 18, { size: 22 });
  render();
  return {
    ownColors: ownCols.slice(0, 3).map(hex),
    enemyColors: enCols.slice(0, 3).map(hex),
    screenCenters, // {id:{x,y}} in CSS px — the capture script samples the PNG here
    dpr: DPR,
  };
}

// ---------------------------------------------------------------------------
// Scene: bot re-site — the deterministic p11 resite.test.ts "driven end to end"
// scenario, rendered. A bot on a contested field (east, a hostile parked on its
// approach) re-sites to a clean field (west) and arrives. brain.mineSite is the
// bot's committed target, read live each step.
// ---------------------------------------------------------------------------
let RS = null;
function resiteInit() {
  const world = createWorld({
    seed: 7,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard }, // the BOT we watch
      { id: 1, shipClass: ShipClass.Hauler }, // the parked hostile on the near path
    ],
    bounds: { width: 2400, height: 2400 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.match.wavesSpawned = WAVE_COUNT;
  const self = world.ships[0];
  const threat = world.ships[1];
  self.pos = { x: 1200, y: 1200 };
  self.vel = { x: 0, y: 0 };
  self.hull = self.maxHull * 0.25;
  self.spawnProtect = 0;
  const A = { x: 1730, y: 1200 }; // contested (east)
  const B = { x: 670, y: 1200 }; // clean (west)
  const threatPos = { x: 1680, y: 1200 };
  world.planets[0].pos = { x: 220, y: 220 };
  world.planets[1].pos = { x: threatPos.x, y: threatPos.y };
  for (const planet of world.planets) {
    planet.spawnProtect = 0;
    planet.sinceDamage = 999;
  }
  const [bot] = createBots([{ id: 0, personality: 'sable' }], { seed: 7 });
  RS = { world, bot, self, threat, A, B, threatPos, minA: 1e9, minB: 1e9, ticks: 0 };
  return { A, B, threatPos, selfStart: { ...self.pos } };
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
function resiteStep(n) {
  const { world, bot, self, threat, A, B, threatPos } = RS;
  for (let i = 0; i < n; i++) {
    world.asteroids.length = 0;
    world.asteroids.push(
      { id: 100, pos: { ...A }, radius: 34, ore: 10, maxOre: 10, crackStage: 0, mineBuffer: 0, home: null },
      { id: 200, pos: { ...B }, radius: 34, ore: 10, maxOre: 10, crackStage: 0, mineBuffer: 0, home: null },
    );
    threat.pos = { ...threatPos };
    threat.vel = { x: 0, y: 0 };
    threat.hull = threat.maxHull;
    threat.spawnProtect = 0;
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);
    RS.minA = Math.min(RS.minA, dist(self.pos, A));
    RS.minB = Math.min(RS.minB, dist(self.pos, B));
    RS.ticks++;
  }
  // Frame it wide enough to hold both fields and the bot between them.
  const c = { x: 1200, y: 1200 };
  const scale = 0.72;
  clearOverlay();
  const project = frame(world, c, scale, 0); // camera on the bot (player 0)
  const pA = project(A);
  const pB = project(B);
  const pS = project(self.pos);
  const g = new Graphics();
  g.circle(pA.x, pA.y, 26).stroke({ width: 2, color: 0xff5a4d, alpha: 0.9 });
  g.circle(pB.x, pB.y, 26).stroke({ width: 2, color: 0x6ad46a, alpha: 0.9 });
  overlay.addChild(g);
  const site = bot.brain.mineSite;
  label(`t = ${(RS.ticks * TICK_DT).toFixed(1)}s    brain.mineSite = ${site}${site === 200 ? ' → field B (clean)' : site === 100 ? ' → field A (contested)' : ''}`, 20, 14, {
    size: 18,
  });
  label(`dist→A ${Math.round(dist(self.pos, A))}   dist→B ${Math.round(dist(self.pos, B))}   min-ever A ${Math.round(RS.minA)} / B ${Math.round(RS.minB)}`, 20, 40, { size: 15 });
  label(`A: contested`, pA.x - 74, pA.y - 50, { size: 15, color: 0xff8a80 });
  label(`(hostile on path)`, pA.x - 74, pA.y - 30, { size: 13, color: 0xff8a80 });
  label(`B: re-site target`, pB.x - 30, pB.y - 50, { size: 15, color: 0x9be49b });
  label(`bot`, pS.x - 12, pS.y - 34, { size: 15, color: 0xcfe8ff });
  render();
  return {
    t: +(RS.ticks * TICK_DT).toFixed(2),
    mineSite: site,
    lastBehavior: bot.brain.lastBehavior,
    distA: Math.round(dist(self.pos, A)),
    distB: Math.round(dist(self.pos, B)),
    minA: Math.round(RS.minA),
    minB: Math.round(RS.minB),
    selfPos: { x: Math.round(self.pos.x), y: Math.round(self.pos.y) },
  };
}

window.__qa = {
  ready: true,
  shotTierColors: { own: SHOT_TIER_COLORS.own.map(hex), enemy: SHOT_TIER_COLORS.enemy.map(hex) },
  abundance,
  siege,
  shots,
  resiteInit,
  resiteStep,
};
