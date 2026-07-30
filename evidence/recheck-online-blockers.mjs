#!/usr/bin/env node
/**
 * recheck-online-blockers.mjs — is it worth re-capturing the online gates yet?
 *
 * The `online-reconnect` and `online-feel` gates are both FAILED, and not one of
 * the reasons is QA's to fix. Re-running the full capture round is expensive
 * (two live browser clients on two form factors, a HEAD fleet, ~40 minutes) and
 * pointless while the blockers stand. This asks the five questions that decide
 * it, cheaply, and says BLOCKED or RECAPTURE.
 *
 *   node evidence/recheck-online-blockers.mjs
 *   node evidence/recheck-online-blockers.mjs --json > evidence/images/online-final-blockers-recheck.json
 *
 * Each check names the gate it gates and the lane that owns the fix. None of
 * them reads a test result: three read the shipped source at HEAD, one asks the
 * live fleet how old it is. Exit code is 0 when every blocker is clear.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAMESERVER_HEALTH = 'https://planet-rush-gameserver.fly.dev/health';

/** The last green `Deploy server (Fly.io)` run, as of this file being written.
 *  A live uptime that reaches back to here means the fleet is still that image. */
const LAST_GREEN_DEPLOY = '2026-07-29T08:25:09Z';
/** When #241 (`WelcomeMessage.economy` — the reconnect wallet) landed in server/. */
const WALLET_LANDED = '2026-07-30T11:09:00Z';

const read = (rel) => {
  try {
    return readFileSync(join(REPO, rel), 'utf8');
  } catch {
    return null;
  }
};

/** Ask the live gameserver how long it has been up, and work back to the image
 *  it is running. Network failure is reported as unknown, never as "clear". */
async function fleetAge() {
  try {
    const res = await fetch(GAMESERVER_HEALTH, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { reachable: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    const uptimeSeconds = Number(body.uptimeSeconds);
    if (!Number.isFinite(uptimeSeconds)) return { reachable: false, detail: 'no uptimeSeconds' };
    const bootedAt = new Date(Date.now() - uptimeSeconds * 1000);
    return {
      reachable: true,
      uptimeSeconds,
      uptimeHours: Number((uptimeSeconds / 3600).toFixed(1)),
      bootedAt: bootedAt.toISOString(),
      machine: body.machine ?? null,
      /** The wallet fix is running only if the image booted after it landed. */
      predatesWalletFix: bootedAt.getTime() < Date.parse(WALLET_LANDED),
      matchesLastGreenDeploy: Math.abs(bootedAt.getTime() - Date.parse(LAST_GREEN_DEPLOY)) < 6 * 3600 * 1000,
    };
  } catch (err) {
    return { reachable: false, detail: String(err?.message ?? err) };
  }
}

const checks = [];

/** 1. The deploy itself. One missing COPY line has frozen the fleet: the image's
 *     own `RUN npx tsc --noEmit` cannot resolve `../allocator/router`. */
{
  const dockerfile = read('server/Dockerfile') ?? '';
  const copiesAllocator = /^COPY\s+.*\ballocator\b/m.test(dockerfile);
  const routerImports = /from\s+'\.\.\/allocator\/router'/.test(read('server/upgrade-router.ts') ?? '');
  checks.push({
    id: 'deploy-image-builds',
    gate: 'online-reconnect',
    owner: 'deploy/CI',
    clear: copiesAllocator || !routerImports,
    want: 'server/Dockerfile copies allocator/ into the build stage',
    saw: copiesAllocator
      ? 'Dockerfile copies allocator/'
      : `Dockerfile has no COPY for allocator/, and server/upgrade-router.ts ${routerImports ? 'imports ../allocator/router' : 'no longer imports it'}`,
  });
}

/** 2. The wire validator. `upgradeOrder` is the sixth verb of the Action union
 *     and parseActions has no case for it — `default: return null` throws the
 *     whole input tick away, so "upgrades restored" cannot even be tested. */
{
  const wire = read('src/net/wire.ts') ?? '';
  const hasUpgradeCase = /case\s+'upgradeOrder'/.test(wire);
  const buildItems = wire.match(/const BUILD_ITEMS[^;]*;/s)?.[0] ?? '';
  const hasSatellite = /'satellite'/.test(buildItems);
  checks.push({
    id: 'wire-accepts-upgrade-order',
    gate: 'online-reconnect',
    owner: 'netcode',
    clear: hasUpgradeCase && hasSatellite,
    want: "parseActions has a case for 'upgradeOrder', and BUILD_ITEMS contains 'satellite'",
    saw: `case 'upgradeOrder': ${hasUpgradeCase ? 'present' : 'ABSENT'}; BUILD_ITEMS satellite: ${hasSatellite ? 'present' : 'ABSENT'}`,
  });
}

/** 3. The capture tool for the feel gate. The landscape lock enters ELEMENT
 *     fullscreen on the game root; a button mounted on document.body is outside
 *     that subtree, so on a phone it is neither painted nor hit-tested. */
{
  const button = read('src/net/playtest-log-button.ts') ?? '';
  const mountsOnBody = /const host = this\.config\.dom\.body/.test(button);
  checks.push({
    id: 'copylog-pressable-on-phone',
    gate: 'online-feel',
    owner: 'platform/UI',
    clear: !mountsOnBody,
    want: 'the COPY LOG affordance mounts inside the element the landscape lock fullscreens',
    saw: mountsOnBody
      ? 'installCopyLogButton still mounts into document.body (outside the fullscreen subtree)'
      : 'mount target is no longer document.body — re-run probe-copylog-reach.mjs to confirm PRESSABLE on both phone profiles',
  });
}

/** 4. The post-respawn correction tail. This was carried as UNKNOWN until
 *     2026-07-30T15:50Z, when `respawn-tail.live.test.ts` watched both terms of
 *     the correction across a real death and found neither of them moving: the
 *     checkpoint frozen at HOME, authority frozen at the DEATH SITE, 1228.217 u
 *     apart for 298 ticks — which at TICK_DT 1/60 is 4.97 s, i.e. RESPAWN_S.
 *
 *     The cause is one absence, and an absence IS statically checkable: the
 *     respawn countdown never crosses the wire. `killShip` sets
 *     `respawnTimer = RESPAWN_S` and only authority runs it; `ShipSnap` carries
 *     an `alive` bit and no timer; `applySnapshot` writes `alive` and never
 *     writes `respawnTimer`. So the client's ship goes dead with its timer at 0
 *     and `step()`'s `if (ship.respawnTimer <= 0) respawn(ship)` resurrects it
 *     at home on the very next replay — the full 5 s before authority does. */
const snapshotSrc = read('src/net/snapshot.ts') ?? '';
const predictionSrc = read('src/net/prediction.ts') ?? '';
const applyBody = predictionSrc.slice(predictionSrc.indexOf('export function applySnapshot'));
const wireCarriesTimer = /respawnTimer/.test(snapshotSrc);
const applyRestoresTimer = /respawnTimer/.test(applyBody.slice(0, 4000));
checks.push({
  id: 'respawn-countdown-crosses-the-wire',
  gate: 'online-feel',
  owner: 'netcode',
  clear: wireCarriesTimer || applyRestoresTimer,
  want: "the client can know how much of authority's respawn countdown is left — `respawnTimer` streamed in ShipSnap, or restored by applySnapshot, or the local ship held dead until authority revives it",
  saw:
    wireCarriesTimer || applyRestoresTimer
      ? `snapshot.ts mentions respawnTimer: ${wireCarriesTimer}; applySnapshot mentions it: ${applyRestoresTimer} — re-measure with respawn-tail.live.test.ts to confirm the tail is gone`
      : 'snapshot.ts carries NO respawnTimer and applySnapshot never restores it — so the client respawns the instant authority reports the ship dead, and every reconcile for the next RESPAWN_S (5 s) charges the whole death-site→home distance. MEASURED 2026-07-30T15:50Z, live, room SWQD (images/online-feel-respawn-tail.json): 150 consecutive reconciles, ONE distinct error value 1228.217 u, checkpoint frozen at home (1968.841, 1200), authority frozen at the death site (744, 1291), histHit true and resynced false throughout — the instrument is right and the two states genuinely disagree. Visual snaps stay at 1 because absorb() sees home before and home after, so this never looked like a teleport; what it looks like instead is a ship pinned within ±4 u of home for ~5 s while thrust is held down.',
});

const fleet = await fleetAge();
checks.push({
  id: 'fleet-runs-the-wallet-fix',
  gate: 'online-reconnect',
  owner: 'deploy/CI',
  clear: fleet.reachable ? !fleet.predatesWalletFix : null,
  want: `the live gameserver runs an image built after #241 landed (${WALLET_LANDED})`,
  saw: fleet.reachable
    ? `up ${fleet.uptimeHours} h, booted ${fleet.bootedAt}${fleet.matchesLastGreenDeploy ? ' — that is the last GREEN deploy, ' + LAST_GREEN_DEPLOY : ''}`
    : `gameserver /health unreachable: ${fleet.detail}`,
});

/** 6. The front door itself, found 2026-07-30T17:05Z while trying to capture the
 *     feel gate: the desktop online lobby has no pressable RUSH! button. The
 *     connect-trace panel (`pr-connect-trace`, fafff19) is hidden with the HTML
 *     `hidden` attribute, but its own id rule sets `display:flex`, which beats
 *     the user agent's `[hidden]{display:none}` — so it stays laid out, painted
 *     and hit-testable at (400,673) 480x111, right over the RUSH! rect at
 *     (500,712) 280x56. `elementFromPoint` at the button's centre answers LI.
 *     Measured in evidence/probe-rush-reach.mjs → images/rush-reach.json.
 *
 *     Statically: the fix is either a `[hidden]` rule that restores display:none
 *     or `pointer-events:none` on the root, so look for either. */
{
  const view = read('src/net/connect-trace-view.ts') ?? '';
  const css = view.match(/const CONNECT_TRACE_CSS[\s\S]*?;\n/)?.[0] ?? '';
  // Only two things in the STYLESHEET can stop the panel eating the press: a
  // rule that makes `hidden` mean display:none again, or pointer-events:none.
  // Deliberately NOT keyed on `remove()` appearing somewhere in the module —
  // teardown helpers use it and the first draft of this check read them as a
  // fix, reporting CLEAR for a defect I had just measured as BLOCKED.
  const hiddenRule = /\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(css);
  const pointerNone = /pointer-events\s*:\s*none/.test(css);
  checks.push({
    id: 'rush-pressable-on-desktop',
    gate: 'online-feel',
    owner: 'netcode/UI',
    clear: hiddenRule || pointerNone,
    want:
      'the connect-trace panel stops covering the online lobby when hidden — a `#pr-connect-trace[hidden]{display:none}` rule, or `pointer-events:none` on the root',
    saw:
      hiddenRule || pointerNone
        ? 'the panel can no longer swallow the press — re-run probe-rush-reach.mjs to confirm PRESSABLE on desktop-online'
        : 'the panel still sets only `hidden`, while its id rule keeps `display:flex` and `pointer-events:auto` — so RUSH! stays covered and an online match cannot be started with a mouse',
  });
}

const blocked = checks.filter((c) => c.clear === false);
const unknown = checks.filter((c) => c.clear === null);
const verdict = blocked.length > 0 ? 'BLOCKED' : unknown.length > 0 ? 'RECAPTURE-TO-CONFIRM' : 'RECAPTURE';

const report = { checkedAt: new Date().toISOString(), verdict, fleet, checks };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n  online gate blockers — ${report.checkedAt}\n`);
  for (const c of checks) {
    const mark = c.clear === true ? 'CLEAR  ' : c.clear === false ? 'BLOCKED' : 'UNKNOWN';
    console.log(`  [${mark}] ${c.id}  (${c.gate}, ${c.owner})`);
    console.log(`            want: ${c.want}`);
    console.log(`            saw:  ${c.saw}\n`);
  }
  console.log(`  VERDICT: ${verdict}`);
  console.log(
    verdict === 'BLOCKED'
      ? `  ${blocked.length} blocker(s) stand. Re-capturing the gates cannot change their verdicts yet.\n`
      : `  Nothing static is blocking. Re-run capture-online-feel.mjs and online-final.live.test.ts.\n`,
  );
}

process.exit(blocked.length === 0 ? 0 : 1);
