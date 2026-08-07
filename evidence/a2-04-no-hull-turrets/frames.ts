/**
 * evidence/a2-04-no-hull-turrets/frames.ts — the four frames this brief turns on.
 * OWNER: Art Agent (brief a2-04).
 *
 * The claim a2-04 has to prove is not "the hull looks nice." It is that **the
 * silhouette tells the truth about state**: a station with four built turrets
 * shows four, and a station whose ring has been shot empty shows none. A hull
 * that drew its own guns would fail both — it would show eight, and it would
 * show four.
 *
 * So this draws the SHIPPED renderer against the SHIPPED simulation — the same
 * `Renderer` and the same `placeOrder` / `updateStations` / `damageTurret` the
 * game runs — into four panels at one fixed zoom:
 *
 *   bare     — a fresh station, nothing built. THE BEFORE/AFTER SUBJECT.
 *   built-4  — four turrets bought at the wheel and assembled, standing.
 *   shot-2   — two of the four shot down and swept.
 *   shot-0   — the ring shot empty.
 *
 * Nothing here is drawn by hand and nothing is mocked: if the picture is wrong,
 * the game is wrong. Rendered by `capture-frames.mjs` against a `vite` server.
 */
import { Application, Container } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { Renderer } from '@render/index';
import {
  createWorld,
  damageTurret,
  placeOrder,
  shipOf,
  stationOf,
  sweepDeadTurrets,
  updateStations,
  TURRET,
  type World,
} from '../../src/sim';

/** One panel, square, centred on station 0. Big enough that a 64-unit body and
 *  its mounts are inspectable without resampling. */
const PANEL = 420;

/** A two-slot arena with P1 parked on its own station, funded, out of spawn
 *  protection — the state every wheel press below is made from. */
function arena(): World {
  const world = createWorld({
    seed: 7,
    players: [0, 1].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
  });
  const station = stationOf(world, 0)!;
  const ship = shipOf(world, 0)!;
  ship.pos = { x: station.pos.x, y: station.pos.y };
  ship.banked = 100;
  station.spawnProtect = 0;
  ship.spawnProtect = 0;
  return world;
}

/** Buy `n` turrets and run construction to completion (~10 s each, GDD §2.5). */
function build(world: World, n: number): void {
  const ship = shipOf(world, 0)!;
  const station = stationOf(world, 0)!;
  for (let i = 0; i < n; i++) placeOrder(world, ship, 'turret');
  for (let i = 0; i < 4000 && station.turrets.length < n; i++) updateStations(world, 1 / 60);
}

/** Shoot `n` standing turrets down, and sweep them exactly as the sim does. */
function shootDown(world: World, n: number): void {
  const station = stationOf(world, 0)!;
  for (const t of station.turrets.slice(0, n)) damageTurret(t, t.maxHp);
  sweepDeadTurrets(world);
}

const SCENES: readonly { key: string; caption: string; make: () => World }[] = [
  { key: 'bare', caption: '0 built — a fresh station', make: () => arena() },
  {
    key: 'built-4',
    caption: `${TURRET.capPerStation} built — the ring full`,
    make: () => { const w = arena(); build(w, TURRET.capPerStation); return w; },
  },
  {
    key: 'shot-2',
    caption: '2 shot down — the count drops',
    make: () => { const w = arena(); build(w, TURRET.capPerStation); shootDown(w, 2); return w; },
  },
  {
    key: 'shot-0',
    caption: 'the ring shot empty',
    make: () => { const w = arena(); build(w, TURRET.capPerStation); shootDown(w, TURRET.capPerStation); return w; },
  },
];

async function panel(scene: (typeof SCENES)[number]): Promise<void> {
  const host = document.createElement('figure');
  host.className = 'panel';
  host.id = `panel-${scene.key}`;

  const app = new Application();
  await app.init({
    width: PANEL,
    height: PANEL,
    background: 0x0d1015,
    antialias: true,
    // dpr is set by the capture context, not guessed here.
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const stage = new Container();
  app.stage.addChild(stage);
  const r = new Renderer(stage, { width: PANEL, height: PANEL, originX: 0, originY: 0 });
  const world = scene.make();
  r.draw(world, { cameraTarget: 0, muzzles: [] });
  app.render();

  const station = stationOf(world, 0)!;
  host.append(app.canvas);
  const cap = document.createElement('figcaption');
  cap.textContent = `${scene.caption} · sim says ${station.turrets.length}`;
  host.append(cap);
  document.body.append(host);

  // The number the caption claims, machine-readable, so the capture script can
  // assert the picture against the simulation rather than trusting a label.
  host.dataset.turrets = String(station.turrets.length);
}

async function main(): Promise<void> {
  for (const scene of SCENES) await panel(scene);
  document.body.dataset.ready = '1';
}

void main();
