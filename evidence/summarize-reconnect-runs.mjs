#!/usr/bin/env node
/**
 * evidence/summarize-reconnect-runs.mjs — one table over every `online-reconnect`
 * run captured in a round. OWNER: QA Manager.
 *
 * The gate is not "a green run exists"; it is "the run is green REPEATEDLY, and
 * each green run actually PROVED the thing it claims". Those are different
 * questions and a single transcript answers neither, so this reads every
 * transcript from the round and reports both — including the runs that failed,
 * which are the reason the instrument changed shape twice on 2026-07-30:
 *
 *   1. `prefix-short-*` — compared the reclaimed ship against the RECLAIM
 *      WELCOME's wallet. Authority is free to move the wallet after that frame
 *      (room 638B: a tick-1018 `economy` frame took held 1 → 0 with banked
 *      unchanged — she was shot and dropped the hold, GDD §2.7). The client had
 *      followed authority correctly and the assertion charged it anyway.
 *   2. `latestwallet-*` — compared against authority's LATEST frame instead.
 *      Correct target, but banking is continuous, so mid-deposit the two are a
 *      fraction of a second apart and both right (run 4: 3.167 vs 3.233).
 *   3. `short-*` / `long-*` — wait for the wallet to QUIESCE, then compare
 *      exactly. This is the shipped instrument.
 *
 * `heldThirdProven` is the falsifier: `cargo === held` is satisfied by 0 === 0,
 * which is what a run reports when the stand-in banked the hold, or when she was
 * dead at reclaim (`alive: false`). Those runs prove the BANK and TIER thirds and
 * the HOLD third not at all, and are counted as such rather than as green.
 *
 * ROUNDS. Each capture round writes its transcripts under its own prefix, so the
 * round being tabulated is named rather than assumed — a summary that silently
 * swept in a previous build's runs would be the worst possible kind of green.
 *
 *   node evidence/summarize-reconnect-runs.mjs [round] [--json]
 *     round defaults to `online-close2` (the 5a545f0 round); pass `online-close3`
 *     for the ef4babe round. Output goes to images/<round>-repeatability.json.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');

/** The round to tabulate — the transcript filename prefix, and the output name. */
const ROUND = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'online-close2';

const GROUPS = [
  ['prefix-short', 'compared to the reclaim WELCOME (stale target) — 1.5 s away'],
  ['latestwallet', "compared to authority's LATEST frame, no quiesce — 1.5 s away"],
  ['short', 'quiesced wallet, 1.5 s away — the shipped instrument'],
  ['long', 'quiesced wallet, 18 s away — the shipped instrument'],
];

const rows = [];
for (const [group, note] of GROUPS) {
  const files = readdirSync(OUT)
    .filter((f) => f.startsWith(`${ROUND}-${group}-run`) && f.endsWith('.json'))
    .sort();
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
    const welcome = j.reclaimWelcomeEconomy ?? null;
    const latest = j.authoritysLatestWallet ?? welcome;
    const ship = j.afterReclaimAlice ?? null;
    const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
    rows.push({
      file: f,
      group,
      note,
      room: j.room ?? null,
      machine: j.machine ?? null,
      awayMs: j.awayMs ?? null,
      quiesced: j.walletQuiesced ?? null,
      upgradeLanded: j.upgradeLanded ?? null,
      authorityTierAfterOrder: j.authorityTierAfterOrder ?? null,
      reclaimedSameSeat: j.reclaimedSameSeat ?? null,
      substitutionSeenByPeer: j.substitutionSeenByPeer ?? null,
      joinWelcomeCarriedEconomy: j.joinWelcomeCarriedEconomy ?? null,
      reclaimWalletIsSpawnDefault: j.reclaimWalletIsSpawnDefault ?? null,
      wireHeld: latest ? latest.held : null,
      wireBanked: latest ? latest.banked : null,
      wireTierCargo: latest ? latest.tiers.cargo : null,
      shipCargo: ship ? ship.cargo : null,
      shipBanked: ship ? ship.banked : null,
      shipTierCargo: ship ? ship.tiers.cargo : null,
      shipCargoCap: ship ? ship.cargoCap : null,
      shipAlive: ship && 'alive' in ship ? ship.alive : null,
      economyMovedAfterReclaimWelcome: j.economyMovedAfterReclaimWelcome ?? null,
      // A run that never got back on the wire at all. Recorded with the REASON
      // authority gave, because `grace-expired` or `room-full` would be the client
      // returning wrongly while `bad-ticket` is Fly's edge landing the redial on
      // the wrong Machine — the fleet's known socket-hop pin, not a game defect.
      reclaimFailed: j.reclaimTimedOut === true || typeof j.reclaimError === 'string',
      reclaimError: j.reclaimError ?? null,
      joinErrorsPastDrop: j.joinErrorsPastDrop ?? null,
      joinErrorReasonsPastDrop: j.joinErrorReasonsPastDrop ?? null,
      // The transcripts from before the fix predate the `heldThirdProven` field,
      // so derive it from what they DID record rather than reporting a missing
      // field as "not proven" — that would understate the earlier runs.
      heldThirdProven: j.heldThirdProven ?? (latest ? latest.held > 0 : null),
      // Did the ship end up carrying exactly what authority last said it should?
      matchesAuthority:
        !!ship &&
        !!latest &&
        near(ship.cargo, latest.held) &&
        near(ship.banked, latest.banked) &&
        ship.tiers.cargo === latest.tiers.cargo,
    });
  }
}

const shipped = rows.filter((r) => r.group === 'short' || r.group === 'long');
const reclaimed = shipped.filter((r) => !r.reclaimFailed);
const failed = shipped.filter((r) => r.reclaimFailed);
const summary = {
  probe: 'online-reconnect repeatability',
  round: ROUND,
  runs: rows.length,
  shippedInstrumentRuns: shipped.length,
  // Denominators kept apart on purpose. A run that never got back on the wire
  // cannot say anything about what the reclaimed ship carried, so it is neither
  // green nor a wallet failure — it is a REACH failure, counted separately and
  // named. Rolling the two together would let a flaky edge read as a game defect,
  // or a real wallet defect hide behind "well, that one didn't connect".
  reclaimReached: reclaimed.length,
  reclaimFailed: failed.length,
  reclaimFailures: failed.map((r) => ({
    room: r.room,
    error: r.reclaimError,
    joinErrorsPastDrop: r.joinErrorsPastDrop,
    reasons: r.joinErrorReasonsPastDrop,
  })),
  shippedInstrumentGreen: reclaimed.filter((r) => r.matchesAuthority).length,
  shippedInstrumentProvingHeldThird: reclaimed.filter((r) => r.heldThirdProven && r.matchesAuthority)
    .length,
  tierBoughtOverTheWireInEveryRun: rows.every((r) => r.authorityTierAfterOrder >= 1),
  sameSeatInEveryReachedRun: reclaimed.every((r) => r.reclaimedSameSeat === true),
  peerSawSubstitutionInEveryRun: rows.every((r) => r.substitutionSeenByPeer === true),
  machines: [...new Set(rows.map((r) => r.machine).filter(Boolean))],
  rooms: rows.map((r) => r.room),
  rows,
};

if (process.argv.includes('--json')) {
  writeFileSync(join(OUT, `${ROUND}-repeatability.json`), JSON.stringify(summary, null, 2));
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  online-reconnect — every run of the round\n`);
let lastGroup = null;
for (const r of rows) {
  if (r.group !== lastGroup) {
    console.log(`\n  ${r.group.toUpperCase()} — ${r.note}`);
    lastGroup = r.group;
  }
  if (r.reclaimFailed) {
    // Say NEVER GOT BACK, not DIVERGES. The wallet comparison was never made in
    // this run, and printing it as a mismatch would invent a defect.
    console.log(
      `   ${pad(r.room, 6)} ${pad(r.awayMs + 'ms', 8)} tier ${r.authorityTierAfterOrder} bought | NEVER GOT BACK ON THE WIRE — ` +
        `${r.joinErrorsPastDrop} joinError(s) past the drop, reason(s) ${JSON.stringify(r.joinErrorReasonsPastDrop ?? 'not recorded by this run')}`,
    );
    continue;
  }
  console.log(
    `   ${pad(r.room, 6)} ${pad(r.awayMs + 'ms', 8)} tier ${r.wireTierCargo} | wire held ${pad(
      Number(r.wireHeld).toFixed(2),
      6,
    )} banked ${pad(Number(r.wireBanked).toFixed(2), 6)} | ship cargo ${pad(
      Number(r.shipCargo).toFixed(2),
      6,
    )} banked ${pad(Number(r.shipBanked).toFixed(2), 6)} cap ${r.shipCargoCap} alive ${pad(
      r.shipAlive,
      5,
    )} | ${r.matchesAuthority ? 'MATCHES AUTHORITY' : 'DIVERGES         '} | held third ${
      r.heldThirdProven ? 'PROVEN' : 'not proven (nothing held)'
    }`,
  );
}
console.log(
  `\n  SHIPPED INSTRUMENT: ${summary.shippedInstrumentRuns} runs — ${summary.reclaimReached} got back on the wire, ${summary.reclaimFailed} did not.` +
    `\n  Of the ${summary.reclaimReached} that got back: ${summary.shippedInstrumentGreen} match authority exactly; ` +
    `${summary.shippedInstrumentProvingHeldThird} of those carried held ore and so proved the HOLD third.`,
);
console.log(
  `  Tier bought over the wire in every run: ${summary.tierBoughtOverTheWireInEveryRun}. ` +
    `Same seat in every reached run: ${summary.sameSeatInEveryReachedRun}. ` +
    `Peer saw the substitution in every run: ${summary.peerSawSubstitutionInEveryRun}. ` +
    `Machines: ${summary.machines.join(', ')}\n`,
);
