# n11-01-the-browse-row-has-no-ping.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/netcode/n11-01-browse-row-ping`, cut from `21a0942`.

## THE FIRST THING A FUTURE ME SHOULD READ

**The seam is joined already. `a1-17` photographed a RACE, not a missing wire.**
Measured on the live fleet from this lane (2026-08-13, `playwright` against
`https://imaginethegames.github.io/planet-rush/`, real allocator, two real
clients, host room `G8ZJ`):

```
guest t=  77ms  regions=[]                 rows=[]                        (list not in yet)
guest t= 613ms  regions=[]                 rows=["M7U4QW|IAD —"]          <- a1-17's frame
guest t=1220ms  regions=[]                 rows=["M7U4QW|IAD —"]
guest t=1748ms  regions=[iad:161,gru:274]  rows=["M7U4QW|VIRGINIA 161ms"] <- the number lands
```

`a1-17`'s capture read the row **42 ms after the listing landed**
(`readback-browser.json` `guestListWaitMs: 42`, and its own `"regions": []` /
`"regionLine": ""` say the survey had not answered yet either). So the row *does*
get the measured ping — about **1.1 s after the list it is drawn beside**.
`IAD —` is the pre-probe state, and the label proves it: a matched region prints
`VIRGINIA`, an unmatched one falls back to the raw code
(`src/ui/lobby-browser.ts` `rowWhere`).

That reframes the brief: nothing to *join*, everything to make **arrive sooner**
and to **say what it is** while it has not arrived.

## BUILT
<!-- what is actually finished, with the commit that did it -->

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

## NEXT
<!-- what remains, in order, and anything blocking -->
