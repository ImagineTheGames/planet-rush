#!/usr/bin/env node
/**
 * evidence/summarize-actions-runs.mjs — one table over every live client session
 * captured for `online-actions` and `online-feel`. OWNER: QA Manager.
 *
 * The three symptoms are DISCRETE, so the evidence is counts, not averages, and
 * counts are only worth anything with their denominator attached. This reads every
 * COPY LOG export of the round and reports, per client session:
 *
 *   WAS IT ON THE WIRE? A session whose client had dropped can place orders that
 *   are never echoed and never will be, and that is not an echo defect. The build
 *   badge records it (`ef4babe` alone vs `ef4babe · d891dd0a (gru)`), and
 *   run.wire.atLog carries it per phase. Sessions that dropped are counted apart.
 *
 *   DID THE EXPORT KEEP EVERYTHING? The playtest log is a bounded ring and says so
 *   in `dropped`. A 13-minute session (m1) dropped 193 of its events and lost its
 *   own matchStart and build orders with them. Those sessions cannot answer a
 *   question about orders, and are excluded from the order counts BY NAME.
 *
 *   THE COUNTS. volleys with the firer's own shots alive (`inFlight`), orders,
 *   echoes split adopt/refused/unknown, and expiries.
 *
 *   node evidence/summarize-actions-runs.mjs [--json]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreLog } from './score-feel-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');

const rows = [];
for (const f of readdirSync(OUT).sort()) {
  const m = /^online-actions-(.+?)-(host|guest)-log\.json$/.exec(f);
  if (!m) continue;
  const [, tag, who] = m;
  const log = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  const r = scoreLog(`images/${f}`);
  // The run transcript knows whether this client was still on the wire.
  const runPath = join(OUT, `online-actions-${tag}-run.json`);
  const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : null;
  const atLog = run?.wire?.atLog?.[who] ?? null;
  const onWire = atLog ? atLog.server !== null : null;
  rows.push({
    tag,
    who,
    room: run?.room?.room ?? null,
    abundance: run?.abundance ?? 'scarce',
    durationMs: log.durationMs,
    droppedEvents: log.dropped,
    onWireAtLog: onWire,
    badgeAtLog: atLog?.badge ?? null,
    wheelOpened: run?.build?.[who]?.wheelCheck?.open ?? null,
    // A session that dropped events lost the beginning of its own action record.
    orderRecordComplete: log.dropped === 0,
    volleys: r.actions.volleys,
    inFlightHistogram: r.actions.inFlightHistogram,
    maxInFlight: r.actions.maxInFlight,
    orders: r.actions.orders,
    echoAdopted: r.actions.echoAdopted,
    echoRefused: r.actions.echoRefused,
    echoUnknown: r.actions.echoUnknown,
    expiries: r.actions.expiries,
    ordersWithoutEcho: r.actions.ordersWithoutEcho,
    waitedTicks: r.actions.waitedTicks,
    matchEvents: r.matchEvents.map((e) => `${e.msg}@${e.at}`),
    steadyStateMeanCorrection: r.steadyState.meanCorrection,
    steadyStateWorstCorrection: r.steadyState.worstCorrection,
    steadyStateSeconds: r.steadyState.seconds,
    sessionPasses: r.session.passes,
    outsideBreachPasses: r.outsideBreachWindow.passes,
    breachSeconds: r.breachWindow.seconds,
    breachCorrections: r.breachWindow.distinctWorstCorrections,
  });
}

/**
 * Every session that RECORDED build orders counts. An earlier version of this
 * also required `dropped === 0`, which threw away k1/guest — a session whose two
 * orders and two echoes are both present and consistent, and which happened to
 * drop one unrelated event near the end. The thing that would invalidate an order
 * count is orders MISSING from the export, and that shows up as a session with
 * taps in the run transcript and zero orders in the log (m1, which dropped 193
 * and 201 events over a thirteen-minute session and lost its own matchStart with
 * them). Those are named below rather than quietly folded in.
 */
const withOrders = rows.filter((r) => r.orders > 0);
const answered = withOrders.filter((r) => r.ordersWithoutEcho === 0);
const unanswered = withOrders.filter((r) => r.ordersWithoutEcho > 0);
const summary = {
  probe: 'online-actions across the round',
  sessions: rows.length,
  sessionsWithBuildOrders: withOrders.length,
  sessionsWhoseOrdersWereAllAnswered: answered.length,
  /** Orders with no echo, and WHY — in every case so far, a client that had
   *  already dropped off the wire, which the build badge records independently. */
  sessionsWithUnansweredOrders: unanswered.map((r) => ({
    session: `${r.tag}-${r.who}`,
    orders: r.orders,
    unanswered: r.ordersWithoutEcho,
    onWireAtLog: r.onWireAtLog,
    badgeAtLog: r.badgeAtLog,
  })),
  /** Sessions whose export lost events and so cannot be asked about orders. */
  exportsThatDroppedEvents: rows
    .filter((r) => r.droppedEvents > 0)
    .map((r) => ({ session: `${r.tag}-${r.who}`, dropped: r.droppedEvents, durationMs: r.durationMs })),
  orders: withOrders.reduce((a, r) => a + r.orders, 0),
  echoes: withOrders.reduce((a, r) => a + r.echoAdopted + r.echoRefused + r.echoUnknown, 0),
  adopted: withOrders.reduce((a, r) => a + r.echoAdopted, 0),
  refused: withOrders.reduce((a, r) => a + r.echoRefused, 0),
  unknown: withOrders.reduce((a, r) => a + r.echoUnknown, 0),
  expiries: withOrders.reduce((a, r) => a + r.expiries, 0),
  ordersWithoutEcho: withOrders.reduce((a, r) => a + r.ordersWithoutEcho, 0),
  volleysAllSessions: rows.reduce((a, r) => a + r.volleys, 0),
  inFlightAllSessions: rows.reduce((h, r) => {
    for (const [k, v] of Object.entries(r.inFlightHistogram)) h[k] = (h[k] ?? 0) + v;
    return h;
  }, {}),
  rows,
};

if (process.argv.includes('--json')) {
  writeFileSync(join(OUT, 'online-actions-summary.json'), JSON.stringify(summary, null, 2));
}

console.log(`\n  online-actions — every live client session of the round\n`);
for (const r of rows) {
  console.log(
    `   ${(r.tag + '/' + r.who).padEnd(11)} room ${String(r.room).padEnd(5)} ${String(r.abundance).padEnd(7)} ` +
      `wire ${r.onWireAtLog === true ? 'UP  ' : 'DOWN'} dropped ${String(r.droppedEvents).padStart(3)} | ` +
      `volleys ${String(r.volleys).padStart(3)} inFlight ${JSON.stringify(r.inFlightHistogram)} | ` +
      `orders ${r.orders} -> ${r.echoAdopted} adopt / ${r.echoRefused} refused / ${r.echoUnknown} unknown, ${r.expiries} expired`,
  );
}
console.log(
  `\n  BUILD ORDERS — ${summary.sessionsWithBuildOrders} of ${summary.sessions} sessions placed any.` +
    `\n   ${summary.orders} orders -> ${summary.echoes} echoes: ${summary.adopted} ADOPTED, ${summary.refused} refused, ` +
    `${summary.unknown} unknown, ${summary.expiries} expired, ${summary.ordersWithoutEcho} unanswered.`,
);
console.log(
  `  UNANSWERED: ${summary.sessionsWithUnansweredOrders.map((e) => `${e.session} ${e.unanswered}/${e.orders}, badge "${e.badgeAtLog}"`).join('; ') || 'none'}`,
);
console.log(
  `  EXPORTS THAT DROPPED EVENTS: ${summary.exportsThatDroppedEvents.map((e) => `${e.session} dropped ${e.dropped} over ${Math.round(e.durationMs / 1000)}s`).join('; ') || 'none'}`,
);
console.log(`  VOLLEYS, ALL ${summary.sessions} SESSIONS: ${summary.volleysAllSessions}, own shots alive ${JSON.stringify(summary.inFlightAllSessions)}\n`);
