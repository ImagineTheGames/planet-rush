/**
 * evidence/a0-127-three-changes-with-eyes/shoot-wheel.mjs — D5, the one that was
 * deliberately kept: the build wheel's halo over the arrow home.
 * OWNER: QA Manager (a0-127).
 *
 * a0-125 measured this pair, argued it, and pinned it as
 * `match-alarm-wheel | phone-798x384 | build-wheel | alarm-arrow`. The brief says:
 * photograph it as it is, and confirm the measurement or correct it.
 *
 * Confirming it means reaching the state on the RUNNING GAME, which is the whole
 * difference between a sweep over modelled frames and a camera. Two facts decide
 * whether it can be reached, and this script goes and looks at both on the phone:
 *
 *  · the wheel is live only while the ship is DOCKED — `STATION.dockRange` 160,
 *    centre to centre, and `buildWheelOpen` re-derives that every frame, so the
 *    wheel closes on the frame the ship undocks;
 *  · the arrow home is drawn only when home is OUTSIDE the viewport inset by
 *    `ARROW_EDGE_INSET` 28 — on a 384-tall phone that is |dy| > 164.
 *
 * So the ship is flown to three stops directly BELOW its own station — 150, 158
 * and 170 world units — and at each stop the alarm is held, BUILD is pressed for
 * real, and the client's own registry is read. 150 and 158 are inside dock range;
 * 170 is outside it and inside arrow range. The frames say what the game draws.
 *
 * Staging is a0-111's, unchanged: a HELD siege (`damageCore(0, 2)` every 400 ms
 * above a 30 HP floor), because the alarm latches 5s and drains and a leisurely
 * dpr-2 capture otherwise photographs a released alarm.
 */
import { chromium } from 'playwright';
import { PHONE, bootMatch, crop, elements, frame, note, overlap, pageOptions, park, rectOf, settle, shotPath, stamp, writeCrop } from './lib.mjs';

// The debug boot's own geometry (`src/sim/maps` octagon, `src/sim/constants`):
// the arena centre is (1200,1200), the ship spawns on the ring at angle 0, and the
// station sits `STATION.orbitOffset` 96 further out along the same ray. Asserted
// against the ship's actual spawn below rather than assumed.
const STATION = { x: 2064, y: 1200 };
/** Two stops, each on its OWN boot: one inside dock range (the wheel can open),
 *  one outside it and past the arrow's threshold (the arrow is drawn). The taps
 *  land a little long — the tap-to-move dead band (a0-107) is about a dozen world
 *  units — so the aim is short of the number wanted and the ACTUAL standoff is
 *  measured and reported rather than assumed. */
const STOPS = [
  { aim: 140, why: 'inside dock range 160 — the wheel is live here' },
  { aim: 220, why: 'outside dock range and past |dy| > 164 — the arrow is drawn here' },
];

const browser = await chromium.launch();
const readback = [];

for (const stop of STOPS) {
  // A FRESH BOOT per stop. The siege is a real one — the core really loses HP —
  // so flying to the second stop on a besieged station would arrive at a core
  // under the pump's floor, where no more damage lands and the alarm has drained.
  const page = await browser.newPage(pageOptions(PHONE));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await bootMatch(page, '?debug=1');

  const spawn = await page.evaluate(() => window.__pauseStage.read().ship);
  const target = { x: STATION.x, y: STATION.y + stop.aim };

  /** Fly to a world point with REAL taps — a move order at the point the world
   *  position maps to, iterated until the ship stops converging. Tap coordinates
   *  are CSS px, the space the client's own seams report controls in. */
  for (let i = 0; i < 24; i++) {
    const ship = await page.evaluate(() => window.__pauseStage.read().ship);
    if (Math.hypot(ship.x - target.x, ship.y - target.y) < 4) break;
    const world = await page.evaluate(() => window.__viewStage.world());
    const vp = await page.evaluate(() => window.__viewStage.viewport());
    const sx = ((target.x - world.left) / world.width) * vp.width;
    const sy = ((target.y - world.top) / world.height) * vp.height;
    await page.touchscreen.tap(Math.max(6, Math.min(vp.width - 6, sx)), Math.max(6, Math.min(vp.height - 6, sy)));
    await settle(page, 30);
  }

  // Now hold the siege — after the flight, so the core is still healthy enough
  // for the pump to bite (it stops above a 30 HP floor: a dead station switches
  // the alarm off, and a siege is not a demolition).
  await page.evaluate(() =>
    window.setInterval(() => {
      const hp = window.__planetRush.coreHp(0);
      if (hp !== null && hp > 30) window.__planetRush.damageCore(0, 2);
    }, 400),
  );
  let alarmPolls = -1;
  for (let i = 0; i < 40; i++) {
    const els = await elements(page);
    if (els.some((e) => e.id === 'alarm-frame')) { alarmPolls = i; break; }
    await settle(page, 12);
  }

  // Press BUILD for real, at the point the client says it drew the button.
  const btn = await page.evaluate(() => {
    const e = window.__cornerStage.read().elements.find((x) => x.id === 'build-button');
    return e ? { ...e.physicalCenter } : null;
  });
  if (btn) {
    await page.touchscreen.tap(btn.x, btn.y);
    await settle(page, 12);
  }
  await park(page);

  const ship = await page.evaluate(() => window.__pauseStage.read().ship);
  const dist = Math.hypot(ship.x - STATION.x, ship.y - STATION.y);
  const name = `wheel-d5-aim${stop.aim}`;
  await frame(page, name);
  const els = await elements(page);
  const wheel = rectOf(els, 'build-wheel');
  const arrow = rectOf(els, 'alarm-arrow');
  const row = {
    aim: stop.aim,
    why: stop.why,
    spawn,
    station: STATION,
    ship: { x: +ship.x.toFixed(1), y: +ship.y.toFixed(1) },
    distanceToStation: +dist.toFixed(1),
    dyToStation: +(ship.y - STATION.y).toFixed(1),
    dockRange: 160,
    arrowThresholdDy: 384 / 2 - 28,
    buildButtonPressedAt: btn,
    buildButtonDrawn: els.some((e) => e.id === 'build-button'),
    alarmPolls,
    alarmFrameDrawn: els.some((e) => e.id === 'alarm-frame'),
    coreHp: await page.evaluate(() => window.__planetRush.coreHp(0)),
    stamp: await stamp(page),
    wheel,
    arrow,
    wheelOverArrow: overlap(wheel, arrow),
    ids: els.map((e) => e.id),
  };
  readback.push(row);
  console.log(
    `aim ${stop.aim} → d=${row.distanceToStation} dy=${row.dyToStation}: wheel=${wheel ? JSON.stringify(wheel) : 'not drawn'} ` +
      `arrow=${arrow ? JSON.stringify(arrow) : 'not drawn'} alarmFrame=${row.alarmFrameDrawn} hp=${row.coreHp}`,
  );

  // The corner the pin is about, 3× — the top-centre of the glass, where the
  // clock's rule, the wheel's halo and the arrow all live.
  writeCrop(
    `${name}-topcentre-3x`,
    crop(shotPath(name), { x: Math.round(240 * PHONE.dpr), y: 0, w: Math.round(320 * PHONE.dpr), h: Math.round(120 * PHONE.dpr), scale: 3 }),
  );
  await page.close();
}

note('wheel-d5-readback', readback);
await browser.close();
