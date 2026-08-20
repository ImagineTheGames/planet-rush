import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from './aggregate.mjs';
import { startNotifier } from './notifier.mjs';
import { board } from './board.mjs';
import { describeChoices, describeReview, recordVerdict, clearVerdict } from './art-choices.mjs';

const STATUS = process.env.STATUS_DIR ?? '/status';
const QUEUE = process.env.QUEUE_DIR ?? '/queue';
const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const BACKLOG = process.env.BACKLOG_DIR ?? '/backlog';

/**
 * Which briefs reference `token`, and what lane each is in.
 *
 * This is how a developer's verdict is tied back to the work it caused. The
 * link is a plain text mention — a brief that acts on a chosen concept or a
 * denied sound has to name the thing it is acting on — so it holds without any
 * id scheme that someone has to remember to maintain.
 *
 * Used by BOTH review pages. A pick whose consequence is invisible reads as a
 * pick that was thrown away, and that was true of art and sound alike.
 */
/**
 * Every brief, read ONCE per few seconds, so a caller asking about forty tokens
 * does not re-read the queue forty times.
 *
 * `briefsMentioning` used to open every file itself. The Sounds page calls it
 * per decided slot — 39 of them against ~190 briefs — which is roughly seven
 * thousand file reads for one request, and the developer felt it:
 * *"the page also takes a long time to load"* (10.6 s measured). The work was
 * never the matching; it was reading the same corpus once per token.
 *
 * The TTL is short on purpose. This index answers "has anything been briefed
 * about X", and a brief queued seconds ago showing up a few seconds late is
 * harmless — whereas a stale-for-minutes index would misreport a denial as
 * unactioned, which is the one thing this page exists to get right.
 */
const BRIEF_INDEX_TTL_MS = 30_000;
let briefIndex = { at: 0, stamp: '', entries: [] };
const BRIEF_DIRS = [
  ['pending', join(QUEUE, 'pending')], ['active', join(QUEUE, 'active')],
  ['done', join(QUEUE, 'done')], ['blocked', join(QUEUE, 'blocked')], ['backlog', BACKLOG],
];

/** A cheap fingerprint of the queue: each lane's mtime and file count. Five
 *  stats, versus ~190 whole-file reads. A brief moving lane, arriving or being
 *  edited all change it. */
function queueStamp() {
  let s = '';
  for (const [, dir] of BRIEF_DIRS) {
    try {
      const st = statSync(dir);
      s += `${st.mtimeMs}:${readdirSync(dir).length}|`;
    } catch { s += 'x|'; }
  }
  return s;
}

function readBriefIndex() {
  const now = Date.now();
  if (now - briefIndex.at < BRIEF_INDEX_TTL_MS) return briefIndex.entries;

  // THE RE-READ IS THE EXPENSIVE PART, AND IT IS USUALLY UNNECESSARY.
  //
  // This corpus is ~190 files on a Windows bind mount, read with SYNCHRONOUS fs
  // calls on the request path. The board polls every 5 s and the Sounds and ART
  // pages poll alongside it, so a 5 s TTL meant re-reading the whole queue
  // continuously — and when that mount stalls, the event loop stalls with it and
  // the entire dashboard stops answering. On 2026-08-17 it did: every endpoint
  // hung, including inside the container, and the developer met it as *"the art
  // page is taking half a century to load, its literally been minutes now"*.
  //
  // The queue rarely changes — a brief moves lane every few minutes at most — so
  // fingerprint it with five stats and only re-read when that fingerprint moves.
  // A 30 s ceiling still bounds staleness for anything the stamp cannot see
  // (a brief edited in place with no size or mtime change).
  const stamp = queueStamp();
  if (stamp === briefIndex.stamp && briefIndex.entries.length) {
    briefIndex = { ...briefIndex, at: now };
    return briefIndex.entries;
  }

  const entries = [];
  for (const [lane, dir] of BRIEF_DIRS) {
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      try { entries.push({ file: f, lane, text: readFileSync(join(dir, f), 'utf8') }); }
      catch { /* one unreadable brief must not fail the whole page */ }
    }
  }
  briefIndex = { at: now, stamp, entries };
  return entries;
}

function briefsMentioning(token) {
  if (!token) return [];
  return readBriefIndex()
    .filter(e => e.text.includes(token))
    .map(e => ({ file: e.file, lane: e.lane }));
}
const PORT = Number(process.env.PORT ?? 8080);

const SITE = join(dirname(fileURLToPath(import.meta.url)), 'site');

/**
 * Read an agent-authored JSON file, and SAY SO when it is broken.
 *
 * Every one of these reads used to be `try { JSON.parse(...) } catch { /* none *\/ }`
 * with a safe default. That is tolerance, not validation: a file that is missing
 * and a file that is corrupt produced the identical empty page, so a malformed
 * evidence manifest showed an empty gallery and told nobody. This studio has
 * been bitten by exactly that silence before — the dashboard's /status mount was
 * read-only for days while every ops-log write failed quietly into a retry.
 *
 * The distinction this draws is the whole point:
 *   - file ABSENT  → normal (it does not exist yet). Return the fallback, say nothing.
 *   - file PRESENT but unparseable, or the wrong SHAPE → a defect. Return the
 *     fallback so the page still renders, and escalate to ops.log.
 *
 * Deduped by path+mtime because these endpoints are hit on every page load, and
 * an alarm that repeats on a timer is one nobody reads (LESSONS §6, §13).
 */
/**
 * Read a verdicts file for a read-modify-WRITE. Absent → `{}` (a genuine fresh
 * start). Present but unparseable → THROW, so the caller 400s and the developer
 * learns their click did not take, instead of the handler cheerfully writing a
 * one-entry object over their entire review history.
 */
function readChoicesOrRefuse(path, which) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (e) {
    try {
      appendFileSync(join(STATUS, 'ops.log'),
        `${new Date().toISOString()} dashboard: REFUSED to record a ${which} verdict — ${path} exists but is unreadable (${e.message.slice(0, 120)}). Not overwriting; the developer's earlier verdicts are still in that file and need rescuing by hand.\n`);
    } catch { /* best effort */ }
    throw e;
  }
}

const loudFailures = new Map();
function readAgentJson(path, fallback, { label, shape } = {}) {
  if (!existsSync(path)) return fallback;            // absent is not a failure
  let key = path;
  try { key = `${path}@${statSync(path).mtimeMs}`; } catch { /* fall back to path */ }
  const complain = (why) => {
    if (loudFailures.get(path) === key) return fallback; // already reported THIS version
    loudFailures.set(path, key);
    try {
      appendFileSync(join(STATUS, 'ops.log'),
        `${new Date().toISOString()} dashboard: ${label ?? path} is present but unusable — ${why}. Serving empty; the page will look fine and be wrong.\n`);
    } catch { /* ops.log itself is best-effort */ }
    return fallback;
  };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return complain(`invalid JSON (${e.message.slice(0, 120)})`);
  }
  if (shape && !shape(parsed)) return complain('parsed, but not the shape this page expects');
  loudFailures.delete(path); // healthy again — let a future break re-report
  return parsed;
}

const boardPage = readFileSync(join(SITE, 'Agent Board.dc.html'));
const milestonesPage = readFileSync(join(SITE, 'Milestones.dc.html'));
const processPage = readFileSync(join(SITE, 'Process.dc.html'));
const evidencePage = readFileSync(join(SITE, 'Evidence.dc.html'));
const soundsPage = readFileSync(join(SITE, 'Sounds.dc.html'));
const artPage = readFileSync(join(SITE, 'Art.dc.html'));
// CREW moved off the board 2026-08-06: the developer reported the rail polluting
// the page, and the board should be the board. Same live data, its own page.
const crewPage = readFileSync(join(SITE, 'Crew.dc.html'));

// Static passthrough assets, keyed by decoded request path.
const assets = new Map();
assets.set('/support.js', { body: readFileSync(join(SITE, 'support.js')), type: 'text/javascript' });
assets.set('/warp-field.js', { body: readFileSync(join(SITE, 'warp-field.js')), type: 'text/javascript' });
assets.set('/TaskCard.dc.html', { body: readFileSync(join(SITE, 'TaskCard.dc.html')), type: 'text/html' });
assets.set('/fonts/fonts.css', { body: readFileSync(join(SITE, 'fonts', 'fonts.css')), type: 'text/css' });
for (const f of readdirSync(join(SITE, 'fonts'))) {
  if (f.endsWith('.woff2')) {
    assets.set(`/fonts/${f}`, { body: readFileSync(join(SITE, 'fonts', f)), type: 'font/woff2' });
  }
}

// dc-import/relative links resolve against the page URL, so serve both the
// clean routes and the literal on-disk filenames.
const pages = new Map([
  ['/', boardPage],
  ['/board', boardPage],
  ['/Agent Board.dc.html', boardPage],
  ['/milestones', milestonesPage],
  ['/Milestones.dc.html', milestonesPage],
  ['/docs', processPage],
  ['/process', processPage],
  ['/Process.dc.html', processPage],
  ['/evidence', evidencePage],
  ['/Evidence.dc.html', evidencePage],
  ['/sounds', soundsPage],
  ['/Sounds.dc.html', soundsPage],
  ['/crew', crewPage],
  ['/Crew.dc.html', crewPage],
  ['/art', artPage],
  ['/Art.dc.html', artPage],
]);

// Open PRs on the game repo — the Director review gate, surfaced so "waiting
// on a human" is visible on the board. Cached 60s; degrades to [] without a
// token or offline.
const GH_TOKEN = process.env.GH_TOKEN ?? '';
const GAME_REPO = (process.env.GAME_REPO ?? '').replace(/\.git$/, '').split('/').slice(-2).join('/');
let prCache = { at: 0, prs: [] };
async function openPrs() {
  if (!GAME_REPO || Date.now() - prCache.at < 60_000) return prCache.prs;
  try {
    const r = await fetch(`https://api.github.com/repos/${GAME_REPO}/pulls?state=open&per_page=20`, {
      headers: { accept: 'application/vnd.github+json', ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}) },
    });
    if (r.ok) {
      const list = await r.json();
      prCache = { at: Date.now(), prs: list.map(p => ({ number: p.number, title: p.title, branch: p.head?.ref ?? '', url: p.html_url })) };
    }
  } catch { /* offline — keep last */ }
  return prCache.prs;
}

createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    url = req.url.split('?')[0];
  }

  if (url === '/api/feedback/resolve' && req.method === 'POST') {
    // The developer clearing a feedback item themselves. The decree was always
    // "Director appends, developer clears at leisure" — only the appending half
    // existed, so clearing required telling the Director in chat.
    //
    // Resolution is stored SEPARATELY from feedback.md on purpose: the markdown
    // stays an append-only Director artifact, so a click can never rewrite the
    // Director's words, and un-resolving is just deleting a key.
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id, resolved } = JSON.parse(body);
        if (typeof id !== 'string' || !/^[a-f0-9]{6,64}$/.test(id)) throw new Error('bad id');
        const path = join(STATUS, 'feedback-resolved.json');
        const store = readChoicesOrRefuse(path, 'FEEDBACK');
        if (resolved === false) delete store[id];
        else store[id] = { at: new Date().toISOString() };
        writeFileSync(path, JSON.stringify(store, null, 2));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (url.startsWith('/api/brief')) {
    // One brief's SPEC text, fetched when a card is opened.
    //
    // /api/board used to carry every brief's full body: 132 KB a poll, 89% of it
    // spec text nobody was reading, re-sent every 5 seconds. On a phone over the
    // tailnet that is ~26 KB/s plus a 132 KB JSON parse per tick, and the
    // developer reported the board running "SUPER SLOW". The bodies are only
    // needed for the one card actually opened.
    const want = new URL(req.url, 'http://x').searchParams.get('file') ?? '';
    // Basename only — never a path. A brief lives in one of the known lanes.
    const safe = want.replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]/g, '');
    let body = '';
    if (safe.endsWith('.md')) {
      for (const dir of [join(QUEUE, 'pending'), join(QUEUE, 'active'), join(QUEUE, 'done'),
        join(QUEUE, 'blocked'), BACKLOG]) {
        try { body = readFileSync(join(dir, safe), 'utf8'); break; } catch { /* next lane */ }
      }
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ file: safe, body: body.replace(/^---[\s\S]*?---\n?/, '').trim() }));
    return;
  }

  if (url === '/api/art') {
    // Concept boards awaiting the developer's eye: every .html under the game
    // repo's docs/art-direction, plus any recorded picks.
    let boards = [];
    let choices = {};
    let review = {};
    try {
      boards = readdirSync(join(WORKSPACE, 'docs', 'art-direction')).filter(f => f.endsWith('.html'));
    } catch { /* none */ }
    const rawChoices = readAgentJson(join(STATUS, 'art-choices.json'), {},
      { label: "the developer's ART verdicts (art-choices.json)", shape: v => v && typeof v === 'object' });
    // Curated by the Director: ONLY boards listed here are awaiting a decision,
    // with their REAL option labels. Everything else is ratified reference.
    const rawReview = readAgentJson(join(STATUS, 'art-review.json'), {},
      { label: 'the ART review manifest (art-review.json)', shape: v => v && typeof v === 'object' });
    // ONE ANSWER PER QUESTION, NOT PER BOARD (a0-109). A board may ask several
    // things — the explosion lab asks three, one per family — and the store used
    // to have room for one verdict per board, so the first button pressed was
    // written as THE answer and the other eighteen candidates left the page:
    // "i didnt pick any of the explosions, i just clicked something and it all
    // went as if i had approved them".
    //
    // Both halves are normalised HERE, on the way out, and nothing is written
    // back: `describeChoices` migrates the old one-verdict entries on read (they
    // become the answer to the board's one question and mean exactly what they
    // always meant) and adds what the page routes on — which questions are
    // settled, which are still open, and whether the board is decided at all.
    review = describeReview(rawReview);
    choices = describeChoices(rawChoices, rawReview);
    // What HAPPENED to each decision. The developer picked a concept and the
    // card moved to a reference shelf labelled "already decided" — which told
    // them the vote was counted and nothing about whether anyone was acting on
    // it. A verdict with no visible consequence reads as a verdict that was
    // dropped, and the developer said so: "after approving it vanished".
    //
    // The link is the board's FILENAME appearing in a brief's text: the brief
    // that builds a chosen concept has to name the board it builds from, so
    // that mention is a real reference rather than a naming convention anyone
    // has to remember to honour.
    const work = {};
    for (const board of boards) {
      const hits = briefsMentioning(board);
      if (hits.length) work[board] = hits;
    }
    // ...and per ANSWER, now that one board can carry three of them. A board
    // with three picks has three consequences, and "the brief that builds your
    // pick" has to mean the brief that builds THAT pick — the brief porting the
    // chosen ship explosion names `ship-hard-snap`, not the lab it came from.
    // Falls back to the board's own briefs on the page when an option has none.
    //
    // Only ids long enough to be a real token are looked up: `briefsMentioning`
    // is a substring match, so asking it about the verdict "D" would report
    // every brief in the queue as work on that pick.
    for (const state of Object.values(choices)) {
      for (const answer of Object.values(state.answers ?? {})) {
        const id = String(answer.verdict ?? '');
        if (!/^[a-z0-9][a-z0-9._-]{5,}$/i.test(id) || work[id]) continue;
        const hits = briefsMentioning(id);
        if (hits.length) work[id] = hits;
      }
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ boards, choices, review, work }));
    return;
  }
  if (url === '/api/art/choice' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        // `question` names WHICH of the board's questions this answers, and
        // defaults to the sole question every other board asks — so a page that
        // never heard of questions still records exactly what it always did.
        // `clear: true` takes an answer back: the developer changing their mind
        // is a normal event, and until now undoing a tap meant the Director
        // hand-editing status/art-choices.json.
        const { board, question, verdict, reason, clear } = JSON.parse(body);
        if (typeof board !== 'string') throw new Error('bad');
        if (clear !== true && typeof verdict !== 'string') throw new Error('bad');
        // NEVER clobber existing verdicts. This used to default to {} on a parse
        // failure and then writeFileSync the whole object back — so one corrupt
        // file silently erased every ART decision the developer had ever made,
        // with no backup anywhere (status/ is gitignored). Absent is a fresh
        // start; present-but-corrupt refuses the write and says why.
        const choices = readChoicesOrRefuse(join(STATUS, 'art-choices.json'), 'ART');
        // Migration happens on READ, inside these two — they rebuild only the
        // entry being answered and hand every other one straight back, so the
        // boards nobody touched serialise exactly as they were found. A load has
        // never rewritten this file and still does not.
        const next = clear === true
          ? clearVerdict(choices, { board, question })
          : recordVerdict(choices, { board, question, verdict, reason });
        writeFileSync(join(STATUS, 'art-choices.json'), JSON.stringify(next, null, 2));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (url.startsWith('/art/board/')) {
    const name = url.slice('/art/board/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    try {
      const html = readFileSync(join(WORKSPACE, 'docs', 'art-direction', name));
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such board');
    }
    return;
  }
  if (url === '/api/sounds') {
    // The sound-review contract: candidates manifest + the developer's choices.
    let manifest = { slots: [] };
    let choices = {};
    manifest = readAgentJson(join(WORKSPACE, 'sound-review', 'manifest.json'), { slots: [] },
      { label: 'the sound-review candidates manifest', shape: v => v && Array.isArray(v.slots) });
    choices = readAgentJson(join(STATUS, 'sound-choices.json'), {},
      { label: "the developer's SOUND verdicts (sound-choices.json)", shape: v => v && typeof v === 'object' });
    // Same contract as ART: a verdict is only closed once its consequence is
    // visible. Only decided slots are looked up — scanning every brief for all
    // 40 undecided slots would be work nobody asked for.
    const work = {};
    for (const slot of Object.keys(choices)) {
      const hits = briefsMentioning(slot);
      if (hits.length) work[slot] = hits;
    }
    // A DENIAL THAT PRODUCED NOTHING is the worst state this page can be in, and
    // until now it was invisible. The developer went looking for the ambient bed
    // after it annoyed them in game, could not find it, and it turned out they
    // had denied it on 2026-08-07 and nothing had ever been briefed to replace
    // it. The audit that followed found 38 denials, 21 of them with no
    // regeneration work at all — some a week old (a0-49).
    //
    // The page could not show this because a slot with ANY brief against it read
    // as actioned: `ambient` matched an alarm brief and a gantry-cues brief,
    // neither of which was a revoice, so it looked handled. A count of briefs is
    // not evidence of action. This reports the denials with NOTHING against
    // them — the cheap, unambiguous half — and the page puts it at the top.
    // WORK ONLY COUNTS IF IT POSTDATES THE DENIAL.
    //
    // This asked "does any brief mention this slot", which a0-60 — the sweep
    // that names all thirty-five — answered `true` for every one of them,
    // permanently. So on 2026-08-17 the developer recorded twenty fresh
    // deny-alls with detailed reasons ("none of these sound like a gun fire or
    // laser turret", "what happened to the glass theme we had") and this counter
    // said ZERO denials needed work, because a brief written the day before
    // mentioned each slot by name.
    //
    // A brief cannot have actioned a verdict that did not exist when it was
    // written. Compare the mtimes: work counts only if it is newer than the
    // denial it is supposed to answer. Same defect as the verdict that outlived
    // its candidates, in the other direction.
    const briefNewerThan = (slot, at) => {
      const stamp = at ? Date.parse(at) : 0;
      if (!stamp) return (work[slot] ?? []).length > 0;
      return (work[slot] ?? []).some(w => {
        const dir = w.lane === 'backlog' ? BACKLOG : join(QUEUE, w.lane);
        try { return statSync(join(dir, w.file)).mtimeMs > stamp; } catch { return false; }
      });
    };
    const deniedWithoutWork = Object.entries(choices)
      .filter(([slot, c]) => c?.verdict === 'deny-all' && !briefNewerThan(slot, c.at))
      .map(([slot, c]) => ({ slot, reason: c.reason ?? '', at: c.at ?? '' }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    // WHEN THIS SLOT'S OFFERS LAST CHANGED — the thing that expires a verdict.
    //
    // A verdict judges the sounds that were on the board when it was given. It
    // does not judge their replacements. Until now the page read `choices[id]`
    // and nothing else, so the 2026-08-07 `deny-all` sat on thirty-five slots
    // permanently: a0-60 re-voiced them to fresh letters, 36 slots gained four
    // new candidates each, and every one still rendered as DENIED. The developer
    // went looking and found nothing to listen to:
    //   "sound page to me only shows the denied and the approved, there is
    //    nothing new for me to approve there"
    //
    // Newest preview mtime per slot, compared against the verdict's own `at`, is
    // what tells the page a decision has been overtaken. Cheap: one stat per
    // candidate, not a read.
    const candidatesAt = {};
    for (const slot of manifest.slots ?? []) {
      let newest = 0;
      for (const c of slot.candidates ?? []) {
        if (!c?.wav) continue;
        try { newest = Math.max(newest, statSync(join(WORKSPACE, 'sound-review', c.wav)).mtimeMs); }
        catch { /* a missing preview is the manifest's problem, not this page's */ }
      }
      if (newest > 0) candidatesAt[slot.id] = new Date(newest).toISOString();
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ...manifest, choices, work, denied_without_work: deniedWithoutWork, candidates_at: candidatesAt }));
    return;
  }
  if (url === '/api/sounds/choice' && req.method === 'POST') {
    // Developer verdicts: { slot, verdict: candidateId | 'deny-all' }.
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { slot, verdict, reason } = JSON.parse(body);
        if (typeof slot !== 'string' || typeof verdict !== 'string') throw new Error('bad');
        // See the ART handler: a corrupt file must never be silently replaced
        // with a one-entry object. The developer's SOUND verdicts and their
        // REASONS are the steering signal for every regeneration brief.
        const choices = readChoicesOrRefuse(join(STATUS, 'sound-choices.json'), 'SOUND');
        choices[slot.replace(/[^a-z0-9_-]/gi, '')] = { verdict: verdict.slice(0, 64), reason: typeof reason === 'string' ? reason.slice(0, 500) : undefined, at: new Date().toISOString() };
        writeFileSync(join(STATUS, 'sound-choices.json'), JSON.stringify(choices, null, 2));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (url.startsWith('/sounds/audio/')) {
    // Serve candidate .wavs from the workspace's sound-review dir (ro mount).
    const name = url.slice('/sounds/audio/'.length).split('/')
      .map(s => s.replace(/[^a-zA-Z0-9._-]/g, '')).filter(s => s && s !== '.' && s !== '..').join('/');
    try {
      const wav = readFileSync(join(WORKSPACE, 'sound-review', name));
      res.writeHead(200, { 'content-type': name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' });
      res.end(wav);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such sound');
    }
    return;
  }
  if (url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(aggregate(STATUS, QUEUE, WORKSPACE)));
  } else if (url === '/api/evidence') {
    // The QA Manager's attested proof gallery: evidence/manifest.json in the
    // game repo (read via the workspace mount). Empty array until it exists.
    const manifest = readAgentJson(join(WORKSPACE, 'evidence', 'manifest.json'), [],
      { label: "the QA Manager's evidence manifest", shape: Array.isArray });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(Array.isArray(manifest) ? manifest : []));
  } else if (url.startsWith('/evidence/img/')) {
    // Manifest image paths may live in subdirectories (evidence/images/...):
    // sanitize each segment separately so '/' survives but traversal cannot —
    // the old whole-string sanitizer stripped '/' and 404'd every nested image.
    const name = url.slice('/evidence/img/'.length).split('/')
      .map(s => s.replace(/[^a-zA-Z0-9._-]/g, ''))
      .filter(s => s && s !== '.' && s !== '..')
      .join('/');
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    const ext = name.slice(name.lastIndexOf('.'));
    try {
      const img = readFileSync(join(WORKSPACE, 'evidence', name));
      res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
      res.end(img);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such evidence');
    }
  } else if (url.startsWith('/api/log/')) {
    // Tail of an agent's session log — the "behind the scenes" feed. Read-only,
    // last 4KB, plain text. Agent name sanitized to a bare word.
    const agent = url.slice('/api/log/'.length).replace(/[^a-z0-9_-]/gi, '');
    try {
      const raw = readFileSync(join(STATUS, `${agent}.log`), 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(raw.slice(-4096));
    } catch {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('(no session log yet)');
    }
  } else if (url === '/api/board') {
    openPrs().then(prs => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ...board(BACKLOG, QUEUE, STATUS, WORKSPACE), prs }));
    });
  } else if (assets.has(url)) {
    const a = assets.get(url);
    res.writeHead(200, { 'content-type': a.type, 'cache-control': 'no-cache' });
    res.end(a.body);
  } else if (pages.has(url)) {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
    res.end(pages.get(url));
  } else {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
    res.end(boardPage);
  }
}).listen(PORT, () => console.log(`dashboard on :${PORT}`));

startNotifier({ statusDir: STATUS, queueDir: QUEUE, workspaceDir: WORKSPACE, backlogDir: BACKLOG, topic: process.env.NTFY_TOPIC });
