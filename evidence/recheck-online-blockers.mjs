#!/usr/bin/env node
/**
 * recheck-online-blockers.mjs — is it worth re-capturing the online gates yet?
 *
 * The `online-reconnect` and `online-feel` gates are both FAILED, and not one of
 * the reasons is QA's to fix. Re-running the full capture round is expensive
 * (two live browser clients on two form factors, a HEAD fleet, ~40 minutes) and
 * pointless while the blockers stand. This asks the four questions that decide
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

/** 4. The telemetry tail. Not statically checkable — the accounting keeps
 *     re-charging one respawn teleport for ~5 s while the ship sits still. Left
 *     as a live re-measure, flagged so it is not forgotten when the rest clears. */
checks.push({
  id: 'respawn-correction-tail',
  gate: 'online-feel',
  owner: 'netcode',
  clear: null,
  want: 'mean correction and visual snaps inside docs/netcode-audit.md §5 across a session that contains a death',
  saw: 'not statically checkable — re-measure with feel-diagnose.live.test.ts; last read: 25.4 u / 18.0 u mean against a 1.5 u ceiling, all of it in one post-respawn window',
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
