/**
 * WebGL probe tests (gl-probe.ts).
 *
 * The failure being pinned down: Chrome's GPU process wedged on an RTX 4090 box,
 * WebGL vanished, and the game died to a black screen with only
 * `autoDetectRenderer: CanvasRenderer is not yet implemented` in the console. The
 * probe is what turns that into a decision we make *before* Pixi is touched, so
 * these tests walk the whole decision table — context available (each flavour),
 * every id returning null, `getContext` throwing, `createElement` throwing, and no
 * document at all — and assert the one property that matters most: the probe never
 * throws, because a probe that can crash boot is worse than no probe.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  probeWebGl,
  requireWebGl,
  isWebGlUnavailable,
  releaseProbeContext,
  apiForContextId,
  WebGlUnavailableError,
  GL_CONTEXT_IDS,
  PROBE_CONTEXT_ATTRIBUTES,
  type CanvasLike,
} from './gl-probe';

/** A fake canvas that answers only the listed context ids. */
function canvasWith(...supported: readonly string[]): CanvasLike {
  return { getContext: (id: string) => (supported.includes(id) ? { id } : null) };
}

/** A fake canvas whose `getContext` throws — some hardened browsers do this. */
function canvasThrowing(message: string): CanvasLike {
  return {
    getContext: () => {
      throw new Error(message);
    },
  };
}

describe('probeWebGl — is there a GPU to draw on', () => {
  it('reports webgl2 when the browser has it (the normal path)', () => {
    const result = probeWebGl({ createCanvas: () => canvasWith('webgl2', 'webgl') });
    expect(result).toEqual({ ok: true, api: 'webgl2' });
  });

  it('falls back to webgl1 when webgl2 is missing — Pixi runs on either', () => {
    const result = probeWebGl({ createCanvas: () => canvasWith('webgl') });
    expect(result).toEqual({ ok: true, api: 'webgl' });
  });

  it('accepts the ancient experimental-webgl alias (old mobile browsers)', () => {
    const result = probeWebGl({ createCanvas: () => canvasWith('experimental-webgl') });
    expect(result).toEqual({ ok: true, api: 'webgl' });
  });

  it('asks in best-first order and stops at the first hit', () => {
    const getContext = vi.fn((id: string) => (id === 'webgl' ? { id } : null));
    const result = probeWebGl({ createCanvas: () => ({ getContext }) });

    expect(result.ok).toBe(true);
    expect(getContext.mock.calls.map((c) => c[0])).toEqual(['webgl2', 'webgl']);
  });

  it('does NOT reject software rendering — slow is playable, black is not', () => {
    const getContext = vi.fn((_id: string, attrs: unknown) => ({ attrs }));
    probeWebGl({ createCanvas: () => ({ getContext }) });

    // failIfMajorPerformanceCaveat:false is the load-bearing attribute here: a
    // SwiftShader/llvmpipe context still draws the game (GDD §4.3b risk 5).
    expect(getContext).toHaveBeenCalledWith('webgl2', PROBE_CONTEXT_ATTRIBUTES);
    expect(PROBE_CONTEXT_ATTRIBUTES.failIfMajorPerformanceCaveat).toBe(false);
  });

  it('releases the probe context immediately (contexts are scarce on mobile)', () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null));
    const result = probeWebGl({ createCanvas: () => ({ getContext: () => ({ getExtension }) }) });

    expect(result.ok).toBe(true);
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('survives a browser that will not release the context', () => {
    const ctx = {
      getExtension: () => {
        throw new Error('nope');
      },
    };
    expect(() => releaseProbeContext(ctx)).not.toThrow();
    expect(probeWebGl({ createCanvas: () => ({ getContext: () => ctx }) }).ok).toBe(true);
  });

  it('reports no-context when every id returns null — THE INCIDENT', () => {
    const result = probeWebGl({ createCanvas: () => canvasWith() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('no-context');
    // The transcript names every id it asked for, so the report says what was tried.
    for (const id of GL_CONTEXT_IDS) expect(result.detail).toContain(id);
  });

  it('reports threw (not no-context) when getContext throws on every id', () => {
    const result = probeWebGl({ createCanvas: () => canvasThrowing('WebGL is disabled') });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('threw');
    expect(result.detail).toContain('WebGL is disabled');
  });

  it('reports threw when creating the canvas itself throws', () => {
    const result = probeWebGl({
      createCanvas: () => {
        throw new Error('document is hostile');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('threw');
    expect(result.detail).toContain('document is hostile');
  });

  it('reports no-canvas where there is no document (node, harness, server)', () => {
    const result = probeWebGl({ createCanvas: () => null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('no-canvas');
    expect(result.detail).toContain('no document');
  });

  it('never throws, whatever the browser does', () => {
    const hostile: CanvasLike = {
      getContext: () => {
        throw 'a string, not an Error';
      },
    };
    expect(() => probeWebGl({ createCanvas: () => hostile })).not.toThrow();
    // …and the non-Error throw still produces readable detail.
    const result = probeWebGl({ createCanvas: () => hostile });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('a string, not an Error');
  });

  it('runs in this node process without a document and says so', () => {
    // No injected factory: the default path must degrade, not explode.
    const result = probeWebGl();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('no-canvas');
  });
});

describe('apiForContextId', () => {
  it('maps webgl2 to webgl2 and both legacy ids to webgl', () => {
    expect(apiForContextId('webgl2')).toBe('webgl2');
    expect(apiForContextId('webgl')).toBe('webgl');
    expect(apiForContextId('experimental-webgl')).toBe('webgl');
  });
});

describe('requireWebGl — the form boot() uses', () => {
  it('returns the result when WebGL is there', () => {
    expect(requireWebGl({ createCanvas: () => canvasWith('webgl2') })).toEqual({ ok: true, api: 'webgl2' });
  });

  it('throws WebGlUnavailableError carrying the probe transcript', () => {
    let thrown: unknown;
    try {
      requireWebGl({ createCanvas: () => canvasWith() });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(WebGlUnavailableError);
    expect(isWebGlUnavailable(thrown)).toBe(true);
    const err = thrown as WebGlUnavailableError;
    expect(err.probe.failure).toBe('no-context');
    expect(err.message).toContain('WebGL unavailable');
    // Named, so the message is grep-able in a bug report and identifiable after
    // bundling (two module copies, one class identity each).
    expect(err.name).toBe('WebGlUnavailableError');
  });
});

describe('isWebGlUnavailable', () => {
  it('recognises the error by name too, so bundling cannot break the check', () => {
    const clone = new Error('WebGL unavailable (no-context) — webgl2: null');
    clone.name = 'WebGlUnavailableError';
    expect(isWebGlUnavailable(clone)).toBe(true);
  });

  it('does not claim unrelated failures', () => {
    expect(isWebGlUnavailable(new Error('boom'))).toBe(false);
    expect(isWebGlUnavailable('boom')).toBe(false);
    expect(isWebGlUnavailable(null)).toBe(false);
    expect(isWebGlUnavailable(undefined)).toBe(false);
  });
});
