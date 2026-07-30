#!/usr/bin/env node
/**
 * evidence/_close2-entries.mjs — rewrite the two `online-*` manifest entries for
 * the M10 closing round, captured 2026-07-30 21:31Z–22:05Z on build 5a545f0.
 * OWNER: QA Manager. Idempotent: run it again and the entries are replaced.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'manifest.json');

const entries = [
  {
    id: 'online-reconnect',
    title:
      'Reconnect mid-match on the LIVE fleet, re-witnessed on 5a545f0 across FOURTEEN runs on three machines: the player buys a CARGO tier over her own socket, drops, and reclaims the same seat with the tier, the bank and the hold intact — 7 of 7 runs of the shipped instrument match authority exactly, 5 of them carrying held ore. Two flaws in the INSTRUMENT were found and fixed on the way, and both had been charging the client for authority doing its job',
    area: 'online',
    image: 'images/online-close2-repeatability.json',
    capturedAt: '2026-07-30T22:00:52Z',
    buildSha: '5a545f0',
    verdict: 'verified',
    attestation: `SELF-WITNESSED, 2026-07-30T21:47Z–22:01Z, against the DEPLOYED Fly fleet over the real internet, driving the SHIPPED src/net client modules (allocateRoom/joinRoom → createOnlineSession → allocatorTransport over the browser-global WebSocket). Instrument: evidence/online-close.live.test.ts. Every run of the round is committed verbatim under images/online-close2-*.json and tabulated by evidence/summarize-reconnect-runs.mjs into images/online-close2-repeatability.json. Nothing below the wire is mocked, stubbed or privileged.

THE BUILD IS ONE BUILD. The deployed client's version.json reports sha 5a545f0 built 2026-07-30T21:26:51Z; the live gameserver answered /health from the image deployed for the same commit; and this branch is rebased onto 5a545f0, so repo, client and server are the same commit. (The previous round's evidence was 3d7cc6a; #252 landed and the fleet redeployed underneath it, which is why this gate was re-witnessed rather than inherited.)

WHAT EVERY RUN WITNESSES, AT THE WIRE. Every wallet figure is AUTHORITY'S — read off the server's own economy channel and off the raw welcome frame's JSON, never off the client's optimistic prediction:
  1. UPGRADES — docked at her own station, Alice orders CARGO tier 1 (cost 2 out of STARTING_ORE 3). Authority's economy frame reports tiers.cargo 0 → 1. THIS HAPPENED IN ALL 14 RUNS, no exceptions.
  2. BANK — the same frame reports banked moved off the spawn default of 3 (to 1 after the purchase).
  3. CARGO — she flies out and shoots rock until authority reports held >= 1.
Then the socket is severed with no goodbye, a stand-in flies her ship, and she redials inside grace. In all 14 runs she reclaimed THE SAME SEAT, the peer saw the substitution, the reclaim welcome carried the wallet (WelcomeMessage.economy) and the original lobby join did not — there was no ship yet — and the reclaimed wallet was never the spawn default. cargoCap reads 4 against a stock 3, so the restored tier is an upgrade and not a number in a field.

THE HEADLINE, FROM images/online-close2-repeatability.json: the shipped instrument ran 7 times (5 × 1.5 s away, 2 × 18 s away) across machines 0800d5b6d62328, 6836293b5161d8 and d891dd0a1443e8, and in 7 of 7 the reclaimed ship carried EXACTLY what authority last said it should — held, banked and tiers. Five of those seven runs had held ore on the wire at reclaim and so PROVED the hold third outright (rooms 5PMD held 2.03, 2UVX held 1, CELU held 1, YREB held 2, and the 18 s-away J6PA held 2). The other two proved the bank and tier thirds and are recorded as not proving the hold third rather than counted green — see below.

I FOUND TWO FLAWS IN MY OWN INSTRUMENT AND BOTH WERE BLAMING THE CLIENT FOR AUTHORITY DOING ITS JOB. This is the substance of the round and I am reporting it as prominently as the green, because the previous round's verdict rested on two samples and would have kept resting on them:
  (1) THE STALE TARGET. The test compared the reclaimed ship against the RECLAIM WELCOME's wallet. The match does not pause for that frame. In room 638B (images/online-close2-prefix-short-run2.json) authority sent a FOURTH economy frame at tick 1018, afterDrop true, moving held 1 → 0 with banked UNCHANGED at 1 — ore that is not banked and not held has been dropped, which is what death does to a hold (GDD §2.7). The client had followed authority's newest frame correctly and my assertion charged it with losing the ore. Run this shape three times and it fails about one time in three, which is exactly the "intermittent client defect" I was one step from reporting.
  (2) THE MOVING TARGET. Comparing against authority's LATEST frame instead is the right target but not sufficient: banking is continuous, so mid-deposit the ship and the newest frame are both correct and a fraction of a second apart (room PCVJ, images/online-close2-latestwallet-run4.json: ship 3.167 vs wire 3.233). Exact equality there measures the read instant, not the reclaim.
  THE FIX, in evidence/ only: wait for the wallet to QUIESCE — no new economy frame for 1.5 s, bounded at 12 s — then compare exactly against authority's latest. All 7 runs since quiesce true, 7 of 7 match.

AND ONE FALSIFIER ADDED, BECAUSE 'cargo === held' IS SATISFIED BY 0 === 0. A run in which the stand-in banked the hold before the reclaim, or in which she was dead at the reclaim, proves the bank and tier thirds and the HOLD third not at all — yet it passes. The transcript now records heldThirdProven, and the ship's alive/hull alongside its wallet, so those runs are visible instead of silently counted. Two runs this round were exactly that, and the new field named them: room J47E and room 353U, both with alive FALSE at reclaim — she was dead, so the hold was gone by the rules, not by a defect. Without that field those two are indistinguishable from proof.

VERDICT: VERIFIED — the reconnect gate is green on 5a545f0, repeatably (7/7), on three machines, with the hold third proven outright in five separate runs and the tier bought over a real socket in all fourteen. The two corrections above are to QA's instrument and change no game code.`,
  },
  {
    id: 'online-feel',
    title:
      'Online feel on 5a545f0: the front door is fixed and both COPY LOG exports score SIX OF SIX against the audit — but neither client died in that match, and the death path re-measured on the same build still charges 149 reconciles of 1 346.691 u across 4 924 ms. The gate passes only in a run where nobody dies, which is not a passing feel gate',
    area: 'online',
    image: 'images/online-feel-pc-roster.png',
    capturedAt: '2026-07-30T21:34:15Z',
    buildSha: '5a545f0',
    verdict: 'failed',
    attestation: `SELF-WITNESSED, 2026-07-30T21:31Z–22:05Z, on the DEPLOYED client (https://imaginethegames.github.io/planet-rush/, version.json sha 5a545f0 built 21:26:51Z) against the live Fly fleet, over the real internet. The capture tool is the game's OWN COPY LOG button (evidence/capture-online-feel.mjs); both exports are committed verbatim as images/online-feel-pc-host-log.json and -guest-log.json and scored by evidence/score-feel-log.mjs against docs/netcode-audit.md §5 into images/online-feel-score.json.

THE FRONT DOOR IS FIXED AND THE WHOLE WALK IS REAL. I looked at every frame. images/online-feel-pc-guest-keypad.png: "ENTER THE ROOM CODE" with 2 A T 9 typed into the four boxes on the A–Z/2–9 keypad, BACK · ERASE · JOIN below. images/online-feel-pc-roster.png (this entry's image): the host's lobby, ROOM 2AT9 in plasma top right, MODE · FFA, ORE · SCARCE, P1 "YOU ★ VANGUARD · AZURE" and — the thing that matters — P2 "PLAYER 2 · VANGUARD · CYAN" seated as a HUMAN, carrying neither the OPEN tag nor the EASY/MEDIUM/HARD badge that all six bots below it carry; "2 PLAYING · 6 BOTS"; and the RUSH! button at bottom centre with NOTHING over it. The capture recorded rushPressLanded true and rushViaSeam FALSE — the press was a real mouse click, not the seam — and needed one attempt per door. images/online-feel-pc-host-match.png and -guest-match.png are the same live match from both seats: WAVE 1/5 · Outer Drift, MATCH 0:42 and 0:44, TOTAL 3 on both, host HOME 98/100 blue, guest HOME 100/100 teal with a P3 station at bottom left, asteroids and loose ore, minimap bottom right, and the build watermark "5a545f0 · 21:26Z" in both. Both logs record matchStart with the SAME seed, 1323978413. images/online-feel-pc-host-copylog.png and -guest-copylog.png: the PAUSED overlay (RESUME / SETTINGS / EXIT TO MENU) with the plasma button bottom right already pressed, reading "LOG COPIED" over "Log copied — paste it into chat." The connect-trace panel is absent from every one of those frames.

THE NUMBERS, QUOTED FROM THE EXPORTS. Both open "Planet Rush playtest log — build 5a545f0 (2026-07-30T21:26:51.810Z) · desktop 1280x800 · net 4g · planet-rush.playtest-log/1", dropped 0.
  HOST — 72 finalized seconds, 2 258 reconciles, RTT mean 1 141 ms / max 4 346 ms, jitter 136 ms:
    worst correction 1.755 u (<= 4) PASS · mean correction 0.283 u (<= 1.5) PASS · visual snaps 0 (= 0) PASS ·
    mean lead 27.6 t (<= 32) PASS · peak lead 60 t (<= 120) PASS · misprediction 0.044 (<= 0.5) PASS → SIX OF SIX.
  GUEST — 116 finalized seconds, 3 506 reconciles, RTT mean 992 ms / max 3 168 ms, jitter 99 ms:
    worst correction 1.809 u PASS · mean correction 0.19 u PASS · visual snaps 0 PASS ·
    mean lead 25.8 t PASS · peak lead 65 t PASS · misprediction 0.031 PASS → SIX OF SIX.
  Breach window: 0 s on BOTH clients. On a wire whose worst round trip touched 4.3 s, ordinary online flight is nowhere near the audit's limits, and the lead ratchet #244 bounded is provably still gone.

AND THAT IS EXACTLY WHY I AM NOT PASSING THIS GATE. NEITHER CLIENT DIED IN THAT MATCH. I checked the event streams rather than the score: the host log carries one matchStart at 41 757 ms and no death; the guest log carries one matchStart at 39 084 ms and no death. A breach window of 0 s is not evidence that the defect is gone — it is what a death-free run looks like, and the known defect fires only after a death. Scoring six of six on it and calling the gate green would be the averaging-away this gate exists to prevent.

SO I RE-MEASURED THE DEATH PATH ON THIS BUILD RATHER THAN INHERIT LAST ROUND'S. evidence/respawn-tail.live.test.ts, live, 21:46:56Z, room 8UBA, build 5a545f0 (images/online-feel-respawn-tail.json): 1 481 reconciles recorded, of which 149 breach across 4 924 ms — RESPAWN_S is 5 s — with ONE distinct error value, 1 346.691 u, to three decimals, for the entire window. The checkpoint is frozen at (1968, 1199.159), which is her home; authority is frozen at (712, 1685), which is where she died; histHit true and resynced false throughout, so both terms are present and simply disagree. Last round's number on 3d7cc6a was 1 276.989 u by the same shape — the value is the death-site-to-home distance, so it moves with where you die and the defect does not.

I ALSO HAD TO FIX MY OWN INSTRUMENT TO GET THAT, AND THE FIX SHARPENED THE FINDING. The probe's first run on 5a545f0 reported 3 003 reconciles and ZERO breaches — which reads like a fix and was nothing of the kind: it only ever watched for a breach, so a run in which the bots never killed her was indistinguishable from a run in which the defect was gone. It now records deathsObserved, deadReconciles, minHullSeen and stops on a DEATH as well as on a breach. What that added column then showed is stronger than the original diagnosis: in the breaching run, minHullSeen is 0 — the ship's hull reached zero, she really died — while deathsObserved is 0 and deadReconciles is 0. The client's own predicted ship is NEVER OBSERVED NOT-ALIVE, not for one reconcile. It is at (1968, ~1195), drifting a few units at home, for the whole 4.9 s in which authority holds it dead at (712, 1685).

THE CAUSE, READ OUT OF THE SHIPPED SOURCE MYSELF. applyShipSnapshot (src/net/prediction.ts:808) restores alive, eliminated and spawnProtect from the wire but never respawnTimer, and ShipSnap (src/net/snapshot.ts) does not carry one. step() (src/sim/step.ts:200) respawns any not-alive, not-eliminated ship the moment that timer reaches zero — and on the client it is already zero. So the client resurrects her at home on the very next replayed tick while authority keeps her dead for the full RESPAWN_S, and every reconcile in between charges the whole distance. Note what the player sees: absorb() sees home before and home after, so this is not a teleport — it is a ship pinned within a few units of home for five seconds while thrust is held down.

THE MOBILE HALF IS STILL BLOCKED AND I RE-CHECKED IT ON THIS BUILD. evidence/probe-copylog-reach.mjs, 22:02Z, 5a545f0 (images/copylog-reach.json): desktop — in the DOM, rect in the viewport, elementFromPoint at its own centre answers playtest-copy-log-button, PRESSABLE true. phone-portrait-held and phone-landscape — in the DOM, rect in the viewport, and elementFromPoint answers CANVAS with the fullscreen element being DIV#app: PRESSABLE false, because installCopyLogButton still mounts into document.body while the landscape lock fullscreens #app. This gate still cannot be captured end-to-end through the shipped UI on a phone.

VERDICT: FAILED. Not on the numbers I captured — those are six of six twice over and the front door, the two-human match and both real COPY LOG presses are all genuinely fixed and are the good news of this round. It fails because the run that produced those numbers contained no death, and the death path on the SAME BUILD, measured the same day, still breaches MAX_CORRECTION_UNITS, MAX_MEAN_CORRECTION_UNITS and MAX_VISUAL_SNAPS for five seconds after every death. TWO defects handed back, neither QA's: (1) the post-respawn divergence — OWNER: Netcode — stream respawnTimer in ShipSnap, or restore it in applyShipSnapshot, or hold the local ship dead until authority revives it; this is the single reason this gate is not green; (2) the fullscreen-orphaned COPY LOG affordance on mobile — OWNER: Platform/UI — mount it inside #app. Re-run node evidence/recheck-online-blockers.mjs before spending another capture round: it reports 4 of 6 blockers CLEAR and names these two.`,
  },
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const entry of entries) {
  const i = manifest.findIndex((e) => e.id === entry.id);
  if (i === -1) manifest.push(entry);
  else manifest[i] = entry;
  console.log(`${i === -1 ? 'added' : 'replaced'} ${entry.id} → ${entry.verdict}`);
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest now holds ${manifest.length} entries`);
