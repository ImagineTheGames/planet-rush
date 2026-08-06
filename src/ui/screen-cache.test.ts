/**
 * src/ui/screen-cache.test.ts — the cache's state machine. OWNER: UI Engineer (u7-01).
 *
 * Headless, like the rest of `src/ui/`: {@link ScreenCache} only ever calls three
 * methods on its target, so a recorder stands in for the PixiJS `Container` and
 * the ordering rules become assertable without a canvas.
 *
 * The rules worth holding, all three of which are ways this has gone wrong:
 *
 *  1. **Enable once, refresh after.** `cacheAsTexture` performs the render
 *     itself; calling it again per state change would churn a new render target
 *     per pointer event instead of updating the one that exists.
 *  2. **An unchanged screen redraws nothing.** The in-match settings screen's
 *     `update()` is called every rendered frame (`syncPause()`), so "unchanged"
 *     has to be the cheap path or the cache is worse than no cache.
 *  3. **A resize drops the texture.** It was rasterised at the old bounds, so
 *     refreshing it in place would blit a stale-sized screen.
 */
import { describe, expect, it } from 'vitest';
import { ScreenCache } from './screen-cache';

/** Records what the cache asks of its container. */
function recorder(): {
  calls: string[];
  target: { cacheAsTexture(v: unknown): void; updateCacheTexture(): void };
} {
  const calls: string[] = [];
  return {
    calls,
    target: {
      cacheAsTexture(v: unknown): void {
        calls.push(v === false ? 'off' : 'on');
      },
      updateCacheTexture(): void {
        calls.push('update');
      },
    },
  };
}

// The cast keeps the test headless: ScreenCache touches exactly these members.
const make = (): ReturnType<typeof recorder> & { cache: ScreenCache } => {
  const r = recorder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...r, cache: new ScreenCache(r.target as any) };
};

describe('ScreenCache', () => {
  it('turns caching on once, then refreshes the texture in place', () => {
    const { cache, calls } = make();
    cache.refresh('a');
    cache.refresh('b');
    cache.refresh('c');
    expect(calls).toEqual(['on', 'update', 'update']);
  });

  it('reports an unchanged screen so the caller can skip its redraw entirely', () => {
    const { cache } = make();
    // Nothing has been rasterised yet, so nothing can be unchanged — the first
    // draw must always happen.
    expect(cache.unchanged('a')).toBe(false);
    cache.refresh('a');
    expect(cache.unchanged('a')).toBe(true);
    expect(cache.unchanged('b')).toBe(false);
  });

  it('drops the texture on invalidate, and rebuilds rather than updating after', () => {
    const { cache, calls } = make();
    cache.refresh('a');
    cache.invalidate();
    cache.refresh('a');
    // 'on' again, NOT 'update': the old texture is gone, so there is nothing to
    // update in place.
    expect(calls).toEqual(['on', 'off', 'on']);
  });

  it('forgets its signature on invalidate, so a resize redraws identical content', () => {
    const { cache } = make();
    cache.refresh('a');
    cache.invalidate();
    // Same model, new viewport: the content signature matches but the texture
    // was rasterised at the old bounds, so this must NOT be reported unchanged.
    expect(cache.unchanged('a')).toBe(false);
  });

  it('is inert when invalidated before anything was cached', () => {
    const { cache, calls } = make();
    cache.invalidate();
    expect(calls).toEqual([]);
  });
});
