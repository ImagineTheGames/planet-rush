/**
 * harness/report.ts — render a {@link BalanceSummary} as the markdown QA files
 * in tests/reports/. OWNER: QA Agent (GDD §3.8: "files balance reports as
 * markdown").
 *
 * Pure formatting over the pure stats: the numbers in a committed report are the
 * numbers `summarize` produced, rendered the one way, so a report can never
 * drift from the arithmetic that justified it.
 */

import type { BalanceSummary, WinShare } from './stats';
import { TARGET_MAX_S, TARGET_MIN_S, WIN_RATE_CEILING, fmtDuration } from './stats';

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function verdict(pass: boolean): string {
  return pass ? '✅ PASS' : '❌ FAIL';
}

function shareRows(shares: readonly WinShare[]): string {
  return shares
    .map((s) => {
      const over = s.share > WIN_RATE_CEILING ? ' ⚠️' : '';
      return `| ${s.key} | ${s.wins} | ${pct(s.share)}${over} |`;
    })
    .join('\n');
}

/** Render one batch's summary as a markdown section (no leading title). */
export function formatSummary(summary: BalanceSummary): string {
  const L = summary.length;
  const lengthLine =
    L.count > 0
      ? [
          `- **Matches ended:** ${summary.ended}/${summary.matches}` +
            (summary.timedOut ? ` (⚠️ ${summary.timedOut} timed out)` : ''),
          `- **Length (ended matches):** min ${fmtDuration(L.min)} · p10 ${fmtDuration(
            L.p10,
          )} · **median ${fmtDuration(L.median)}** · mean ${fmtDuration(
            L.mean,
          )} · p90 ${fmtDuration(L.p90)} · max ${fmtDuration(L.max)}`,
          `- **Inside 10–15 min band:** ${pct(L.fractionInTarget)} of ended matches`,
        ].join('\n')
      : `- **Matches ended:** ${summary.ended}/${summary.matches} — no ended matches to measure length on`;

  const target = `${fmtDuration(TARGET_MIN_S)}–${fmtDuration(TARGET_MAX_S)}`;

  return [
    `**Match length** (target ${target}, every match): ${verdict(summary.lengthTargetMet)}  `,
    `**Median in band:** ${verdict(summary.medianInTarget)}  `,
    `**Win rate** (target ≤ ${pct(WIN_RATE_CEILING)}, every class & strategy): ${verdict(
      summary.winRateTargetMet,
    )}` + (summary.topShare ? ` — top: **${summary.topShare.key}** at ${pct(summary.topShare.share)}` : ''),
    '',
    lengthLine,
    '',
    '**Win share by ship class**',
    '',
    '| Class | Wins | Share |',
    '|---|---|---|',
    shareRows(summary.byClass),
    '',
    '**Win share by strategy (bot personality)**',
    '',
    '| Strategy | Wins | Share |',
    '|---|---|---|',
    shareRows(summary.byStrategy),
  ].join('\n');
}
