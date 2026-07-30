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
  return {
    file: path,
    summary: log.summary,
    dropped: log.dropped,
    matchEvents: log.events.filter((e) => e.kind === 'match').map((e) => ({ at: e.at, msg: e.msg, ...(e.data ?? {}) })),
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

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => a !== '--json');
const report = { scored: 'online-feel', thresholds: THRESHOLDS, capturedAt: new Date().toISOString(), logs: files.map(scoreLog) };
if (asJson) {
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
  }
}
