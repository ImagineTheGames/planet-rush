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
