/**
 * art-choices.mjs — the shape of a developer's ART verdict.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `status/art-review.json` describes a board as a QUESTION with OPTIONS, and
 * `status/art-choices.json` held ONE verdict per board:
 *
 *     choices['explosion-lab.html'] = { verdict, reason, at }
 *
 * `explosion-lab.html` asks three questions — one explosion each for ships,
 * stations and asteroids, nineteen candidates in all. The store could hold one
 * answer, so the first button the developer pressed (`ship-today`, top-left of
 * the page) was written as THE verdict for the whole board, the board left the
 * review list because it now had a verdict, and every candidate vanished:
 *
 *     "i was on the art page and i clicked one of the buttons at the top now
 *      all i see are old approved and denied things, the explosion vfx are all
 *      gone" ... "i didnt pick any of the explosions"
 *
 * Nothing they did was wrong. A board that asks three questions cannot be
 * answered by a store with room for one, and the two halves — spec and store —
 * were never checked against each other.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 *
 * A board entry holds an ANSWER PER QUESTION:
 *
 *     "explosion-lab.html": { answers: {
 *        ships:   { verdict: 'ship-hard-snap', at: '...' },
 *        station: { verdict: 'station-ash',    at: '...' } } }
 *
 * and the board is DECIDED only when every question it asks has an answer.
 * Until then it stays in review with the settled parts marked settled and the
 * open ones still asking.
 *
 * ── Migration is a READ, never a write ────────────────────────────────────
 *
 * The two verdicts in the live file are the old shape and are real decisions
 * the developer made:
 *
 *     "facility-concepts.html":    { verdict: "DENY ALL", reason: "none of
 *                                    these look like a mining space station" }
 *     "facility-concepts-r2.html": { verdict: "D" }
 *
 * They are migrated ON READ into `answers[SOLE_QUESTION]` and mean exactly what
 * they meant before. Nothing rewrites the file to the new shape on load: the
 * comment at the write handler in server.mjs records that a blind rewrite once
 * erased every ART decision the developer had ever made, and `status/` is
 * gitignored, so there is no backup to restore from. The file changes only when
 * the developer presses a button, and then only the entry they pressed —
 * `recordVerdict`/`clearVerdict` return the SAME objects for every board they
 * did not touch, so an untouched legacy entry is written back byte for byte.
 *
 * A verdict for a question the board no longer asks is kept, never counted, and
 * reported as `orphans` — the board goes back to asking. That is what turns the
 * bug above into its own recovery: a board that gained questions after being
 * answered once hands itself back to the developer instead of staying shut.
 *
 * Pure functions on plain objects, deliberately: the file read (and its refusal
 * to clobber a corrupt file) stays in server.mjs, and every rule about what a
 * verdict MEANS is testable without a server, a socket or a temp directory.
 */

/**
 * The question id a single-question board answers under. Boards that declare no
 * `questions` array — every board but the explosion lab today — ask exactly one
 * thing, and the old one-verdict-per-board entries are answers to it.
 */
export const SOLE_QUESTION = 'board';

/** Board names and question ids reach here from an HTTP body. Same sanitiser
 *  the ART handler has always used on the board name, applied to both. */
const idOf = (s) => String(s ?? '').replace(/[^a-z0-9._-]/gi, '');

function optionsOf(q) {
  return (Array.isArray(q?.options) ? q.options : [])
    .filter(o => o && typeof o.id === 'string' && o.id)
    .map(o => ({ id: o.id, label: typeof o.label === 'string' && o.label ? o.label : o.id }));
}

/**
 * The questions a board asks, normalised to one shape whatever the manifest says.
 *
 * A spec may declare `questions: [{ id, question, options }]` (the explosion lab)
 * or the original flat `question` + `options` (everything else). A board with no
 * manifest entry at all — ratified reference, decided long ago — still asks one
 * implicit question, so the caller never has to special-case an empty list.
 */
export function questionsOf(spec) {
  if (Array.isArray(spec?.questions) && spec.questions.length) {
    return spec.questions.map((q, i) => ({
      id: idOf(q?.id) || `q${i + 1}`,
      // A short heading for the page's question row ("SHIPS"), separate from the
      // prose the developer reads before answering. Optional: a manifest that
      // gives none falls back to the question id.
      title: typeof q?.title === 'string' ? q.title : '',
      question: typeof q?.question === 'string' ? q.question : (spec.question ?? ''),
      options: optionsOf(q),
    }));
  }
  return [{
    id: SOLE_QUESTION,
    title: '',
    question: typeof spec?.question === 'string' ? spec.question : '',
    options: optionsOf(spec),
  }];
}

/**
 * The answers held for one board, in the new shape, whichever shape is on disk.
 * This is the whole migration, and it happens on every read.
 */
export function answersOf(entry) {
  if (!entry || typeof entry !== 'object') return {};
  if (entry.answers && typeof entry.answers === 'object') {
    const out = {};
    for (const [q, a] of Object.entries(entry.answers)) {
      if (a && typeof a === 'object' && typeof a.verdict === 'string') {
        out[idOf(q) || SOLE_QUESTION] = { verdict: a.verdict, reason: a.reason, at: a.at };
      }
    }
    return out;
  }
  // THE OLD SHAPE: one verdict for the board — an answer to its one question.
  if (typeof entry.verdict === 'string') {
    return { [SOLE_QUESTION]: { verdict: entry.verdict, reason: entry.reason, at: entry.at } };
  }
  return {};
}

/**
 * What is settled and what is still being asked, for one board.
 *
 * `decided` is the flag the page routes on, and it is deliberately strict: a
 * board is decided when it has at least one answer AND nothing left open. Three
 * questions with one answer is not a decided board, which is the entire bug.
 */
export function boardState(spec, entry) {
  const answers = answersOf(entry);
  const asked = questionsOf(spec).map(q => q.id);
  const answered = asked.filter(id => answers[id]);
  const open = asked.filter(id => !answers[id]);
  // Answers to questions this board no longer asks. Kept (a decision is the
  // developer's, not ours to delete) and never counted towards `decided`.
  const orphans = Object.keys(answers).filter(id => !asked.includes(id));
  return { answers, asked, answered, open, orphans, decided: answered.length > 0 && open.length === 0 };
}

/**
 * Record one answer, returning the object to write.
 *
 * Only the named board's entry is rebuilt; every other entry is passed through
 * by reference, so a board nobody touched serialises exactly as it was read.
 * Throws on a payload that names no board or carries no verdict — the caller
 * turns that into a 400 rather than writing something meaningless.
 */
export function recordVerdict(raw, { board, question, verdict, reason, at } = {}) {
  const b = idOf(board);
  const q = idOf(question) || SOLE_QUESTION;
  if (!b) throw new Error('a verdict must name a board');
  if (typeof verdict !== 'string' || !verdict.trim()) throw new Error('a verdict must be a verdict');
  const store = raw && typeof raw === 'object' ? raw : {};
  const answers = answersOf(store[b]);
  answers[q] = {
    verdict: verdict.slice(0, 64),
    reason: typeof reason === 'string' && reason ? reason.slice(0, 500) : undefined,
    at: typeof at === 'string' && at ? at : new Date().toISOString(),
  };
  return { ...store, [b]: { answers } };
}

/**
 * Take one answer back, returning the object to write.
 *
 * The developer changing their mind is a normal event. Until now a recorded
 * verdict could only be undone by hand-editing `status/art-choices.json` — which
 * is what the Director had to do to give the explosion lab back after one tap
 * closed it. Clearing the last answer removes the board's entry entirely, so the
 * board returns to review exactly as it was before anyone pressed anything.
 * Clearing an answer that was never there is not an error: the end state the
 * caller asked for is the end state they get.
 */
export function clearVerdict(raw, { board, question } = {}) {
  const b = idOf(board);
  const q = idOf(question) || SOLE_QUESTION;
  if (!b) throw new Error('a clear must name a board');
  const store = raw && typeof raw === 'object' ? raw : {};
  const next = { ...store };
  if (!(b in store)) return next;
  const answers = answersOf(store[b]);
  delete answers[q];
  if (Object.keys(answers).length === 0) delete next[b];
  else next[b] = { answers };
  return next;
}

/** Every board's verdicts, normalised, with the state the ART page routes on. */
export function describeChoices(raw, review) {
  const out = {};
  for (const board of Object.keys(raw ?? {})) {
    const { answers, answered, open, orphans, decided } = boardState((review ?? {})[board], raw[board]);
    out[board] = { answers, answered, open, orphans, decided };
  }
  return out;
}

/** Every board's spec, with its questions normalised to the one shape. */
export function describeReview(review) {
  const out = {};
  for (const [board, spec] of Object.entries(review ?? {})) {
    if (!spec || typeof spec !== 'object') continue;
    out[board] = { ...spec, questions: questionsOf(spec) };
  }
  return out;
}

/**
 * One flat row per recorded answer — `{ key, verdict, reason, at }` — for
 * `aggregate.mjs`, which raises the ops ping that tells the Director a verdict
 * landed and needs actioning.
 *
 * That reader walked the store one entry deep and read `.verdict`/`.at` off it.
 * Under the per-question shape those are `undefined`, so every future ART
 * verdict would have raised NO ping at all: the developer presses the button,
 * nothing tells the Director, and the pick sits. That is the failure this whole
 * review loop exists to prevent — an ART deny once sat 17 hours and a SOUND deny
 * eight days — so the shape change has to bring its own reader with it.
 *
 * The key names the question when there is more than one, because the ping's
 * message is the key: "explosion-lab.html · ships" tells the Director which
 * third of the board just closed.
 */
export function verdictRows(raw) {
  const rows = [];
  for (const [board, entry] of Object.entries(raw ?? {})) {
    for (const [question, a] of Object.entries(answersOf(entry))) {
      if (!a.at) continue;   // undated: nothing to key a ping on
      rows.push({
        key: question === SOLE_QUESTION ? board : `${board} · ${question}`,
        verdict: String(a.verdict ?? ''),
        reason: typeof a.reason === 'string' ? a.reason : '',
        at: a.at,
      });
    }
  }
  return rows;
}
