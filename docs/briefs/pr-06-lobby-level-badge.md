# pr-06 — a level badge on a lobby seat, and nowhere else in the game

**Owner:** UI Engineer + Platform Engineer · **needs: pr-01**
**Plan:** `docs/progression-plan.md` §Q2, §2.1 · **GDD:** §2.1 (the lobby), §2.2 (what a player may read)

---

## The ask

The developer's ruling, verbatim, 2026-08-07:

> *"we can show the LEVEL but not XP (and show it only in the lobby)."*

That is a **stronger** answer than the plan recommended, and it is the whole brief. Two halves,
and the second is the one that needs a test:

1. **Build it:** a level badge on the lobby's seat row, reading the local player's level from
   `loadProfile`.
2. **Prove the absence:** **no other surface in the game renders a level or any XP.** Not on an
   in-match nameplate, not in the HUD, not on the end screen for anyone but yourself. And **raw
   XP is private to its owner, always** — the badge shows a level, never an XP total, not even
   your own.

## Why the absence is the point

The game deliberately fogs what a player may read about a live opponent (GDD §2.2), and a level
floating over an enemy hull is exactly the kind of standing information that ruling exists to
prevent. The developer's answer resolves it cleanly: **the badge is gone before RUSH! is
pressed**, so it can never be read as in-match information about a live opponent. That property
holds only as long as nobody helpfully adds a badge to a nameplate later, which is why the test
is written as an absence and why it is in this brief rather than left implicit.

## Also here: the storage seam gains `remove`

```ts
// src/platform/platform.ts:35-39 — the interface; :104-119 — its one browser implementation.
readonly storage: {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;   // NEW
};
```

**This is for migration, not for a reset.** Progression is never wiped (§Q4) and there is no
reset button in this chain — but a migration that must *retire* a key cannot do it with `set`,
and pr-01's `planet-rush:profile.bak` needs clearing once a profile is recovered. Add the method
and its one implementation; do not add a UI for it.

## Test first

1. **The badge renders.** A lobby seat row for the local player, with a profile at level 7, draws
   `7` (or `LVL 7` — the copy is yours, the industrial voice is `docs/copy-sweep-industrial-voice.md`).
2. **A fresh profile reads level 1**, and the row is not blank or `undefined`.
3. **Bots and remote seats show no badge.** A bot has no profile; a remote human's level is a
   number their client authored (§2.2 — there are no accounts) and is not read, not requested and
   not rendered.
4. **THE ABSENCE.** A repo-level assertion that no other UI surface renders a level or an XP
   total: over `src/ui/nameplates.ts`, `src/ui/hud.ts`, `src/ui/chrome.ts` and
   `src/ui/end-of-match.ts`'s opponent-facing paths. Write it as a test with the ruling quoted in
   the test name, so a future lane that adds one has to delete a sentence from the developer to
   do it.
5. **`remove` deletes a key** and is a no-op on a key that is not there.

## Traps

- **Never render another player's level.** Even if a future wire message carries one. Especially
  then: it is unverifiable (§2.2) and it is what §Q2 forbids.
- **No XP anywhere.** Not on the badge, not as a tooltip, not in a debug overlay that ships.
- **Do not add a reset button.** It was s4's Task P5 and it is cancelled (§Q4). `remove` exists
  for migration.
- **`a0-06` is moving the lobby to picking the character** and is in flight on the same rows.
  Merge `origin/main` before measuring anything about the lobby's layout, and expect to rebase.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "grep -n 'remove' src/platform/platform.ts | grep -q ."
bash -c "grep -rniE '\\blevel\\b|\\bxp\\b' src/ui/nameplates.ts | grep -viE 'levelling|//|\\*' | wc -l | grep -q '^0$'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

*(The fourth line is a smoke check, not the real guarantee — test 4 is. If the grep is noisy
against the shipped file, tighten it in the PR and say what you tightened.)*

## Evidence line

Two frames: a lobby seat row carrying the badge, and an in-match nameplate at the same seat
carrying none. The pair is the ruling, shown.

## Open questions this brief is exposed to

**None.** §Q2 is ratified and unusually specific.

---

## AS BUILT *(p1-06, branch `agent/ui/p1-06-lobby-level-badge`)*

The brief was implemented as written except where it and
`docs/progression-plan.md` disagreed. **The plan wins** (the chain says so), so
the one disagreement is corrected here rather than shipped.

### 1. THE CORRECTION — "not even your own" is too strong, and the plan says so

**The brief, above:** *"no other surface in the game renders a level or any XP …
raw XP is private to its owner, always — the badge shows a level, never an XP
total, not even your own."*

Read literally, that forbids two things the developer ratified **in the same
pass** and that were merged before this lane started:

- **The end-of-match summary** counts up your own XP and fills your own level bar
  — plan §6.3 beats 2–4, from the developer's own words: *"the progress bar
  filling up to show you current level, whats left till next level as it fills
  up"*. Shipped by pr-05 (#347).
- **The hangar** shows a `LEVEL n` block and an XP figure on the front door
  (a0-14, `src/ui/hangar.ts`).

The brief concedes the point itself, two paragraphs later, by scoping its own
test to *"`end-of-match.ts`'s **opponent-facing paths**"* rather than to the whole
file. So the sentence is the loose one, not the rule.

**Built to the plan's reading**, which §Q2 and the GDD §2.12 draft both state:
**a level badge sits on a lobby seat row and nowhere else — never on an in-match
nameplate, never in the HUD, never on the end screen for anyone but yourself —
and nobody else's level is shown anywhere, ever.** Your own career on your own
screen is the owner reading their own record; an opponent's is what §2.2 fogs.
`src/ui/level-badge.test.ts`'s header states this in as many words, so the next
lane inherits the reasoning rather than re-deriving it.

Asserting the literal sentence was rejected: it would have failed on `main` the
day it was written, against two ratified screens.

### 2. The five tests, as built — `src/ui/level-badge.test.ts` (17 tests)

1. **The badge renders.** A profile at level 7 (XP written through
   `saveProfile`, level read back through `loadProfile`) puts **`LVL 7`** on the
   local seat's row. The copy is `LVL`, not `LEVEL`: the chip is
   `ROSTER.trailingWidth` = 54 px and floors at 40, where `MEDIUM` already
   auto-fits down — `LEVEL 7` is longer. Plus: the badge follows the local seat
   through `seatLocalPlayer` (online, the seat is the server's), exactly one row
   is badged at every match size, and no lobby string matches `/\bxp\b/i`.
2. **A fresh profile reads level 1**, and so does a lobby opened with no level at
   all — never blank, never `undefined`, never `NaN`. A junk level folds to 1 at
   both the seam and the formatter.
3. **Bots and remote seats show no badge.** Bot rows, an OPEN row, a CLOSED row —
   and a **wire-seated** remote human, folded in through a real `lobbyState`
   broadcast, with the broadcast's own slots asserted to carry no level field
   (`../net/transport` `LobbySlot` has none and must not grow one).
4. **THE ABSENCE**, with the ruling quoted in the test names: a source scan for
   any printable string matching `/\b(lvl|level|xp)\b/i` over `nameplates.ts`,
   `nameplates-view.ts`, `hud.ts` and `chrome.ts` (comments stripped — those
   files discuss levels at length and must be allowed to), plus behavioural
   passes over `nameplateModel` (ship + station, TEAMS, tier suffix, own-ship
   label — every channel a level could ride in on) and over `endOfMatchModel`'s
   four outcomes, checking values **and keys**.
5. **`remove` deletes a key** and is a no-op on a key that is not there — plus a
   removed key can be written again, and a throwing store (private mode, quota)
   degrades to a no-op rather than throwing into game code.

### 3. The DoD's fourth line, tightened as the brief invited

The smoke grep `grep -rniE '\blevel\b|\bxp\b' src/ui/nameplates.ts | grep -viE
'levelling|//|\*'` **passes unchanged** — it was not noisy against the shipped
file, so nothing needed tightening. It is still the weaker instrument, for the
reason the brief gives: it reads one file and cannot tell a comment from a label
in the general case. Test 4 is the guarantee.

### 4. Where the badge sits, and what it did not cost

In the roster row's **trailing tier chip** — the rect a bot row spends on
`EASY`/`MEDIUM`/`HARD`. The two can never both want it, so the badge takes a rect
that was already laid out and already empty on your row: **no new segment** in
`lobby-geometry.ts` `seatTrailing`, nothing else on the row narrows, and the
order of surrender a narrowing row keeps is untouched. It draws on the `inert`
surface (it is a value, not a control) and the hit test is unchanged —
`lobbyHitTest` already declines to name the tier rect, so a tap there still falls
through to the row body.

### 5. A finding about the goldens, not a footnote

**All five lobby baselines passed unchanged against the build that added the
badge.** They shoot the whole frame at `maxDiffPixelRatio: 0.01`, which on a
dpr-3 phone is ~29 600 pixels of slack; a ~54 × 48 px chip is an order of
magnitude under it. Both halves were fixed: the five baselines were re-generated,
and **two new region goldens** shoot the chip's own bounds (desktop and the
landscape phone, where the trailing chips are narrowest), reading the region off
`__lobby.levelBadgeBounds` — the client's own report of where it drew, never a
rect the spec computed. The seam gained `levelBadges` and `levelBadgeBounds`,
pure read-back.

### 6. Not built, deliberately

No reset button — `remove` exists for migration and nothing calls it yet (§Q4).
No unlock content (§4 designs none). No level on the wire.
