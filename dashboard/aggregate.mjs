import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verdictRows } from './art-choices.mjs';

const readJson = (p, fallback = null) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

/**
 * A stable id for a feedback line, derived from its TEXT rather than its
 * position — items are appended and cleared, so an index would re-point at a
 * different item the moment anything above it moved, and the developer would
 * clear one thing by dismissing another.
 */
export function feedbackId(line) {
  return createHash('sha1').update(line.trim()).digest('hex').slice(0, 12);
}

// milestones.json is owned by the game repo and its shape may evolve there:
// either a plain array of {day,title,done} or an object whose `days` array
// carries them (deploy-hook format). Normalize to the array the studio uses.
function normalizeMilestones(m) {
  if (Array.isArray(m)) return m;
  if (m && Array.isArray(m.days)) return m.days;
  return [];
}

export function aggregate(statusDir, queueDir, workspaceDir, now = Date.now()) {
  const STALL_MS = 30 * 60_000;
  const agents = (existsSync(statusDir) ? readdirSync(statusDir) : [])
    .filter(f => f.endsWith('.json') && f !== 'ci.json')
    .map(f => readJson(join(statusDir, f)))
    .filter(Boolean)
    .filter(s => typeof s.agent === 'string' && s.agent.length > 0)
    .map(s => {
      const hb = join(statusDir, `${s.agent}.heartbeat`);
      const beat = existsSync(hb) ? statSync(hb).mtimeMs : Date.parse(s.last_update);
      // `beatAgeMs` is exported, not just thresholded, so the BOARD can show
      // liveness per card rather than only flagging the 30-minute stall.
      //
      // The heartbeat is a Claude Code PostToolUse hook (docker/claude-settings
      // .json), so its age is "seconds since this agent last ran a tool" — the
      // one number that separates an agent mid-CI from a dead lane. A card
      // previously showed only when the brief entered active/, which is why on
      // 2026-08-15 three live lanes read as abandoned: *"i saw the active tasks
      // where sitting there for hours i could see the timestamp"*. Entry time
      // is not liveness, and the board had nothing else to offer.
      return { ...s, beatAgeMs: Math.max(0, now - beat), stalled: s.state === 'working' && now - beat > STALL_MS };
    });
  const queue = {};
  for (const lane of ['pending', 'active', 'done', 'blocked']) {
    const dir = join(queueDir, lane);
    queue[lane] = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];
  }
  return {
    agents,
    queue,
    ci: readJson(join(statusDir, 'ci.json')),
    ops: (() => {
      try {
        return readFileSync(join(statusDir, 'ops.log'), 'utf8').trim().split('\n').slice(-5);
      } catch { return []; }
    })(),
    // Non-blocking human-feedback queue (developer directive 2026-07-24:
    // "we should never be idle just waiting on me"). Items accumulate here and
    // on the board; production never gates on them.
    // Items carry a stable id so the DEVELOPER can clear them from the board.
    // The decree was always "Director appends, developer clears at leisure" —
    // but only the appending half was ever built, so resolved items piled up and
    // clearing them required telling the Director in chat. feedback.md stays the
    // append-only source; resolution is separate developer-owned state, so
    // clearing an item never edits the Director's text.
    feedback: (() => {
      try {
        const resolved = readJson(join(statusDir, 'feedback-resolved.json'), {}) ?? {};
        return readFileSync(join(statusDir, 'feedback.md'), 'utf8').trim().split('\n')
          .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
          .map(line => ({ id: feedbackId(line), line }))
          .filter(item => !resolved[item.id])
          .slice(-10);
      } catch { return []; }
    })(),
    // WHY THIS ORDER — the Director's ranking rationale, git-tracked at
    // queue/why-this-order.md. Dependency order is already machine-enforced by
    // `needs:` and blockers are a visible lane, but the RANKING itself was pure
    // judgement living only in chat: the developer had to take the Director's
    // word for it. "If you can't explain the agent's decisions, you weren't in
    // control of them" — so the reasoning is an artifact you can read and audit,
    // not a claim.
    order: (() => {
      try {
        const raw = readFileSync(join(queueDir, 'why-this-order.md'), 'utf8').split('\n');
        const out = [];
        let section = '';
        let current = null;
        const flush = () => { if (current) out.push(current); current = null; };
        for (const line of raw) {
          const t = line.trim();
          if (t.startsWith('##')) { flush(); section = t.replace(/^#+\s*/, ''); continue; }
          // Only entries UNDER a section reach the board. The preamble explains
          // the method to a reader of the file; on the board it would push the
          // actual decisions off screen, which is the opposite of the point.
          if (!section) continue;
          const item = t.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
          if (item && item[1]) { flush(); current = `${section} · ${item[1]}`; }
          // Markdown wraps a bullet across lines; without rejoining them every
          // entry got truncated mid-sentence on the board.
          else if (t && current) current += ' ' + t;
          else if (!t) flush();
        }
        flush();
        return out.map(l => l.replace(/[`*]/g, '')).slice(0, 14);
      } catch { return []; }
    })(),
    // REVIEW VERDICTS — the developer's ART/SOUND decisions, exposed so the
    // notifier can raise one when a new one lands.
    //
    // Every verdict needs the Director: a DENY needs a regeneration round that
    // quotes the reason verbatim (the reason IS the steering signal), and a PICK
    // unblocks whatever brief was waiting on it. Neither had a signal, so the
    // loop only closed when the Director happened to look. An ART "DENY ALL —
    // none of these look like a mining space station" sat 17 hours while the
    // Director kept telling the developer their pick was still needed, and a
    // SOUND deny sat 8 days. The review loop is the developer's main steering
    // wheel; it must not depend on the Director's memory.
    verdicts: (() => {
      const out = [];
      for (const [kind, file] of [['ART', 'art-choices.json'], ['SOUND', 'sound-choices.json']]) {
        const store = readJson(join(statusDir, file), null);
        if (!store || typeof store !== 'object') continue;
        // ONE ROW PER ANSWER, not per entry (a0-109). An ART board can now hold
        // an answer per question, and this walked one level deep and read
        // `.verdict` off the entry — under the new shape that is `undefined`, so
        // every future ART verdict would raise no ping and the Director would
        // learn about the developer's pick by happening to look. That is the
        // exact failure this ping exists to prevent: an ART deny once sat 17
        // hours, a SOUND deny eight days.
        //
        // `verdictRows` reads both shapes, so SOUND — one verdict per slot,
        // unchanged — still produces exactly the rows it always did.
        for (const row of verdictRows(store)) {
          out.push({
            kind, key: row.key, at: row.at,
            verdict: row.verdict,
            reason: row.reason,
            // A deny is the case that needs NEW work; a pick unblocks existing work.
            denied: /deny/i.test(row.verdict),
          });
        }
      }
      return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    })(),
    milestones: normalizeMilestones(readJson(join(workspaceDir, 'milestones.json'), [])),
    generated_at: new Date(now).toISOString(),
  };
}
