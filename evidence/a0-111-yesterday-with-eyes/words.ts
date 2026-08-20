/**
 * evidence/a0-111-yesterday-with-eyes/words.ts — every string this bundle
 * RASTERISED, caught at the last moment before it became pixels.
 * OWNER: QA Manager (a0-111).
 *
 * ── WHY A RECORDER AND NOT A grep ───────────────────────────────────────────
 * The brief's hard question about item 2 is "the word *claim* must not appear on
 * any screen a player can reach — look for it; do not assume the audit test
 * caught every path, because a string can be assembled at runtime." A `grep` over
 * `src/` answers a question about SOURCE. `src/ui/copy-audit.test.ts` answers a
 * question about the exported constants it happens to import. Neither can see a
 * string built from two halves at draw time — and that shape is not hypothetical
 * here: `./lobby` `claimChipLabel` builds `VISIBILITY · PUBLIC` from a noun and a
 * value at the moment it is shown.
 *
 * Every visible word in this game is a Pixi `Text` (there is no `BitmapText`
 * anywhere in `src/`), and Pixi 8 rasterises a `Text` by drawing it into a 2D
 * canvas. So the two 2D-context methods that see the words are patched before the
 * bundle loads, and the FINAL string is what they see — after every
 * concatenation, every `toUpperCase`, every `fitLabel`.
 *
 * ── THE TRAP, AND THE FIX ───────────────────────────────────────────────────
 * The first cut of this file recorded `fillText` alone and reported that the
 * whole doors screen contained 54 distinct "strings": `8`, `4`, `d`, `e`, `c`…
 * That is not a census, it is an alphabet. This game tracks its type (`TRACKING`,
 * `letterSpacing`), and a canvas 2D context cannot letter-space a string, so Pixi
 * falls back to drawing **one character per `fillText` call**. A hunt for the
 * word "claim" over that list would have come back empty on a screen that was
 * shouting it, which is exactly the false all-clear this brief was written
 * against.
 *
 * So each canvas is tagged, and consecutive single-character draws on the SAME
 * canvas are rejoined into the string they came from — Pixi rasterises one `Text`
 * into one canvas, so a run is a string. `measureText` is recorded beside it as
 * an independent second opinion: Pixi measures whole lines through it before it
 * draws them, so a string that survives letter-spacing appears there intact.
 * Both lists go in every readback, and the hunt is run over both.
 *
 * Its limits, stated because a gap you declare is evidence and a gap you omit is
 * a false all-clear:
 *
 *  - It only sees screens the capture REACHED. It is a census of this walk, not
 *    a proof about screens nobody opened.
 *  - It sees text, not pictures. A word baked into an image asset is invisible
 *    to it.
 *  - A rejoined run is a rasterisation, not necessarily one line: a wrapped
 *    two-line label rejoins as its lines run together. That can only ever make a
 *    string LONGER, so it cannot hide a word — and `measureText` holds the
 *    per-line form beside it either way.
 */
import type { Page } from '@playwright/test';

/** Arm the recorder. MUST be called before the first `goto` — it installs on a
 *  fresh document, ahead of the bundle. */
export async function recordWords(page: Page): Promise<void> {
  await page.addInitScript(() => {
    /** Rejoined `fillText` runs, in first-drawn order. */
    const drawn: string[] = [];
    /** Whole strings as Pixi measured them, before letter-spacing split them. */
    const measured: string[] = [];
    const w = window as unknown as { __drawnText?: string[]; __measuredText?: string[] };
    w.__drawnText = drawn;
    w.__measuredText = measured;

    // Tag every canvas so a run of draws can be attributed to one rasterisation.
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const idOf = (ctx: CanvasRenderingContext2D): number => {
      const key = (ctx.canvas ?? ctx) as unknown as object;
      let id = ids.get(key);
      if (id === undefined) {
        id = nextId++;
        ids.set(key, id);
      }
      return id;
    };

    const proto = CanvasRenderingContext2D.prototype;
    let runId = -1;
    let run = '';
    const flush = (): void => {
      if (run !== '') drawn.push(run);
      run = '';
      runId = -1;
    };

    // A rasterisation ends when the context is cleared for the next one. Pixi
    // clears (or resizes) the canvas before it draws each `Text`, so this is the
    // boundary between one string and the next — and it is the ONLY boundary
    // that works, because Pixi also calls `measureText` between individual
    // letters when it is tracking type, so ending a run there would put every
    // run back to one character (which is the bug this file's header describes).
    const originalClear = proto.clearRect;
    proto.clearRect = function patched(this: CanvasRenderingContext2D, ...args: number[]): void {
      flush();
      return originalClear.apply(this, args as [number, number, number, number]);
    };

    for (const name of ['fillText', 'strokeText'] as const) {
      const original = proto[name];
      proto[name] = function patched(this: CanvasRenderingContext2D, ...args: unknown[]): void {
        const text = args[0];
        if (typeof text === 'string' && text.length > 0) {
          const id = idOf(this);
          if (id !== runId) {
            flush();
            runId = id;
          }
          run += text;
        }
        return (original as (...a: unknown[]) => void).apply(this, args);
      } as (typeof proto)[typeof name];
    }

    const originalMeasure = proto.measureText;
    proto.measureText = function patched(this: CanvasRenderingContext2D, text: string): TextMetrics {
      if (typeof text === 'string' && text.length > 0) measured.push(text);
      return originalMeasure.call(this, text);
    };

    // Nothing flushes the final run on its own, so publish it on demand.
    (window as unknown as { __flushDrawnText?: () => void }).__flushDrawnText = flush;
  });
}

/** What the recorder holds: rejoined draw runs, and Pixi's own measurements. */
export interface WordCensus {
  readonly drawn: string[];
  readonly measured: string[];
}

/** Every distinct string seen since boot, in first-seen order. */
export async function drawnWords(page: Page): Promise<WordCensus> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __drawnText?: string[];
      __measuredText?: string[];
      __flushDrawnText?: () => void;
    };
    w.__flushDrawnText?.();
    return {
      drawn: [...new Set(w.__drawnText ?? [])],
      measured: [...new Set(w.__measuredText ?? [])],
    };
  });
}

/** The strings that contain `needle`, case-insensitively — the brief's hunt, run
 *  over what was drawn and over what was measured, because either list alone has
 *  a way to miss. */
export function hits(census: WordCensus, needle: string): string[] {
  const lower = needle.toLowerCase();
  const all = [...census.drawn, ...census.measured];
  return [...new Set(all.filter((s) => s.toLowerCase().includes(lower)))];
}

/**
 * The census with Pixi's own measurement noise taken out.
 *
 * Pixi word-wraps by measuring a line, then measuring it again without its first
 * character, and again, and again — so `measured` holds `SOLO`, `OLO`, `LO`, `O`
 * for one four-letter plate. Every one of those is a real `measureText` call and
 * none of them is a string the game says, so a reader handed the raw list cannot
 * see the screen for the shavings.
 *
 * Dropping any entry that is a proper SUFFIX of a longer one leaves the strings
 * the screen actually holds. It is a presentation filter and nothing more: the
 * raw lists go into every readback beside it, and a hunt for a word runs over the
 * raw lists ({@link hits}), never over this — because a filter that tidies is a
 * filter that can hide.
 */
export function fullStrings(census: WordCensus): string[] {
  const all = [...new Set([...census.drawn, ...census.measured])];
  const longestFirst = [...all].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const s of longestFirst) {
    if (!kept.some((k) => k !== s && k.endsWith(s))) kept.push(s);
  }
  return kept.sort((a, b) => a.localeCompare(b));
}
