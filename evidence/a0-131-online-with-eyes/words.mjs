/**
 * evidence/a0-131-online-with-eyes/words.mjs — every string the bundle
 * RASTERISED, caught just before it became pixels. OWNER: QA Manager (a0-131).
 *
 * Lifted from `evidence/a0-111-yesterday-with-eyes/words.ts`, unchanged in
 * substance, because a0-111 already paid for the trap: this game letter-spaces
 * its type and a canvas 2D context cannot, so Pixi draws ONE CHARACTER PER
 * `fillText` CALL. A naive recorder returns an alphabet, and a hunt for "claim"
 * over an alphabet comes back clean on a screen that is shouting the word. So
 * every canvas is tagged and consecutive single-character draws on the same
 * canvas are rejoined; `measureText` is kept beside it as a second opinion,
 * because Pixi measures whole lines through it before splitting them.
 *
 * It is a census of the walk this capture actually took, not a proof about
 * screens nobody opened, and it sees text rather than pictures. Both limits are
 * repeated in the attestation.
 */
export async function recordWords(page) {
  await page.addInitScript(() => {
    const drawn = [];
    const measured = [];
    window.__drawnText = drawn;
    window.__measuredText = measured;
    const ids = new WeakMap();
    let nextId = 0;
    const idOf = (ctx) => {
      const key = ctx.canvas ?? ctx;
      let id = ids.get(key);
      if (id === undefined) { id = nextId++; ids.set(key, id); }
      return id;
    };
    const proto = CanvasRenderingContext2D.prototype;
    let runId = -1;
    let run = '';
    const flush = () => { if (run !== '') drawn.push(run); run = ''; runId = -1; };
    const originalClear = proto.clearRect;
    proto.clearRect = function patched(...args) { flush(); return originalClear.apply(this, args); };
    for (const name of ['fillText', 'strokeText']) {
      const original = proto[name];
      proto[name] = function patched(...args) {
        const text = args[0];
        if (typeof text === 'string' && text.length > 0) {
          const id = idOf(this);
          if (id !== runId) { flush(); runId = id; }
          run += text;
        }
        return original.apply(this, args);
      };
    }
    const originalMeasure = proto.measureText;
    proto.measureText = function patched(text) {
      if (typeof text === 'string' && text.length > 0) measured.push(text);
      return originalMeasure.call(this, text);
    };
  });
}

/** Everything rasterised since the last call, both lists, de-duplicated. */
export async function takeWords(page) {
  return page.evaluate(() => {
    const drawn = window.__drawnText ?? [];
    const measured = window.__measuredText ?? [];
    const out = { drawn: [...new Set(drawn)], measured: [...new Set(measured)] };
    drawn.length = 0;
    measured.length = 0;
    return out;
  });
}

/** The hunt. Case-insensitive, over BOTH lists. */
export function hunt(words, needle) {
  const n = needle.toLowerCase();
  return {
    drawn: words.drawn.filter((s) => s.toLowerCase().includes(n)),
    measured: words.measured.filter((s) => s.toLowerCase().includes(n)),
  };
}
