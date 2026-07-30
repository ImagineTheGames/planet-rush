/**
 * evidence/_respawn-tail-entry.mjs — fold the respawn-tail diagnosis into the
 * manifest. OWNER: QA Manager.
 *
 * The online-final round closed with one item carried as UNKNOWN: the ~5 s after a
 * death in which the telemetry re-charges the same correction while the ship sits
 * still. `respawn-tail.live.test.ts` measured it on the live fleet and it is no
 * longer unknown, so both online entries are re-attested with what was witnessed.
 * Verdicts are NOT touched — both gates remain failed, which is still the honest
 * reading and still not QA's to flip.
 *
 * Run: node evidence/_respawn-tail-entry.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'manifest.json');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const find = (id) => {
  const e = manifest.find((x) => x.id === id);
  if (!e) throw new Error(`manifest has no entry ${id}`);
  return e;
};

// --- online-feel: the tail is diagnosed, and it is not an accounting artifact ---

const feel = find('online-feel');

feel.title =
  'Online feel at ~400 ms, measured with the game’s OWN COPY LOG export from a live two-client match — the #244 wiring reaches the screen and ordinary flight sits far inside every audit threshold (worst correction 1.5 u of 4, snap 0, lead 21 t of 32), but the session as exported BREACHES three of them for the whole 5 s after every death, because the client respawns the local ship the instant authority reports it dead while authority holds it dead at the death site for RESPAWN_S — and COPY LOG cannot be pressed at all on a phone';

feel.attestation +=
  '\n\nTHE POST-RESPAWN TAIL IS NO LONGER UNKNOWN — MEASURED 2026-07-30T15:50Z, LIVE, AND IT IS NOT AN ACCOUNTING ARTIFACT. ' +
  'The round closed carrying one open item: why the instrument keeps re-charging the same correction for ~5 s after a death while the ship provably sits still. ' +
  '`evidence/respawn-tail.live.test.ts` answers it by watching the subtraction itself. `prediction.ts` computes the number this gate is failed on in one place (`reconcile`, :400-406): ' +
  '`this.error = checkpoint && authoritative ? Math.hypot(checkpoint.x - authoritative.posX, checkpoint.y - authoritative.posY) : 0`. ' +
  'Two terms — `checkpoint` is this client’s own recorded position at the snapshot’s tick, `authoritative` is the server’s ship in that snapshot. ' +
  'The probe wraps the SHIPPED `reconcile` and records BOTH, per reconcile, across a real death on the live fleet; nothing is stubbed and nothing is modified. ' +
  'Output committed verbatim as images/online-feel-respawn-tail.json (room SWQD, 1 598 reconciles, all applied).\n\n' +
  'WHAT IT SHOWS. Across the 150 breaching reconciles there is exactly ONE distinct error value (1228.217 u), because there is exactly ONE distinct value on each side of the subtraction: ' +
  'the checkpoint is frozen at (1968.841, 1200) — the player’s HOME — and authority is frozen at (744, 1291) — the DEATH SITE. ' +
  'Neither term is stale plumbing: `histHit` is true and `resynced` false on every one of those reconciles, so `rewind()` found a real history entry at the snapshot’s own tick each time, and the local ship is present in every snapshot (`authPresent` true). ' +
  'The correction is therefore computed correctly and repeatedly from two states that genuinely disagree by 1228 u. THE INSTRUMENT IS RIGHT; THE STATES ARE WRONG. ' +
  'The window spans snapshot ticks 2606 → 2904 — 298 ticks, and at `TICK_DT = 1/60` that is 4.97 s, which is `RESPAWN_S = 5` (src/sim/constants.ts:903). ' +
  'It is delivered in 265 ms of wall clock, a backlog burst of 150 snapshots, which is why the COPY LOG rows read as ~5 seconds of match time.\n\n' +
  'ROOT CAUSE, EVERY LINK MEASURED OR READ FROM THE SHIPPED SOURCE: **THE RESPAWN COUNTDOWN IS NOT ON THE WIRE.** ' +
  '(1) `killShip` (src/sim/damage.ts:37-40) sets `alive = false`, `hull = 0` and `respawnTimer = RESPAWN_S`, and only authority runs it — damage is the server’s word by design (`prediction.ts`: “a predicted shot is a picture of a shot”). ' +
  '(2) `ShipSnap` carries pos, vel, heading, hull and a `SHIP_FLAG.alive` bit (src/net/snapshot.ts:91-101, :131-141) — and NO `respawnTimer`. ' +
  '(3) `applySnapshot` (src/net/prediction.ts:799-809) duly writes pos, hull and `alive` onto the local ship, and never writes `respawnTimer`. ' +
  '(4) So the client’s ship becomes `alive = false` with `respawnTimer = 0`, because the client never ran `killShip`. ' +
  '(5) `step()` (src/sim/step.ts:199-202) does `ship.respawnTimer -= dt; if (ship.respawnTimer <= 0) respawn(ship)`, and `respawn` (step.ts:1020-1033) puts the hull back to full at `ship.home`. ' +
  'The first replay step after the death snapshot therefore resurrects the ship at home INSTANTLY — the full 5 s early. ' +
  'Every reconcile for the rest of authority’s countdown then repeats the same round trip: authority writes dead-at-death-site, the replay writes alive-at-home, and the correction is charged the whole death-site→home distance again. I watched it happen 150 times in one window.\n\n' +
  'WHY NOBODY REPORTED SEEING IT, AND WHAT IS ACTUALLY WRONG ON SCREEN. `absorb()` (prediction.ts:558-573) measures displacement across the WHOLE reconcile — home before, home after — so it registers no movement and the visual-snap counter stays put: one snap at the leading edge (recorded at n=1301, the transition) and none for the 150 that follow. ' +
  'That is why this never looked like a teleport. But the ship the renderer draws is the same `world.ships` entry this probe sampled, and for those 298 ticks it sits at (1980–1985, 1200) — within ±4 u of home — while the probe holds thrust down continuously at 33 ms intervals. ' +
  'Each reconcile snaps it back to the death site, the replay respawns it to exactly `ship.home`, and only the handful of still-pending input ticks (`queueLen` 10–18) push it off that point before the next snapshot resets it. ' +
  'The player-facing symptom this measurement implies is therefore not a visual glitch but a dead control stick: for the ~5 s after you die you are drawn at your home planet, at full hull, unable to move, on a ship authority still holds dead in the field. ' +
  'The audit’s correction thresholds are breached because the game state really is that far apart — exactly what a correction metric is for.\n\n' +
  'This retires the previous round’s wording, which called the tail a fault in the telemetry “accounting” and left the cause open. The accounting is sound; the divergence is real. ' +
  'OWNER: Netcode — the fix is to give the client authority’s remaining countdown (stream `respawnTimer`, or hold the local ship dead until authority says otherwise) rather than to change the instrument. ' +
  'VERDICT UNCHANGED: FAILED. The numbers this gate is read against are unchanged and still breach three of the six; what has changed is that the breach now has a named mechanism and a named owner instead of an UNKNOWN.';

// --- online-reconnect: the 15:44Z re-run, and no fix in flight ---

const reconnect = find('online-reconnect');
reconnect.attestation +=
  ' RE-RUN AGAIN 2026-07-30T15:44Z on resuming the round: `evidence/recheck-online-blockers.mjs` still reports BLOCKED on the same four counts — the live gameserver is now up 31.3 h (booted 2026-07-29T08:26:40Z, still the last GREEN deploy), `server/Dockerfile` still has no COPY for allocator/, `parseActions` still has no case for `upgradeOrder` and BUILD_ITEMS still no `satellite`. ' +
  'Asked of GitHub directly rather than of the script: every `Deploy server (Fly.io)` run is still red through run 30552080733 (2026-07-30T14:31Z), `origin/main` is still 927943a, and PR #246 (this branch) is still the only open PR — no lane has a fix in flight. Nothing this gate waits on has moved.';

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`updated online-feel and online-reconnect in ${MANIFEST}`);
console.log(`online-feel verdict: ${feel.verdict} | online-reconnect verdict: ${reconnect.verdict}`);
