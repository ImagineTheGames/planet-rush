# a0-109 — the explosion board asks three questions and can hold one answer

Captured 2026-08-20 against the real `status/art-review.json` and a copy of the
real `status/art-choices.json`, with `WORKSPACE_DIR` pointed at this checkout so
the boards under `docs/art-direction/` are the real ones. `STATUS_DIR` is a temp
copy throughout: nothing here wrote to the live `/status`.

## The report, reproduced (today's code)

- `00-today-before-the-tap.png` — the ART page on the dashboard as it runs
  today. The explosion lab is one question with nineteen buttons in a row.
- `00b-today-after-one-tap.png` — the same page after clicking **SHIPS — Today
  (what ships now)**, the first button, once. No confirmation was asked. Every
  candidate is gone and the board has moved to the decided shelf, which is what
  the developer met:
  *"i didnt pick any of the explosions, i just clicked something and it all went
  as if i had approved them"*.
  The store held `{"verdict":"ship-today"}` for the whole board, and the page
  counted 0 remaining candidates.

## This branch

- `01-three-questions.png` — the same board, unanswered: **3 OF 3 QUESTIONS
  STILL OPEN**, one row per family (SHIPS / STATIONS / ASTEROIDS), all nineteen
  candidates offered, each family carrying its own DENY ALL.
- `03-settled-and-open.png` — after answering SHIPS and STATIONS: **1 OF 3
  QUESTIONS STILL OPEN**. The two settled rows name what was picked and carry
  TAKE IT BACK; ASTEROIDS is still asking; the board is still in review with its
  live iframe. Below it, the two real verdicts in the live file — the
  facility-concepts DENY ALL with its reason and facility-concepts-r2's D —
  read correctly through the migration and are undoable too.

Driven through the real page in Chromium (not the API), the confirmation reads:

    Record this as your answer?

        SHIPS — Hard snap

    answering:

        Which explosion should a destroyed SHIP use? "Today" is what currently ships.

    You can take it back afterwards.

Dismissing it recorded nothing (`choices['explosion-lab.html']` stayed `null`);
accepting recorded `ships` only, leaving `stations` and `asteroids` open;
TAKE IT BACK removed it and put the question back on the board.

## Tests

- `tests-against-todays-code.txt` — `dashboard/art-choice.test.mjs` run with
  `DASHBOARD_DIR` pointed at a pristine copy of the pre-a0-109 dashboard: **0
  pass, 6 fail**, including both names the DoD asks for. The first failure is
  *"both answers must be in the file — one verdict per board is what lost the
  other eighteen candidates"*.
- `tests-against-this-branch.txt` — the same file against this branch's tree:
  **6 pass, 0 fail**.

The five existing dashboard test files still pass unchanged (aggregate 6,
board 10, decision-visible 3, lane-wiring 2, notifier 33).
