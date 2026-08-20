import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describeChoices, describeReview, recordVerdict, clearVerdict, SOLE_QUESTION } from './art-choices.mjs';

/**
 * a0-109 — a board that asks three questions can only hold one answer.
 *
 * The developer opened the ART page, pressed the first button on the explosion
 * lab, and the whole board vanished:
 *
 *   "i was on the art page and i clicked one of the buttons at the top now all
 *    i see are old approved and denied things, the explosion vfx are all gone"
 *   "i didnt pick any of the explosions, i just clicked something and it all
 *    went as if i had approved them"
 *
 * `status/art-review.json` describes that board as THREE questions — one
 * explosion each for ships, stations and asteroids, nineteen candidates in all
 * (the brief says eighteen; asteroids carries seven, and the board itself draws
 * all nineteen: candidates A–S). The store held ONE verdict per board, so
 * `ship-today` — the first button on the page — was recorded as the answer to
 * everything, and a board with a verdict leaves the review list by design.
 *
 * These tests cover the seam between the two halves, which is where the defect
 * lives. Both named tests fail on the code as it stood before this branch:
 *   - "a multi-question board keeps every answer" — the second answer
 *     overwrote the first, so the board could never hold more than one;
 *   - "a verdict can be taken back" — there was no way to clear one from the
 *     page at all; the Director had to hand-edit status/art-choices.json.
 *
 * ── What is under test ────────────────────────────────────────────────────
 *
 * The real `/api/art` and `/api/art/choice`, driven over HTTP against a real
 * `server.mjs` in a temp STATUS/WORKSPACE, seeded from COPIES OF THE LIVE
 * FILES (fixtures/) — the same two verdicts the developer really made, so the
 * migration is proved against the bytes that are actually on the studio box and
 * not against a convenient invention.
 *
 * The dashboard lives outside this repo (/opt/studio/dashboard), and only the
 * files this brief changes are vendored here, so `server.mjs` cannot always be
 * booted from a bare checkout — it reads every page in site/ at startup. When a
 * complete tree is not available the same assertions run against the module the
 * handlers call, and the wiring test below is what keeps that honest: it fails
 * if server.mjs stops routing through those functions.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
/** The tree under test: this repo's vendored copy, or whatever DASHBOARD_DIR
 *  names — pointing it at a pristine pre-a0-109 dashboard is how the two named
 *  tests below were watched to fail on today's code. Fixtures always come from
 *  here: they are the live files this branch is proved against. */
const SRC = process.env.DASHBOARD_DIR ?? HERE;

/** A dashboard tree complete enough to boot: every page server.mjs reads at
 *  startup. DASHBOARD_DIR overrides, which is how this file was run against a
 *  pristine copy of the pre-a0-109 code to watch both tests fail. */
function runnableTree() {
  for (const root of [process.env.DASHBOARD_DIR, HERE, '/opt/studio/dashboard']) {
    if (!root) continue;
    const complete = ['server.mjs', 'aggregate.mjs', 'board.mjs', 'notifier.mjs',
      'site/Agent Board.dc.html', 'site/Art.dc.html', 'site/support.js', 'site/fonts',
      // board.mjs reaches out of the dashboard for the supervisor's brief parser,
      // so a tree without that sibling cannot boot however complete it looks.
      '../supervisor/lib/brief.mjs']
      .every(f => existsSync(join(root, f)));
    if (complete) return root;
  }
  return null;
}

const freePort = () => new Promise(res => {
  const s = netServer();
  s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** A STATUS/WORKSPACE/QUEUE the ART endpoints can be pointed at, seeded with
 *  copies of the real manifest and the real verdicts file. */
function scaffold(t) {
  const dir = mkdtempSync(join(tmpdir(), 'a0109-'));
  const status = join(dir, 'status');
  const workspace = join(dir, 'workspace');
  const queue = join(dir, 'queue');
  const backlog = join(dir, 'backlog');
  for (const d of [status, backlog, join(workspace, 'docs', 'art-direction'),
    ...['pending', 'active', 'done', 'blocked'].map(l => join(queue, l))]) {
    mkdirSync(d, { recursive: true });
  }
  // The boards the fixtures talk about. Contents do not matter: the page
  // iframes them, these tests never open them.
  for (const b of ['facility-concepts.html', 'facility-concepts-r2.html', 'explosion-lab.html']) {
    writeFileSync(join(workspace, 'docs', 'art-direction', b), '<html><body>board</body></html>');
  }
  copyFileSync(join(FIXTURES, 'art-choices.live.json'), join(status, 'art-choices.json'));
  copyFileSync(join(FIXTURES, 'art-review.live.json'), join(status, 'art-review.json'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, status, workspace, queue, backlog };
}

/**
 * The ART endpoints, over HTTP against the real server when a complete tree is
 * present, and through the functions those handlers call when it is not.
 */
async function driverFor(t, paths) {
  const root = runnableTree();
  if (!root) {
    const readJson = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
    const choicesPath = join(paths.status, 'art-choices.json');
    return {
      kind: 'module',
      get: async () => {
        const raw = readJson(choicesPath, {});
        const review = readJson(join(paths.status, 'art-review.json'), {});
        return { boards: ['facility-concepts.html', 'facility-concepts-r2.html', 'explosion-lab.html'],
          choices: describeChoices(raw, review), review: describeReview(review), work: {} };
      },
      post: async (body) => {
        try {
          const raw = readJson(choicesPath, {});
          const next = body.clear === true ? clearVerdict(raw, body) : recordVerdict(raw, body);
          writeFileSync(choicesPath, JSON.stringify(next, null, 2));
          return { status: 200, ok: true };
        } catch { return { status: 400, ok: false }; }
      },
    };
  }
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), STATUS_DIR: paths.status, QUEUE_DIR: paths.queue,
      WORKSPACE_DIR: paths.workspace, BACKLOG_DIR: paths.backlog, NTFY_TOPIC: '', LIVE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', c => { stderr += c; });
  t.after(() => child.kill('SIGKILL'));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) assert.fail(`server.mjs exited (${child.exitCode}): ${stderr.slice(0, 400)}`);
    try { if ((await fetch(`${base}/api/art`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  return {
    kind: 'http', root,
    get: async () => (await fetch(`${base}/api/art`)).json(),
    post: async (body) => {
      const r = await fetch(`${base}/api/art/choice`, { method: 'POST', body: JSON.stringify(body) });
      return { status: r.status, ...(await r.json()) };
    },
  };
}

const onDisk = (paths) => JSON.parse(readFileSync(join(paths.status, 'art-choices.json'), 'utf8'));
const LIVE = JSON.parse(readFileSync(join(FIXTURES, 'art-choices.live.json'), 'utf8'));

/**
 * THE BUG, END TO END: three questions, three answers, and answering one leaves
 * the other two open.
 *
 * On the old store the second POST overwrote the first — one verdict per board
 * was all there was room for — so the second assertion here is the one that
 * fails, and the developer's version of that failure was every candidate
 * disappearing the moment they touched a button.
 */
test('a multi-question board keeps every answer', async (t) => {
  const paths = scaffold(t);
  const api = await driverFor(t, paths);
  const BOARD = 'explosion-lab.html';

  assert.equal((await api.get()).choices[BOARD], undefined, 'the lab starts with no answers at all');

  // Two answers to two different questions. THIS IS THE BUG: the old store held
  // one verdict per board, so the second write replaced the first and the board
  // could never carry more than one answer at a time.
  assert.equal((await api.post({ board: BOARD, question: 'ships', verdict: 'ship-hard-snap' })).ok, true);
  assert.equal((await api.post({ board: BOARD, question: 'stations', verdict: 'station-ash' })).ok, true);
  const stored = onDisk(paths)[BOARD];
  assert.deepEqual(Object.keys(stored.answers ?? {}).sort(), ['ships', 'stations'],
    'both answers must be in the file — one verdict per board is what lost the other eighteen candidates');
  assert.equal(stored.answers.ships.verdict, 'ship-hard-snap', 'the SHIPS answer must survive the STATIONS answer');
  assert.equal(stored.answers.stations.verdict, 'station-ash');

  // ...and the board is NOT decided: a decided board leaves the review list,
  // which is exactly how the candidates disappeared on the first tap.
  const two = (await api.get()).choices[BOARD];
  assert.deepEqual(two.open, ['asteroids'], 'answering two questions leaves the third open');
  assert.equal(two.decided, false, 'two answers out of three is not a decided board');

  // The board really does ask three questions, and every candidate is offered.
  const questions = (await api.get()).review[BOARD]?.questions ?? [];
  assert.deepEqual(questions.map(q => q.id), ['ships', 'stations', 'asteroids'],
    'the explosion lab asks one question per family');
  assert.equal(questions.reduce((n, q) => n + q.options.length, 0), 19,
    'every candidate on the board must be offered — the whole complaint was candidates vanishing');

  // The third answer closes it.
  assert.equal((await api.post({ board: BOARD, question: 'asteroids', verdict: 'asteroid-dust-bloom' })).ok, true);
  const all = (await api.get()).choices[BOARD];
  assert.deepEqual(all.open, [], 'nothing left open');
  assert.equal(all.decided, true, 'a board is decided only when every question it asks has an answer');
  assert.deepEqual(Object.keys(all.answers).sort(), ['asteroids', 'ships', 'stations']);

  // THE LIVE FILE STILL MEANS WHAT IT MEANT. Two real verdicts, migrated on
  // read, and — because nothing but the touched entry is rebuilt — written back
  // to disk unchanged after three writes landed beside them.
  const migrated = (await api.get()).choices;
  assert.equal(migrated['facility-concepts.html'].answers[SOLE_QUESTION].verdict, 'DENY ALL');
  assert.equal(migrated['facility-concepts.html'].answers[SOLE_QUESTION].reason,
    'none of these look like a mining space station', 'the reason IS the steering signal; it must survive');
  assert.equal(migrated['facility-concepts.html'].decided, true);
  assert.equal(migrated['facility-concepts-r2.html'].answers[SOLE_QUESTION].verdict, 'D');
  assert.equal(migrated['facility-concepts-r2.html'].decided, true);
  const file = onDisk(paths);
  assert.deepEqual(file['facility-concepts.html'], LIVE['facility-concepts.html'],
    'an untouched legacy entry must be written back exactly as it was found');
  assert.deepEqual(file['facility-concepts-r2.html'], LIVE['facility-concepts-r2.html']);
  assert.deepEqual(Object.keys(file[BOARD]), ['answers'],
    'the touched entry is the only one that takes the new shape');
});

/**
 * UNDO. "There is no undo" was the third fault: a recorded verdict could not be
 * taken back from the page, so the Director had to hand-edit
 * status/art-choices.json to give the explosion lab back after one tap closed
 * it. On the old handler the POST below is rejected outright (it carries no
 * `verdict` string) and the answer stays where it was.
 */
test('a verdict can be taken back', async (t) => {
  const paths = scaffold(t);
  const api = await driverFor(t, paths);
  const BOARD = 'explosion-lab.html';

  // One question of three, taken back: the OTHER answer must not move.
  await api.post({ board: BOARD, question: 'ships', verdict: 'ship-hard-snap' });
  await api.post({ board: BOARD, question: 'stations', verdict: 'station-ash' });
  assert.equal((await api.post({ board: BOARD, question: 'ships', clear: true })).ok, true,
    'clearing one answer is a normal request, not an error');
  const after = (await api.get()).choices[BOARD];
  assert.equal(after.answers.ships, undefined, 'the SHIPS answer is gone');
  assert.equal(after.answers.stations?.verdict, 'station-ash', 'taking one answer back must not disturb another');
  assert.ok(after.open.includes('ships'), 'the question goes back on the board');

  // A single-question board — the old shape, a real verdict the developer gave
  // — can be taken back too, and the board returns to review with its options.
  assert.equal((await api.post({ board: 'facility-concepts-r2.html', clear: true })).ok, true);
  const back = await api.get();
  assert.equal(back.choices['facility-concepts-r2.html'], undefined,
    'clearing the last answer removes the entry, so the board is undecided again');
  assert.equal(back.review['facility-concepts-r2.html'].questions[0].options.length, 3,
    'and it is asking its three options again');
  assert.equal(onDisk(paths)['facility-concepts-r2.html'], undefined, 'gone from the file, not just from the view');

  // Everything else is untouched: taking one verdict back is not a rewrite.
  assert.deepEqual(onDisk(paths)['facility-concepts.html'], LIVE['facility-concepts.html']);

  // Clearing the last answer of a board leaves no husk behind — the board is
  // back exactly as it was before anyone pressed anything.
  await api.post({ board: BOARD, question: 'stations', clear: true });
  assert.equal(onDisk(paths)[BOARD], undefined, 'no empty entry left holding the board out of review');
  const clean = await api.get();
  assert.equal(clean.choices[BOARD], undefined);
  assert.equal(clean.review[BOARD].questions.length, 3, 'and all three questions are asking again');

  // Clearing something that was never recorded is not an error, and writes
  // nothing: the end state asked for is the end state given.
  const beforeNoop = readFileSync(join(paths.status, 'art-choices.json'), 'utf8');
  assert.equal((await api.post({ board: 'never-existed.html', clear: true })).ok, true);
  assert.equal(readFileSync(join(paths.status, 'art-choices.json'), 'utf8'), beforeNoop);
});

/**
 * A MIS-TAP MUST BE VISIBLE BEFORE IT COMMITS. The developer pressed one button
 * and a permanent decision was recorded with nothing asked and nothing named:
 * "i didnt pick any of the explosions, i just clicked something". The
 * confirmation has to quote the option, or it is a dialog that teaches people
 * to press OK.
 */
test('nothing is recorded until the developer confirms the option by name', () => {
  const src = readFileSync(join(SRC, 'site', 'Art.dc.html'), 'utf8');
  assert.match(src, /window\.confirm\([^)]*opt\.label/,
    'the confirmation must name the option that is about to be recorded');
  assert.match(src, /if \(!window\.confirm\([\s\S]{0,400}?\) return;[\s\S]{0,200}?this\.choose\(/,
    'a declined confirmation must return before anything is posted');
  assert.match(src, /act: \(\) => this\.ask\(name, q, o\)/,
    'every option button must go through the confirming path, not straight to choose()');
});

/** ...and the way back has to be on the page, next to the decision it undoes. */
test('the page offers a way to take a verdict back', () => {
  const src = readFileSync(join(SRC, 'site', 'Art.dc.html'), 'utf8');
  assert.match(src, /TAKE IT BACK/, 'a settled answer must carry its own undo control');
  assert.match(src, /askClear\(board, qid/, 'undo is per question, not per board');
  assert.match(src, /clear: true/, 'the page must ask the API to clear, not to record something empty');
});

/**
 * THE WIRING. These endpoints are thin on purpose — every rule about what a
 * verdict means lives in art-choices.mjs — so the one thing that can silently
 * rot is server.mjs bypassing it. This is also what keeps the module-driver
 * fallback above honest on a tree the server cannot boot from.
 */
test('the ART endpoints route through the per-question store', () => {
  const src = readFileSync(join(SRC, 'server.mjs'), 'utf8');
  assert.match(src, /import \{[^}]*recordVerdict[^}]*clearVerdict[^}]*\} from '\.\/art-choices\.mjs'/);
  assert.match(src, /clear === true\s*\r?\n?\s*\? clearVerdict\(choices/, 'clear must go through clearVerdict');
  assert.match(src, /: recordVerdict\(choices/, 'record must go through recordVerdict');
  assert.match(src, /readChoicesOrRefuse\(join\(STATUS, 'art-choices\.json'\), 'ART'\)/,
    'a corrupt verdicts file must still refuse the write rather than be replaced by it');
  assert.match(src, /review = describeReview\(rawReview\)/);
  assert.match(src, /choices = describeChoices\(rawChoices, rawReview\)/);
  assert.match(src, /JSON\.stringify\(\{ boards, choices, review, work \}\)/,
    '/api/art must still send the payload the page reads');
  // Migration is a READ. Nothing may write this file except the two handlers
  // that a button press reaches — a blind rewrite on load once erased every ART
  // decision the developer had ever made, and status/ has no backup.
  assert.equal(src.match(/writeFileSync\(join\(STATUS, 'art-choices\.json'\)/g)?.length, 1,
    'exactly one place writes the verdicts file');
});

/**
 * A PICK IS ONLY CLOSED WHEN ITS CONSEQUENCE IS VISIBLE ("after approving it
 * vanished"). Now that one board can hold three picks, each pick has to name
 * the brief acting on IT — the brief that ports the chosen ship explosion names
 * `ship-hard-snap`, not the lab it came from.
 */
test('each answer names the brief that acts on it, and that brief\'s lane', async (t) => {
  const paths = scaffold(t);
  // BEFORE the server starts: the brief index is cached for 30 s at a time (the
  // queue is ~190 files on a slow mount and re-reading it per request once hung
  // the whole dashboard), so a brief that appears mid-test is legitimately not
  // visible yet. Queue it first and the very first read sees it.
  writeFileSync(join(paths.queue, 'pending', 'a2-11-port-the-ship-explosion.md'),
    '# a2-11 — port ship-hard-snap into the client\n\nThe developer picked it on the explosion lab.\n');
  const api = await driverFor(t, paths);
  if (api.kind !== 'http') return; // the brief index is the server's; nothing to assert without it
  await api.post({ board: 'explosion-lab.html', question: 'ships', verdict: 'ship-hard-snap' });
  const { work } = await api.get();
  assert.deepEqual(work['ship-hard-snap'], [{ file: 'a2-11-port-the-ship-explosion.md', lane: 'pending' }],
    'the chosen option must resolve to the brief that names it, and its real lane');
  // And the substring trap that guard exists for: a one-letter verdict must
  // never be looked up, or every brief in the queue reads as work on it.
  await api.post({ board: 'facility-concepts-r2.html', verdict: 'D' });
  assert.equal((await api.get()).work['D'], undefined, 'a verdict too short to be a token is never matched');
});
