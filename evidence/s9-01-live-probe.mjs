// evidence/s9-01-live-probe.mjs — is the s9-01 alarm fix ON THE LIVE DEPLOYMENT yet?
//
// Usage: node evidence/s9-01-live-probe.mjs [url] > evidence/s9-01-live-probe.json
//        (default url: https://imaginethegames.github.io/planet-rush/)
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The s9-01 brief asks for an evidence item against the LIVE deployment: an
// online match on a non-zero slot, your station attacked (the alarm sounds once,
// the arrow holds), then another player's station attacked (silence) — naming the
// served sha. The developer heard the bug in real play, so a green suite does not
// close it.
//
// That attestation cannot be written until the fix is actually deployed, and a
// "which sha is live?" answer goes stale the moment Pages publishes again. So this
// is the mechanical half, re-runnable: it names the served sha and reports whether
// the shipped bundle carries the fix at all. It does NOT replace listening to the
// build — it tells QA whether there is yet a build worth listening to.
//
// HOW IT DECIDES
// ---------------------------------------------------------------------------
// Two markers in the entry chunk, both introduced by this lane and both surviving
// minification because they are property-name strings, not identifiers:
//
//   __alarmStage   the read-back seam (`installAlarmStage`, src/main.ts). Present
//                  only on a build that carries the s9-01 wire fix, and the seam
//                  the live-stage specs read the engine's local slot through.
//   alarmStings    the one-shot's counter behind `AudioEngine.alarmSounds`. The
//                  pre-fix engine had no sting count at all — it started a LOOP
//                  (`this.alarmLoop = graph.startLoop(SOUND.alarm, 0, 'alarm')`).
//
// A marker check is a deployment question, not a behaviour one: it proves which
// CODE is being served, which is exactly the thing that was unprovable when the
// bug was "merged, tested, and dead-wired" (LESSONS §1).
const url = (process.argv[2] ?? 'https://imaginethegames.github.io/planet-rush/').replace(/\/?$/, '/');

const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${u}`);
  return r.text();
};

const version = await get(new URL('version.json', url)).then(JSON.parse).catch(() => null);
const index = await get(url);
const entry = index.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
if (!entry) throw new Error(`no entry chunk found in ${url}index.html`);
const bundle = await get(new URL(entry, url));

const markers = {
  // The s9-01 seam and the one-shot counter — both must be present.
  __alarmStage: bundle.includes('__alarmStage'),
  alarmStings: bundle.includes('alarmStings'),
  // A control: a seam that predates this lane. If this is false the marker method
  // itself is broken (a renamed chunk, a changed minifier) and the verdict is void.
  __pauseStage: bundle.includes('__pauseStage'),
};
const deployed = markers.__alarmStage && markers.alarmStings;

console.log(
  JSON.stringify(
    {
      what: 's9-01 — is the alarm fix (one-shot + correct seat) on the live deployment?',
      url,
      servedSha: version?.sha ?? null,
      servedAt: version?.time ?? null,
      entryChunk: entry,
      entryBytes: bundle.length,
      markers,
      methodValid: markers.__pauseStage,
      deployed,
      verdict: !markers.__pauseStage
        ? 'VOID — the control marker is missing; this probe cannot read this bundle'
        : deployed
          ? 'the fix IS deployed — the by-ear attestation (one sting on your own station, silence on another) can now be written against this sha'
          : 'the fix is NOT deployed — this bundle still carries the looping, slot-0 alarm, so the by-ear attestation cannot be written yet',
    },
    null,
    2,
  ),
);
