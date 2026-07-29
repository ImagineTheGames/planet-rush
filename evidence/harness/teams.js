/**
 * evidence/harness/teams.js — QA p14 TEAMS render harness. OWNER: QA Manager.
 *
 * NOT game code and NOT a test. A QA instrument that renders the SHIPPED game
 * modules (src/sim `createWorld`/`step`, src/render `Renderer`, src/sim
 * `allegiance`) so the QA Manager can photograph what a TEAMS 2v2 actually LOOKS,
 * AIMS, and SPAWNS like — states the shipped CLIENT cannot reach through real
 * input, because:
 *   - the offline boot (`src/platform/match-boot` + `src/main.ts`) does NOT thread
 *     the lobby's TEAMS/team config into the world build (main.ts line ~594: "their
 *     offline world-build wiring is Task C4 — Netcode — so only size takes effect
 *     here"). Offline is always FFA teams-of-one, whatever the lobby toggle says.
 *   - online (which WOULD honour teams via the server's `configToPlayers`) is not
 *     live (M3 deploy blockers).
 * So the only way to see the p14 CODE's own team output on screen is to hand
 * `createWorld` a team-stamped roster directly and render the real `Renderer`.
 *
 * Every pixel is drawn by the real `Renderer`; every number captioned is read off
 * the real `World`, and every colour swatch is the real `src/art/palette`
 * `playerColor`. The QA Manager LOOKS at each PNG and attests in the manifest.
 *
 * Served by `vite dev`; driven by evidence/capture-teams.mjs via page.evaluate +
 * screenshot. Query params: w,h,dpr (viewport / device pixel ratio).
 */
import { Application, Container, Text, Graphics } from 'pixi.js';
import { createWorld, step, TICK_DT, WAVE_COUNT, SPAWN_PROTECTION_S } from '/src/sim/index.ts';
import { teamOf, areEnemies, canDamage } from '/src/sim/allegiance.ts';
import { Renderer } from '/src/render/index.ts';
import { playerColor } from '/src/art/palette.ts';
import { SHOT_TIER_COLORS } from '/src/art/vfx/shots.ts';
import { ShipClass } from '/src/shared/types.ts';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1200);
const H = Number(params.get('h') ?? 800);
const DPR = Number(params.get('dpr') ?? 2);

const app = new Application();
await app.init({ background: 0x0d1015, width: W, height: H, antialias: true, resolution: DPR, autoDensity: true });
document.body.appendChild(app.canvas);
app.ticker.stop(); // explicit render — a frame is a deterministic still

const stage = new Container();
app.stage.addChild(stage);
const overlay = new Container(); // screen-space captions, unscaled, on top
app.stage.addChild(overlay);

const viewport = { width: W, height: H, originX: 0, originY: 0 };
const renderer = new Renderer(stage, viewport);

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

function clearOverlay() {
  overlay.removeChildren();
}
function label(text, x, y, { size = 18, color = 0xcfe8ff, mono = true } = {}) {
  const t = new Text({
    text,
    style: { fontFamily: mono ? 'monospace' : 'sans-serif', fontSize: size, fill: color, fontWeight: '600' },
  });
  t.x = x;
  t.y = y;
  overlay.addChild(t);
  return t;
}
/** A filled colour chip + text, for showing "this hull is THIS colour". */
function swatch(colorNum, text, x, y, size = 16) {
  const g = new Graphics();
  g.rect(x, y + 2, size, size).fill({ color: colorNum });
  g.rect(x, y + 2, size, size).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
  overlay.addChild(g);
  label(text, x + size + 8, y, { size });
}

/** Draw `world` then pan/zoom so world `center` lands at screen centre at `scale`
 *  px/unit. Returns a world→screen projector for caption placement.
 *
 *  The Renderer owns TWO children of `stage`: `backdrop.view` (added first, so
 *  `children[0]`) and its private `worldRoot` (added last), and it positions
 *  worldRoot itself every `draw()` so `cameraTarget` lands at the viewport centre
 *  (`centerCamera`). We must NOT clobber that transform (an earlier version panned
 *  `children[0]` — the BACKDROP — which left every overlay ring offset from the real
 *  sprites). Instead we read worldRoot's actual offset back and compose our zoom on
 *  top via the parent `stage`, so backdrop + world + overlay all stay in register.
 *  `cameraTarget` still matters: it is the viewer the render's team-aware shot tint
 *  is computed against (`drawShots`), so we keep it = P0 while our own math handles
 *  where `center` lands on screen (independent of which ship the camera centred). */
function frame(world, center, scale, cameraTarget = 0) {
  renderer.draw(world, { cameraTarget, muzzles: [] });
  const root = stage.children[stage.children.length - 1]; // worldRoot (added last)
  const wx = root.x; // camera offset the Renderer just wrote (centres cameraTarget)
  const wy = root.y;
  stage.scale.set(scale);
  // Put world `center` at screen centre: screen(p) = stage.x + scale*(wx + p.x).
  stage.x = W / 2 - scale * (wx + center.x);
  stage.y = H / 2 - scale * (wy + center.y);
  return (p) => ({ x: stage.x + scale * (wx + p.x), y: stage.y + scale * (wy + p.y) });
}
function render() {
  app.renderer.render(app.stage);
}

/** Quiet a world so nothing spawns/moves under a still: waves done, past spawn
 *  protection, no drift. */
function settle(world) {
  world.time = SPAWN_PROTECTION_S + 5;
  world.match.wavesSpawned = WAVE_COUNT;
  for (const s of world.ships) {
    s.vel = { x: 0, y: 0 };
    s.spawnProtect = 0;
  }
  for (const st of world.stations) {
    st.spawnProtect = 0;
    st.sinceDamage = 999;
  }
}

// A 2v2 TEAMS roster: p0,p1 on team 0 (the viewer's side), p2,p3 on team 1.
const TEAMS_2V2 = [
  { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
  { id: 1, shipClass: ShipClass.Vanguard, team: 0 },
  { id: 2, shipClass: ShipClass.Vanguard, team: 1 },
  { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
];

// ---------------------------------------------------------------------------
// Scene A: IDENTITY — do teammates LOOK like a team? Four ships, viewer = p0,
// each captioned with its real team + its real playerColor hull colour, plus one
// shot each so the viewer-relative shot tint (the ONE team-aware channel in the
// render today) is on screen next to the per-player hulls.
// ---------------------------------------------------------------------------
function identity() {
  const world = createWorld({
    seed: 14,
    players: TEAMS_2V2,
    bounds: { width: 3000, height: 3000 },
    asteroidCount: 0,
  });
  settle(world);
  for (const st of world.stations) st.pos = { x: -9000, y: -9000 }; // declutter: hide homes

  const cx = 1500;
  const cy = 1500;
  // Team 0 (p0,p1) clustered left, team 1 (p2,p3) clustered right — mirrors a real
  // spawn so "same team = same look?" is the only question the frame asks.
  const place = {
    0: { x: cx - 320, y: cy - 150 },
    1: { x: cx - 320, y: cy + 150 },
    2: { x: cx + 320, y: cy - 150 },
    3: { x: cx + 320, y: cy + 150 },
  };
  for (const s of world.ships) {
    s.pos = { ...place[s.id] };
    s.angle = s.id < 2 ? 0 : Math.PI; // teams face each other
  }
  // One live shot per ship so the shot-tier tint (viewer-relative own/enemy) shows.
  world.projectiles.length = 0;
  for (const s of world.ships) {
    const dir = s.id < 2 ? 1 : -1;
    world.projectiles.push({
      id: s.id + 1,
      active: true,
      owner: s.id,
      pos: { x: s.pos.x + dir * 70, y: s.pos.y },
      vel: { x: 0, y: 0 },
      damage: 10,
      radius: 6,
      life: 5,
      kind: 'ship',
    });
  }

  const scale = (Math.min(W, H) * 0.95) / 1000;
  clearOverlay();
  const project = frame(world, { x: cx, y: cy }, scale, 0); // viewer = p0
  // Ring each live shot in the EXACT colour the Renderer tinted it (own vs enemy is
  // viewer-relative — `areEnemies(0, owner)` — the one team-aware channel in render).
  // The pixel under the ring is the real shot sprite; the ring only makes the tiny
  // sprite legible and states which team-colour it drew as.
  const shotRing = new Graphics();
  for (const p of world.projectiles) {
    if (!p.active) continue;
    const enemyFire = areEnemies(world, 0, p.owner);
    const famCol = enemyFire ? SHOT_TIER_COLORS.enemy[0] : SHOT_TIER_COLORS.own[0];
    const pp = project(p.pos);
    shotRing.circle(pp.x, pp.y, 12).stroke({ width: 3, color: famCol, alpha: 0.95 });
    label(enemyFire ? 'enemy fire' : 'friendly fire', pp.x - 34, pp.y + 16, { size: 13, color: famCol });
  }
  overlay.addChild(shotRing);
  for (const s of world.ships) {
    const sp = project(s.pos);
    const col = playerColor(s.id);
    const t = teamOf(world, s.id);
    const rel = s.id === 0 ? 'you' : areEnemies(world, 0, s.id) ? 'ENEMY' : 'ally';
    label(`P${s.id}  team ${t}  ${rel}`, sp.x - 60, sp.y - 92, { size: 17, color: s.id === 0 ? 0xffffff : col });
    swatch(col, `hull ${hex(col)}`, sp.x - 60, sp.y - 70, 15);
  }
  label('TEAMS 2v2 — viewer = P0 (team 0).  How does the render mark teams?', 22, 16, { size: 20, color: 0xffffff });
  label('Team 0 = {P0, P1}   Team 1 = {P2, P3}   (read off world.ship.team via teamOf)', 22, 44, { size: 16 });
  // Honest scope: the shared-team signal is the SHOT tint, NOT a shared hull colour.
  label('TEAM SIGNAL = viewer-relative SHOT tint: your side (P0+P1) fires plasma, foes (P2+P3) fire red.', 22, H - 96, {
    size: 15,
    color: 0xffd23f,
  });
  swatch(SHOT_TIER_COLORS.own[0], 'friendly fire (P0 & ally P1) → plasma', 22, H - 70, 15);
  swatch(SHOT_TIER_COLORS.enemy[0], 'enemy fire (P2 & P3) → threat-red', 22, H - 46, 15);
  label('NOTE: hull/nameplate/minimap colour is per-PLAYER (4 distinct), not a shared team swatch — a render gap.', 22, H - 22, {
    size: 13,
    color: 0x9fb0c3,
  });
  render();

  return {
    viewer: 0,
    ships: world.ships.map((s) => ({
      id: s.id,
      team: teamOf(world, s.id),
      hullColor: hex(playerColor(s.id)),
      enemyOfViewer: areEnemies(world, 0, s.id),
    })),
    teammatesSameHullColor: playerColor(0) === playerColor(1),
    enemiesSameHullColor: playerColor(2) === playerColor(3),
    ownShotColor: hex(SHOT_TIER_COLORS.own[0]),
    enemyShotColor: hex(SHOT_TIER_COLORS.enemy[0]),
  };
}

// ---------------------------------------------------------------------------
// Scene B: NO FRIENDLY FIRE — a shot fired by P0 flies straight THROUGH ally P1
// (unharmed) and strikes enemy P2 behind. Two calls: `noFfFreeze()` shows the
// projectile mid-flight overlapping the ally; `noFfResolve()` steps until it hits
// the enemy and reads every hull. FRIENDLY_FIRE is the shipped default (false).
// ---------------------------------------------------------------------------
let FF = null;
function noFfInit() {
  const world = createWorld({
    seed: 22,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard, team: 0 }, // shooter (viewer)
      { id: 1, shipClass: ShipClass.Vanguard, team: 0 }, // ALLY in the line of fire
      { id: 2, shipClass: ShipClass.Vanguard, team: 1 }, // ENEMY behind the ally
    ],
    bounds: { width: 3000, height: 3000 },
    asteroidCount: 0,
  });
  settle(world);
  for (const st of world.stations) st.pos = { x: -9000, y: -9000 };
  const y = 1500;
  const shooter = world.ships[0];
  const ally = world.ships[1];
  const enemy = world.ships[2];
  shooter.pos = { x: 1150, y };
  ally.pos = { x: 1500, y }; // directly between shooter and enemy
  enemy.pos = { x: 1850, y };
  for (const s of world.ships) s.angle = 0;
  // A live shot P0 fired, starting just left of the ally, aimed dead ahead.
  world.projectiles.length = 0;
  world.projectiles.push({
    id: 99,
    active: true,
    owner: 0,
    pos: { x: ally.pos.x, y }, // ON the ally right now
    vel: { x: 600, y: 0 },
    damage: 40,
    radius: 7,
    life: 5,
    kind: 'ship',
  });
  FF = { world, shooter, ally, enemy, hull0: shooter.hull, hullAllyStart: ally.hull, hullEnemyStart: enemy.hull };
  return snapFf('freeze (shot ON ally)');
}
function snapFf(caption) {
  const { world, shooter, ally, enemy } = FF;
  const c = { x: 1500, y: 1500 };
  const scale = (Math.min(W, H) * 0.9) / 1000;
  clearOverlay();
  const project = frame(world, c, scale, 0);
  const pS = project(shooter.pos);
  const pA = project(ally.pos);
  const pE = project(enemy.pos);
  const proj = world.projectiles[0];
  // Sight line for readability.
  const g = new Graphics();
  g.moveTo(pS.x, pS.y).lineTo(pE.x, pE.y).stroke({ width: 1, color: 0x3a4658, alpha: 0.8 });
  if (proj && proj.active) {
    const pp = project(proj.pos);
    g.circle(pp.x, pp.y, 8).stroke({ width: 2, color: 0xffd23f, alpha: 0.9 });
  }
  overlay.addChild(g);
  label(`P0 shooter (team 0)`, pS.x - 60, pS.y - 70, { size: 15, color: playerColor(0) });
  label(`P1 ALLY (team 0)`, pA.x - 52, pA.y - 78, { size: 15, color: playerColor(1) });
  label(`hull ${Math.round(ally.hull)}/${ally.maxHull}`, pA.x - 52, pA.y + 44, {
    size: 16,
    color: ally.hull >= ally.maxHull ? 0x8fe39f : 0xff6a5a,
  });
  label(`P2 ENEMY (team 1)`, pE.x - 52, pE.y - 78, { size: 15, color: playerColor(2) });
  label(`hull ${Math.round(enemy.hull)}/${enemy.maxHull}`, pE.x - 52, pE.y + 44, {
    size: 16,
    color: enemy.hull >= enemy.maxHull ? 0x8fe39f : 0xff6a5a,
  });
  label('NO FRIENDLY FIRE — P0 fires through ally P1 at enemy P2', 22, 16, { size: 20, color: 0xffffff });
  label(`FRIENDLY_FIRE = false (shipped default).  canDamage(P0→P1)=${canDamage(world, 0, 1)}  canDamage(P0→P2)=${canDamage(world, 0, 2)}`, 22, 44, {
    size: 15,
  });
  label(caption, 22, H - 40, { size: 18, color: 0xffd23f });
  render();
  return {
    caption,
    projActive: !!(proj && proj.active),
    projX: proj ? Math.round(proj.pos.x) : null,
    allyHull: Math.round(ally.hull),
    allyHullMax: ally.maxHull,
    enemyHull: Math.round(enemy.hull),
    enemyHullMax: enemy.maxHull,
    allyUnharmed: ally.hull >= FF.hullAllyStart,
    enemyDamaged: enemy.hull < FF.hullEnemyStart,
    canDamageAlly: canDamage(world, 0, 1),
    canDamageEnemy: canDamage(world, 0, 2),
  };
}
function noFfResolve() {
  const { world, enemy } = FF;
  let ticks = 0;
  // Step until the shot lands on the enemy (enemy hull drops) or the shot dies.
  const startEnemy = enemy.hull;
  while (ticks < 200) {
    step(world, [], TICK_DT);
    ticks++;
    if (enemy.hull < startEnemy) break;
    if (!world.projectiles[0]?.active) break;
  }
  return { ...snapFf(`resolved after ${ticks} ticks (${(ticks * TICK_DT).toFixed(2)}s) — enemy hit, ally untouched`), ticks };
}

// ---------------------------------------------------------------------------
// Scene C: SPAWN ADJACENCY — a real `createWorld` TEAMS 2v2 on the default map.
// `teamHomeSlots` groups teammates into contiguous (⇒ spatially adjacent) home
// slots. Rendered untouched; each home captioned with its real owner+team, and
// the intra-team vs cross-team home distances measured off the real positions.
// ---------------------------------------------------------------------------
function spawnAdjacency(mapId) {
  const world = createWorld({
    seed: 14,
    players: TEAMS_2V2,
    ...(mapId ? { mapId } : {}),
  });
  settle(world);
  // Put each ship on its own home so the spawn cluster is unambiguous.
  for (const s of world.ships) {
    const home = world.stations.find((st) => st.owner === s.id);
    if (home) s.pos = { x: home.pos.x, y: home.pos.y - home.radius - 60 };
  }

  const c = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  const scale = (Math.min(W, H) * 0.9) / world.bounds.width;
  clearOverlay();
  const project = frame(world, c, scale, 0);

  const homeOf = {};
  for (const st of world.stations) if (!st.derelict) homeOf[st.owner] = st;
  // Cluster centroids per team.
  const teamCentroid = (ids) => {
    const ps = ids.map((id) => homeOf[id].pos);
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  };
  const cA = teamCentroid([0, 1]);
  const cB = teamCentroid([2, 3]);
  const intraA = dist(homeOf[0].pos, homeOf[1].pos);
  const intraB = dist(homeOf[2].pos, homeOf[3].pos);
  const cross = dist(cA, cB);

  const g = new Graphics();
  // Draw the team clusters and the cross-team span.
  const pcA = project(cA);
  const pcB = project(cB);
  g.moveTo(pcA.x, pcA.y).lineTo(pcB.x, pcB.y).stroke({ width: 2, color: 0x6f7d92, alpha: 0.8 });
  overlay.addChild(g);
  for (const st of world.stations) {
    if (st.derelict) continue;
    const sp = project(st.pos);
    const tm = teamOf(world, st.owner);
    const tint = tm === 0 ? 0x6ad4ff : 0xffa04d;
    g.circle(sp.x, sp.y, 22).stroke({ width: 3, color: tint, alpha: 0.95 });
    label(`P${st.owner}`, sp.x - 12, sp.y - 46, { size: 16, color: playerColor(st.owner) });
    label(`team ${tm}`, sp.x - 22, sp.y + 26, { size: 14, color: tint });
  }
  label(`SPAWN ADJACENCY — TEAMS 2v2 on "${world.mapId ?? 'octagon'}" (real createWorld layout)`, 22, 16, { size: 19, color: 0xffffff });
  label(`Team 0 {P0,P1} homes ${Math.round(intraA)} apart   Team 1 {P2,P3} homes ${Math.round(intraB)} apart`, 22, 44, {
    size: 15,
    color: 0x6ad4ff,
  });
  label(`Cross-team centroid span ${Math.round(cross)}  (clusters ${(cross / ((intraA + intraB) / 2)).toFixed(1)}× farther apart than teammates)`, 22, 68, {
    size: 15,
    color: 0xffa04d,
  });
  render();
  return {
    mapId: world.mapId ?? 'octagon',
    homes: world.stations
      .filter((s) => !s.derelict)
      .map((s) => ({ owner: s.owner, team: teamOf(world, s.owner), pos: { x: Math.round(s.pos.x), y: Math.round(s.pos.y) } })),
    intraTeam0: Math.round(intraA),
    intraTeam1: Math.round(intraB),
    crossTeam: Math.round(cross),
    clustered: intraA < cross && intraB < cross,
  };
}

window.__qa = {
  ready: true,
  identity,
  noFfInit,
  noFfResolve,
  spawnAdjacency,
};
