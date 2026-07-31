#!/usr/bin/env node
/**
 * evidence/score-feel-log.mjs — score an exported COPY LOG against the audit.
 * OWNER: QA Manager.
 *
 * The `online-feel` gate is "numbers against the audit's thresholds, not vibes".
 * This reads the JSON the COPY LOG button put on the clipboard (as committed by
 * `capture-online-feel.mjs`) and scores it against docs/netcode-audit.md §5 —
 * and, because the interesting part of every run so far has been WHERE the
 * breaches sit rather than that they exist, it also splits the session into the
 * seconds that breach and the seconds that do not.
 *
 *   node evidence/score-feel-log.mjs images/online-feel-pc-host-log.json [...]
 *   node evidence/score-feel-log.mjs --json <files...> > images/online-feel-score.json
 *
 * The mean correction is weighted by each second's reconcile count, because a
 * second with 40 reconciles and a second with 4 are not equal evidence.
 *
 * TWO THINGS THE SESSION AVERAGE CANNOT SAY, added for the M10 close:
 *
 *   STEADY STATE. The developer's report was "corr sits at 0.3–0.6 u the whole
 *   time" — a CONSTANT offset in ordinary flight, which a session mean that also
 *   contains firing, docking and dying will happily hide under a passing number.
 *   So the tail of the session with no action event in it — weapons cold, nothing
 *   ordered, nothing echoed, nobody dead — is scored on its own. That window is
 *   the one docs/netcode-tick-alignment.md §4 quotes its 0.06/0.14 u against, and
 *   it is the only window in which "~0" is a claim rather than an average.
 *
 *   ECHOES. `docs/netcode-audit.md` thresholds are all continuous; the action-echo
 *   defects were DISCRETE. An order authority refused, or an echo for an id this
 *   client never predicted, is exactly the "I built two and three appeared" /
 *   "my turret vanished" report, and it shows up in no correction average at all.
 *   Counted here by outcome, with the tick-wait distribution beside it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** docs/netcode-audit.md §5. */
export const THRESHOLDS = {
  MAX_CORRECTION_UNITS: 4,
  MAX_MEAN_CORRECTION_UNITS: 1.5,
  MAX_VISUAL_SNAPS: 0,
  MAX_MEAN_LEAD_TICKS: 32,
  MAX_PEAK_LEAD_TICKS: 120,
  MAX_MISPREDICTION_RATE: 0.5,
};

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const max = (rows, k) => (rows.length ? Math.max(...rows.map((r) => r[k] || 0)) : 0);
const mean = (rows, k) => (rows.length ? sum(rows, k) / rows.length : 0);
/** Reconcile-weighted, so a busy second counts for more than a quiet one. */
const meanCorrection = (rows) => {
  const n = sum(rows, 'recon');
  return n ? rows.reduce((a, r) => a + (r.corr || 0) * (r.recon || 0), 0) / n : 0;
};

function score(rows) {
  return {
    seconds: rows.length,
    reconciles: sum(rows, 'recon'),
    rttMean: Number(mean(rows, 'rtt').toFixed(0)),
    rttMax: max(rows, 'rttMax'),
    jitterMean: Number(mean(rows, 'jitter').toFixed(0)),
    meanCorrection: Number(meanCorrection(rows).toFixed(3)),
    worstCorrection: Number(max(rows, 'corrMax').toFixed(3)),
    mispredictionRate: Number(mean(rows, 'mispred').toFixed(3)),
    meanLead: Number(mean(rows, 'lead').toFixed(1)),
    peakLead: max(rows, 'lead'),
    visualSnaps: sum(rows, 'snap'),
    resyncs: sum(rows, 'resync'),
    // INPUT-TICK ALIGNMENT — how much later authority ran an input than the tick
    // it was predicted at (src/net/playtest-log-attach.ts `align`). This is the
    // named suspect from docs/netcode-tick-alignment.md, and it is measured, not
    // inferred: a second that could not compare its ack reports null, so those
    // seconds are excluded rather than averaged in as zero.
    alignMean: (() => {
      const m = rows.filter((r) => typeof r.align === 'number');
      return m.length ? Number((m.reduce((a, r) => a + r.align, 0) / m.length).toFixed(3)) : null;
    })(),
    alignMax: (() => {
      const m = rows.filter((r) => typeof r.alignMax === 'number');
      return m.length ? Math.max(...m.map((r) => r.alignMax)) : null;
    })(),
    alignSecondsMeasured: rows.filter((r) => typeof r.align === 'number').length,
  };
}
const verdicts = (s) => ({
  MAX_CORRECTION_UNITS: s.worstCorrection <= THRESHOLDS.MAX_CORRECTION_UNITS,
  MAX_MEAN_CORRECTION_UNITS: s.meanCorrection <= THRESHOLDS.MAX_MEAN_CORRECTION_UNITS,
  MAX_VISUAL_SNAPS: s.visualSnaps <= THRESHOLDS.MAX_VISUAL_SNAPS,
  MAX_MEAN_LEAD_TICKS: s.meanLead <= THRESHOLDS.MAX_MEAN_LEAD_TICKS,
  MAX_PEAK_LEAD_TICKS: s.peakLead <= THRESHOLDS.MAX_PEAK_LEAD_TICKS,
  MAX_MISPREDICTION_RATE: s.mispredictionRate <= THRESHOLDS.MAX_MISPREDICTION_RATE,
});

/** The action half of the log: what the player did, and what authority answered.
 *  `adopt` is authority agreeing with the prediction; `refused` and `unknown` are
 *  the two mismatches (src/net/action-journal.ts `EchoOutcome`). */
function scoreActions(events) {
  const act = (msg) => events.filter((e) => e.kind === 'net' && e.msg === msg).map((e) => ({ at: e.at, ...(e.data ?? {}) }));
  const volleys = act('volley');
  const orders = act('order');
  const echoes = act('echo');
  const expiries = act('expiry');
  const byOutcome = (o) => echoes.filter((e) => e.outcome === o);
  const waits = echoes.map((e) => e.waited).filter((w) => typeof w === 'number');
  const inFlight = volleys.map((v) => v.inFlight).filter((n) => typeof n === 'number');
  return {
    volleys: volleys.length,
    // The firer's own predicted shots alive. This is the number that read 5 on a
    // screen whose sim held 2 — one volley drawn twice.
    maxInFlight: inFlight.length ? Math.max(...inFlight) : null,
    inFlightHistogram: inFlight.reduce((h, n) => ((h[n] = (h[n] ?? 0) + 1), h), {}),
    orders: orders.length,
    orderVerbs: orders.reduce((h, o) => ((h[`${o.verb}:${o.what}`] = (h[`${o.verb}:${o.what}`] ?? 0) + 1), h), {}),
    echoes: echoes.length,
    echoAdopted: byOutcome('adopt').length,
    echoRefused: byOutcome('refused').length,
    echoUnknown: byOutcome('unknown').length,
    echoMismatched: byOutcome('refused').length + byOutcome('unknown').length,
    // An order predicted and never answered: the client took a turret back that
    // authority may well have built. Should be zero.
    expiries: expiries.length,
    waitedTicks: waits.length ? { min: Math.min(...waits), max: Math.max(...waits), mean: Number((waits.reduce((a, w) => a + w, 0) / waits.length).toFixed(1)) } : null,
    ordersWithoutEcho: orders.length - byOutcome('adopt').length - byOutcome('refused').length,
    refusedDetail: byOutcome('refused').map((e) => ({ at: e.at, tick: e.tick, id: e.id, waited: e.waited })),
    unknownDetail: byOutcome('unknown').map((e) => ({ at: e.at, tick: e.tick, id: e.id })),
    expiryDetail: expiries.map((e) => ({ at: e.at, tick: e.tick, id: e.id, what: e.what, waited: e.waited })),
  };
}

export function scoreLog(path) {
  const full = isAbsolute(path) ? path : join(HERE, path.replace(/^evidence\//, ''));
  const log = JSON.parse(readFileSync(full, 'utf8'));
  // A sample is finalized once it has an RTT; the first partial second has none.
  const rows = log.events
    .filter((e) => e.kind === 'net' && e.msg === 'sample' && e.data && e.data.rtt !== null)
    .map((e) => ({ at: e.at, ...e.data }));
  // The audit's ceiling is what separates ordinary flight from the breach window.
  const breach = rows.filter((r) => (r.corrMax || 0) > THRESHOLDS.MAX_CORRECTION_UNITS);
  const calm = rows.filter((r) => (r.corrMax || 0) <= THRESHOLDS.MAX_CORRECTION_UNITS);
  const whole = score(rows);
  const quiet = score(calm);
  const matchEvents = log.events.filter((e) => e.kind === 'match').map((e) => ({ at: e.at, msg: e.msg, ...(e.data ?? {}) }));

  // STEADY STATE. The last moment anything discrete happened — a shot fired, an
  // order placed or answered, a death, a spawn. Everything after it is straight
  // flight, and it is the only window in which a constant offset has nowhere to
  // hide. `null` when the session never went quiet, which is itself the answer.
  const lastDiscrete = Math.max(
    0,
    ...log.events
      .filter((e) => (e.kind === 'net' && ['volley', 'order', 'echo', 'expiry'].includes(e.msg)) || (e.kind === 'match' && e.msg !== 'matchStart'))
      .map((e) => e.at),
  );
  const cruise = rows.filter((r) => r.at > lastDiscrete);
  const steady = score(cruise);

  return {
    file: path,
    summary: log.summary,
    dropped: log.dropped,
    matchEvents,
    actions: scoreActions(log.events),
    steadyState: {
      afterMs: lastDiscrete,
      note: 'finalized seconds after the last volley/order/echo/expiry/death — weapons cold, straight flight',
      ...steady,
      verdicts: verdicts(steady),
      passes: Object.values(verdicts(steady)).filter(Boolean).length,
    },
    session: { ...whole, verdicts: verdicts(whole), passes: Object.values(verdicts(whole)).filter(Boolean).length },
    breachWindow: {
      seconds: breach.length,
      atMs: breach.map((r) => r.at),
      distinctWorstCorrections: [...new Set(breach.map((r) => r.corrMax))],
      mispredictionRates: [...new Set(breach.map((r) => r.mispred))],
    },
    outsideBreachWindow: { ...quiet, verdicts: verdicts(quiet), passes: Object.values(verdicts(quiet)).filter(Boolean).length },
  };
}

// CLI only when run as a script. `summarize-actions-runs.mjs` imports `scoreLog`
// from here, and without this guard that import printed an empty report over the
// top of the summary it was building.
const invokedDirectly = Boolean(process.argv[1]?.endsWith('score-feel-log.mjs'));
const args = invokedDirectly ? process.argv.slice(2) : [];
const asJson = args.includes('--json');
const files = args.filter((a) => a !== '--json');
const report = { scored: 'online-feel', thresholds: THRESHOLDS, capturedAt: new Date().toISOString(), logs: files.map(scoreLog) };
if (!invokedDirectly) {
  // Imported as a module (summarize-actions-runs.mjs takes `scoreLog` from here).
  // Without this the import printed an empty report over the summary it was building.
} else if (asJson) {
  writeFileSync(join(HERE, 'images', 'online-feel-score.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report.logs) {
    console.log(`\n${r.file}`);
    console.log(`  ${r.summary}`);
    console.log(`  match events: ${r.matchEvents.map((e) => `${e.msg}@${e.at}ms`).join(', ') || '(none)'}`);
    const line = (label, got, ok, ceiling) => console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${String(got).padStart(9)}  (${ceiling})`);
    const s = r.session;
    console.log(`  WHOLE SESSION — ${s.seconds}s, ${s.reconciles} reconciles, RTT ${s.rttMean}/${s.rttMax} ms, jitter ${s.jitterMean} ms`);
    line('worst correction', s.worstCorrection + ' u', s.verdicts.MAX_CORRECTION_UNITS, '<= 4 u');
    line('mean correction', s.meanCorrection + ' u', s.verdicts.MAX_MEAN_CORRECTION_UNITS, '<= 1.5 u');
    line('visual snaps', s.visualSnaps, s.verdicts.MAX_VISUAL_SNAPS, '== 0');
    line('mean lead', s.meanLead + ' t', s.verdicts.MAX_MEAN_LEAD_TICKS, '<= 32 t');
    line('peak lead', s.peakLead + ' t', s.verdicts.MAX_PEAK_LEAD_TICKS, '<= 120 t');
    line('misprediction rate', s.mispredictionRate, s.verdicts.MAX_MISPREDICTION_RATE, '<= 0.5');
    const q = r.outsideBreachWindow;
    console.log(`  BREACH WINDOW — ${r.breachWindow.seconds}s, worst corrections ${JSON.stringify(r.breachWindow.distinctWorstCorrections)}, mispred ${JSON.stringify(r.breachWindow.mispredictionRates)}`);
    console.log(`  OUTSIDE IT — ${q.seconds}s: mean ${q.meanCorrection} u, worst ${q.worstCorrection} u, snaps ${q.visualSnaps}, mispred ${q.mispredictionRate}, lead ${q.meanLead}/${q.peakLead} t → ${q.passes}/6 thresholds`);
    const c = r.steadyState;
    console.log(`  STEADY STATE (after ${c.afterMs}ms, weapons cold) — ${c.seconds}s, ${c.reconciles} reconciles: mean ${c.meanCorrection} u, worst ${c.worstCorrection} u, snaps ${c.visualSnaps}, resyncs ${c.resyncs}, lead ${c.meanLead}/${c.peakLead} t, align ${c.alignMean}/${c.alignMax} t over ${c.alignSecondsMeasured}s → ${c.passes}/6`);
    console.log(`  ALIGNMENT (whole session) — ${s.alignMean}/${s.alignMax} t over ${s.alignSecondsMeasured} measured seconds`);
    const a = r.actions;
    console.log(`  ACTIONS — ${a.volleys} volleys (max inFlight ${a.maxInFlight}), ${a.orders} orders, ${a.echoes} echoes: ${a.echoAdopted} ADOPTED / ${a.echoRefused} refused / ${a.echoUnknown} unknown, ${a.expiries} expired; waited ${a.waitedTicks ? `${a.waitedTicks.min}-${a.waitedTicks.max} t (mean ${a.waitedTicks.mean})` : 'n/a'}`);
  }
}
