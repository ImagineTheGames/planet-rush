/**
 * evidence/a1-13-night-round/_entries.mjs — the a1-13 round's attestations, and
 * the one-shot that appends them to `evidence/manifest.json`. OWNER: QA Manager.
 *
 * The manifest's shape and contract are untouched: same eight keys, same order,
 * items are ADDED and nothing already in it is re-graded. This was a read-only
 * round; the historical record stays exactly as it was written.
 *
 * NOTE ON `buildSha`: the site REDEPLOYED mid-round (`ecc1496` → `ffc414e`), so
 * the items do not all name one sha. Each names the sha its own frames were taken
 * on, read off the page (`__planetRush.build.sha` / the in-frame badge) and gated
 * independently against the served bundle's sourcemap. Both gate runs are
 * committed beside this file.
 *
 *   node evidence/a1-13-night-round/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '..', 'manifest.json');

/** Shorthand — keeps the eight keys in the manifest's own order. */
const item = (id, title, area, image, capturedAt, buildSha, verdict, attestation) => ({
  id,
  title,
  area,
  image,
  capturedAt,
  buildSha,
  attestation,
  verdict,
});

const ENTRIES = [
  item(
    'a1-13-vfx-ship-explode-and-ore-collect-draw-on-the-served-build',
    'The explosion leaves a mark and the ore leaves a sparkle — both drawn by the served bundle, one frame after the sim said so, and gone again two frames later',
    'match',
    'images/a1-13-vfx-explode-strip.png',
    '2026-08-10T14:21:31Z',
    'ecc1496',
    'verified',
    'FOR SIX MILESTONES AN EXPLOSION MADE ITS NOISE AND LEFT NO MARK. `src/art/vfx/` implemented the whole GDD §3.6 set, unit-green throughout, and `main.ts` constructed none of it — a2-07 built the layer and added it to `gameRoot`, and this is that wire photographed on the bundle a player loads. Served `ecc1496`, gated by sourcemap byte-compare before a shutter fired; the page’s own `__planetRush.build.sha` reads `ecc1496` on every frame here. Live `?debug=1` match, NOT `?freeze=1` — frozen stages a2-07’s own showcase sheet, which is exactly what this round may not rest on. THE WIRE ITSELF: `__vfxStage.read().attached` is TRUE at boot, with 54 pooled sprites already built. That flag was false for the entire life of the bug; a layer that exists but hangs off nothing draws exactly as much as one that was never constructed. SHIPEXPLODE, WHAT THE FIVE-PANEL STRIP SHOWS (`a1-13-vfx-explode-strip.png`, four-times nearest-neighbour, no interpolation, every pixel one the client drew): panel 1, the ship intact beside its blue-ringed station, no ring anywhere. Panel 2, the trigger frame — still intact, because the copy is taken in the same rAF that reads the tally and the draw lands one frame later. PANEL 3 IS THE EFFECT: the ship is GONE, RESPAWNING 5 is across the plate, and a bright cyan-white shockwave ring stands where the hull was, with bright specks scattered through it. Panel 4, the same ring expanded to roughly twice the radius and dimmer, still centred on the same point. Panel 5, empty space — no ring, no specks. Appears, expands, fades, in three consecutive frames, centred on the wreck and not on the station. ORECOLLECT, THE FOUR-PANEL STRIP (`a1-13-vfx-ore-strip.png`, five-times): panel 1 is the ship at its station before staging; the `mine()` seam then parks it 900 units from home, which is why panels 2-4 are deep space. Panel 2, a scatter of bright gold specks over and around the hull that are not part of the ship sprite, with six filled ore pips lit under it. Panel 3, fewer and dimmer specks, drifting. PANEL 4 IS THE CONTROL: same ship, same pose, same place, hull clean, specks gone, pips dimmed. Present then absent, with nothing else in the frame changed. NOTHING HERE DREW A PARTICLE. Two seams pushed the SIM and only the sim — `__endScreenStage.killLocalShip()` (the sim’s own `killShip`; NOT `damageShip`, which meets ten seconds of spawn protection and is refused in full) and `__oreHudStage.mine(6)` (ore into the local hold, which is what tractor collection does, GDD §2.3). No emitter was named, no field touched. ATTRIBUTION IS PART OF THE TRIGGER, NOT A CHECK AFTER IT: eight ships are dying and mining on a live board, so the recorder fires only when the tally moves AND `drawnBy` for that kind is the local seat, 0. It read `shipExplode` 0→1 by seat 0, and `oreCollect` 19→20 by seat 0. An earlier run without that condition triggered on a bot’s ore pickup at seat 1 and would have photographed the wrong sparkle. WHICH OF THE 25 I SAW: thirteen drew in this session — rockCrack 7, oreCollect 21, holdFull 7, turretFire 13, shotImpact 169, coreHit 3, shipExplode 4, shipSpawn 3, spawnPulse 186, thrust 1094, buildPlaced 8, buildComplete 8, bankOre 149. TWELVE I COULD NOT REACH and they stayed at zero: mineHit, weaponHit, rockBurst, shieldHit, shieldDown, repairTick, upgradeBought, waveArrive, collapseBegin, stationDeath, matchEnd, turretDown. `waveArrive` draws nothing by design (the wave clock is the HUD’s tell); the rest simply did not happen in forty seconds of an unpiloted board, and this round makes no claim about them either way. Zero page errors. ONE DISCLOSED INTERVENTION: `preserveDrawingBuffer` forced true on the WebGL context, or `drawImage` returns black and there are no frames at all. It changes whether the drawn buffer is KEPT, not what is drawn into it.',
  ),

  item(
    'a1-13-connection-lost-arrives-and-abandon-match-gets-you-out',
    'CONNECTION LOST over a real fleet match: the scrim is up 3.0 s after the link dies, ABANDON MATCH frees the seat, BACK TO MENU lands on the menu — and the overlay takes itself down when the frames return',
    'online',
    'images/a1-13-linkloss-recovery-3-up.png',
    '2026-08-10T14:57:46Z',
    'ffc414e',
    'verified',
    'THE DEVELOPER REPORTED A ZOMBIE MATCH — *"bots frozen but I could still move; I should get kicked out and presented reconnect / abandon buttons"* — and `installLinkLossView` had ZERO callers until #370, so the fix existed as a module and never as a behaviour. This is that behaviour on the served bundle. Served `ffc414e`, in-frame badge `ffc414e · 0800d5b6 (iad)`; a real room on the real fleet (`wss://planet-rush-gameserver.fly.dev/play`), rooms `RCRT` and `EDCR`, TWO humans seated (`humanCount: 2`, seats TAKEN/TAKEN), host presses RUSH, and the GUEST’s link is the one taken away. THE PRECONDITION IS MEASURED, NOT ASSUMED: before either cut, the guest’s socket was `readyState: 1` and took 127 frames in four seconds. WHAT IS ON THE GLASS: a full 1280x800 scrim over a dimmed, unplayable match, with a plasma-edged card centred on it. Heading `RECONNECTING…` in plasma, one line under it — `no server data for 3s — reclaiming your seat, 57s of grace left.` — and one button, `ABANDON MATCH`, drawn 177x44 (the 44 px touch minimum, met). Bottom right the client also offers `DOWNLOAD LOG` with `Reconnecting — DOWNLOAD LOG to report this.`, which is the "verbosity of what happened" half of the ask. It arrived 3.03 s after the cut on the closed-socket leg and 3.03 s on the silent-socket leg; the world behind it is legible but greyed, which is the point — a match you are no longer in must not look like one you can play. ABANDON MATCH DOES SOMETHING, AND IT IS THE RIGHT SOMETHING. Pressed once, the card turns threat red: `MATCH ABANDONED — your seat is a bot’s now`, detail `You left the match. The seat is freed and the match went on without you.`, and the button list is replaced by a single `BACK TO MENU` at 160x44. The corner toast changes with it, to `Disconnected (left) — DOWNLOAD LOG to report this.` BACK TO MENU DOES SOMETHING TOO: pressed, the overlay goes and the client is on the main menu — `mainMenuVisible: true`, `matchStarted: false`. That is the whole chain the report asked for, end to end, on a match that really died. AND IT COMES DOWN BY ITSELF. On a separate leg the frames were simply restored and NOTHING was pressed: the overlay collapsed to 0x0, the socket read 1654 frames received with 18 ms since the last, and the match was live again — MATCH 1:03 on the clock, the ship flying, the ore field drawn, `matchStarted: true` with a real ship position. An overlay that never leaves is its own kick-out; this one leaves. WHAT THIS ITEM DOES NOT COVER: the RECONNECT button, which was never drawn at all — that is filed separately and failed, and it is the reason this verdict is scoped to the two buttons a player can actually reach. THE INSTRUMENT NEARLY MANUFACTURED A FINDING FIRST, TWICE, and both are written up in the capture script: a `routeWebSocket` gag "found" no overlay for 41 s while the socket probe showed the link had already been silent 7.0 s and was in CLOSING before the gag flipped; and a ONE-human room killed its own match socket unaided (1006, unclean, ~8 s after CREATE, 7 frames ever received, match running on regardless). Neither run is attested from. The capture now refuses to start unless the guest’s link is provably alive.',
  ),

  item(
    'a1-13-reconnect-button-is-never-drawn-on-either-kind-of-link-loss',
    'The report asked for reconnect AND abandon buttons: across 112 s, two kinds of link loss and five real matches, RECONNECT is never drawn — the card goes RECONNECTING… at 4 s and SEAT EXPIRED at 62 s, and ABANDON MATCH is the only choice a player is ever given',
    'online',
    'images/a1-13-linkloss-grace-t062005.png',
    '2026-08-10T14:55:15Z',
    'ffc414e',
    'failed',
    'THE ASK WAS TWO BUTTONS. *"I should get kicked out and presented reconnect / abandon buttons"* — and on the served build only one of them is reachable. Served `ffc414e`, real rooms on the real fleet, two humans, guest’s link cut, socket proven live first at 126-128 frames per 4 s. THE WHOLE GRACE WINDOW, PHOTOGRAPHED. One leg sampled the card every two seconds for 112 seconds and shot a frame at every change of title. Exactly two cards appear. At 4.0 s: `RECONNECTING…`, detail `no server data for 4s — reclaiming your seat, 56s of grace left.`, buttons `[ABANDON MATCH (177x44)]`. At 62.0 s: `SEAT EXPIRED — a bot flew your ship, match went on` in threat red, detail `Nothing left to reclaim — the reconnect window closed while you were away.`, buttons `[BACK TO MENU (160x44)]`. The complete set of buttons offered across the entire window is ABANDON MATCH and BACK TO MENU. RECONNECT: NEVER. The grace counter ticks the whole way down — 56s, 49s, and on — advertising a reclaim the card gives the player no way to ask for. TWO KINDS OF LOSS, THE SAME RESULT. A CLOSED socket (browser taken offline; the transport really hangs up) waited 90 s for `#pr-link-loss-reconnect` and never saw it. A SILENT socket (server→client frames dropped in a route handler, both ends still open, no close event — the developer’s zombie exactly, and the condition n6-01’s own edge produces with `?gag=1`) waited 60 s and never saw it either. So this is not one transport’s quirk. IT IS MECHANISM, NOT FLAKE, and the shipped source says so plainly. `pollLink` spends the automatic redial in the same call that detects the loss — "so the status handed back already says `redialing`". `session.reconnect` calls `transport.redial()`; if a dial STARTS it calls `watch.beginRedial`, which is phase `redialing`, and `linkNotice` draws that phase with ABANDON MATCH alone. The only path to a card bearing RECONNECT is `redialFailed`, and `redialFailed` is called in exactly one place — the `else` branch of that same line, when a dial could not start AT ALL. A dial that starts and then fails never returns the player to the lost card. So the phase that draws RECONNECT is reachable only in the case where the transport cannot even try, which is not the case a disconnected player is in. PART OF THIS IS DELIBERATE AND SAID SO IN THE SOURCE: `transportState` sends a genuinely closed socket "straight to `redialing` rather than asking a player to press RECONNECT at a transport that is already pressing it." That reasoning is sound for the seconds while a redial is in flight. What it does not cover is the other 58 seconds, during which the client shows a countdown, keeps the seat reclaimable, and offers no way to reclaim it — and then declares the window closed. WHAT I DID NOT ESTABLISH: whether the automatic redials were actually reaching the server and being refused, or failing at the socket. I have no seam for that and did not guess. The verdict is about what the player is shown, which is what the report was about, and it is checkable from the two committed frames: `a1-13-linkloss-grace-t004005.png` and `a1-13-linkloss-grace-t062005.png`.',
  ),

  item(
    'a1-13-served-build-submits-tens-of-draw-calls-at-390px-landscape',
    'What the shipped bundle actually submits at the 390 px landscape profile: 16.89 draw calls per frame, counted on the GL context itself over 540 frames — tens, not the 263 the renderer work started from',
    'mobile',
    'images/a1-13-drawcalls-phone-landscape.png',
    '2026-08-10T15:01:22Z',
    'ffc414e',
    'verified',
    'A DRAW CALL HERE MEANS WHAT THE BENCH MEANS BY IT: every `drawElements`, `drawArrays`, `drawElementsInstanced` or `drawArraysInstanced` on the WebGL context, counted by patching the two context prototypes from an init script BEFORE any context exists, so nothing about how the client builds or uses its renderer is changed — the calls are tallied on their way through. Frames come from a `requestAnimationFrame` chain in the same page, so `calls / frames` is one figure on one clock. Served `ffc414e`, live `?debug=1` match, viewport 844x390 with the canvas backing store confirmed at 844x390 and the client’s own `__planetRush.viewport` agreeing. THE NUMBER: three windows of 180 frames each — 16.80, 17.00 and 16.88 draw calls per frame, mean **16.89**, spread 0.2. Every one of the 17,440 calls counted was `drawElements`; no other entry point was used at all. The same instrument at desktop 1280x800 on the same build reads 17.55 (17.21 / 17.22 / 18.22) — within a call or two of the phone despite 3.9 times the pixels, which is what you expect of a count that is about what is SUBMITTED rather than about area. WHAT IS ON SCREEN WHEN THE NUMBER IS TAKEN, because a count with no picture behind it is not checkable: the committed frame shows WAVE 1/5 · Outer Drift, MATCH 0:32, the local station ringed in blue with its own ship beside it, the ORE 3 readout top-left, a 100/100 HOME bar top-right, the minimap plate bottom-right, the control legend along the bottom, and four asteroids around the edges. A modest scene, and that modesty is stated rather than glossed — see the inconclusive item beside this one. WHAT THIS ESTABLISHES: the shipped bundle at the profile the win was measured at submits on the order of seventeen draw calls a frame. a1-11’s starting point was 263. Whatever else is unproven, the order of magnitude the two merges claim is real on the served build, and it is real at 390 px. RESTING ON THE COUNT, NOT THE CLOCK, exactly as the brief instructs. This container is SwiftShader with no GPU; its frame times are a property of the box. They were recorded anyway so they could be discounted out loud rather than quietly dropped: 32.0-32.4 fps at 390 px, 18.3-19.5 fps at desktop, median frame 25.4-25.7 ms and 48.8 ms respectively. Zero page errors on either profile.',
  ),

  item(
    'a1-13-the-bench-figures-themselves-are-not-reproducible-on-the-served-build',
    'What I could NOT check: 10.9 desktop draw calls, 660→11 entities submitted, and “VfxAutoQuality no longer engaging” are all bench-scene numbers, and the one time I watched the flag long enough it engaged anyway',
    'mobile',
    'images/a1-13-density-03.png',
    '2026-08-10T15:04:15Z',
    'ffc414e',
    'inconclusive',
    'THE HEADLINE FIGURES DO NOT COME FROM THE GAME. 263 → 32.1 → 10.9 draw calls, and 660 → 11 entities submitted at 390 px, are all measurements of `spikes/atlas-pooling/bench.ts`, which builds its own scene — 8 ships, 32 turrets, 16 shields, 200 asteroids, 300 projectiles, 120 chunks, 668 entities — and drives the renderer directly. That is the right instrument for an A/B and it is not the shipped game, so the served build cannot be expected to return the same number and did not: 16.89 at 390 px against the bench’s 10.9-11. That difference is a different scene, NOT a regression, and it is not evidence either way. THREE THINGS BLOCK THE STRONGER CHECK. First, no shipped seam reports entities submitted, so `660 → 11` cannot be read off the live client at all — only draw calls can. Second, the bench’s dense scene is not reachable through the front door. Third, and this is the one that cost the round a measurement: I ran a 12-minute sweep at 844x390 sampling draw calls every 50 s, on the reasoning that asteroids arrive in waves and a client submitting the VIEW rather than the WORLD would hold flat as the field filled. IT DID HOLD FLAT — 16.97, 16.98, 16.95 — AND THEN IT FELL TO 13, WHICH IS NOT A CULL. The committed frames say why: samples 0 and 2 are the match (MATCH 0:12 and 2:01, WAVE 1/5); sample 3 is `ELIMINATED — 7th of 8, your reactor was destroyed`. An unpiloted client dies long before the field fills, and every sample from 169 s to 722 s is a MENU. a1-06 hit this exact trap on match length and wrote it down; I walked into it anyway. So the sweep tested two minutes of wave 1 and eleven minutes of an end screen, and it establishes nothing about culling under load. Closing it needs a client that stays alive, which needs a flown ship. THE VFX-QUALITY CLAIM IS FPS-DERIVED AND SO IT DOES NOT TRAVEL. `VfxAutoQuality` engages on sustained frame rate below 30 (`platform/vfx-quality.ts`), so on a GPU-less box its flag reports the container, not the renderer. It read `reduced: false, quality: 1` across all three 180-frame windows at 844x390 (~32 fps), which is consistent with the claim — and in the same session at desktop 1280x800 it engaged, `reduced: true, quality: 0.5`, at 18-19 fps. Same build, same class of scene, opposite answers, decided by pixel count on a software rasteriser. And on the long sweep at 390 px it held `reduced: false` for thirteen samples and then engaged at 722 s once fps sagged to 26.7. So: the flag did not engage at the 390 px profile over the window the claim is about, and that fact is worth exactly as much as this box’s frame rate is worth, which is why the verdict beside it rests on the draw-call count instead.',
  ),
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('manifest is not an array');

const before = manifest.length;
const seen = new Set(manifest.map((i) => i.id));
for (const e of ENTRIES) {
  if (seen.has(e.id)) throw new Error(`refusing to duplicate an existing id: ${e.id}`);
  manifest.push(e);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${before} -> ${manifest.length} (${ENTRIES.length} appended)`);
for (const e of ENTRIES) console.log(`  ${e.verdict.padEnd(12)} ${e.buildSha}  ${e.id}`);
