/**
 * Boot-error screen tests (boot-error.ts).
 *
 * These assert the promise the module exists to keep: **no black screens, no
 * cryptic-only errors.** So the assertions are about what a *player* gets — plain
 * words, things to try, the build sha, a Retry button that visibly responds — not
 * about implementation shape. The wording is data (`describeBootFailure`) and the
 * markup is a pure string (`renderBootErrorHtml`), so all of it tests headless;
 * the real-browser path is covered by the `--disable-webgl` scenario in
 * `tests/live/boot.spec.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  describeBootFailure,
  describeError,
  renderBootErrorHtml,
  renderInlineCode,
  escapeHtml,
  showBootError,
  retryStatusMessage,
  NO_WEBGL_HEADLINE,
  BOOT_ERROR_ID,
  BOOT_ERROR_RETRY_ID,
  BOOT_ERROR_STATUS_ID,
  BOOT_ERROR_MOUNT_ID,
  type BootErrorDom,
  type BootErrorElement,
} from './boot-error';
import { WebGlUnavailableError, type GlProbeFail } from './gl-probe';

const BUILD = 'a1b2c3d · 09:07Z';

/** The exact failure from the incident: every context id returned null. */
const NO_CONTEXT: GlProbeFail = {
  ok: false,
  failure: 'no-context',
  detail: 'webgl2: null; webgl: null; experimental-webgl: null',
};

/** The cryptic message that was the *only* artefact of the original failure. */
const PIXI_CRYPTIC = 'autoDetectRenderer: CanvasRenderer is not yet implemented';

// --- A three-field fake DOM. There is no jsdom in this repo (and adding one to
// --- test an innerHTML write would be a poor trade), so the module's DOM edge is
// --- typed as the smallest slice it needs and faked here.
class FakeElement implements BootErrorElement {
  innerHTML = '';
  textContent: string | null = null;
  readonly listeners: Record<string, (() => void)[]> = {};
  addEventListener(type: string, handler: () => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners['click'] ?? []) h();
  }
}

class FakeDom implements BootErrorDom {
  readonly elements = new Map<string, FakeElement>();
  body: FakeElement | null = new FakeElement();
  constructor(ids: readonly string[] = [BOOT_ERROR_MOUNT_ID]) {
    for (const id of ids) this.elements.set(id, new FakeElement());
  }
  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }
  /** Stand in for the browser parsing the written markup: after innerHTML is set,
   *  the button and status elements exist. */
  parse(): void {
    for (const id of [BOOT_ERROR_RETRY_ID, BOOT_ERROR_STATUS_ID]) {
      if (!this.elements.has(id)) this.elements.set(id, new FakeElement());
    }
  }
}

describe('describeBootFailure — no WebGL (the incident)', () => {
  const content = describeBootFailure(new WebGlUnavailableError(NO_CONTEXT), BUILD);

  it('says what happened in plain words, in the brief\'s own sentence', () => {
    expect(content.kind).toBe('no-webgl');
    expect(content.headline).toBe(NO_WEBGL_HEADLINE);
    expect(content.headline).toContain('WebGL');
  });

  it('absolves the hardware — the RTX 4090 was never the problem', () => {
    expect(content.plain).toMatch(/browser problem/i);
    expect(content.plain).toMatch(/not a problem with your computer/i);
  });

  it('lists the three fixes that actually work, restart first', () => {
    const fixes = content.fixes.join('\n');
    expect(content.fixes[0]).toMatch(/quit the browser/i); // the one that usually works
    expect(fixes).toContain('chrome://gpu');
    expect(fixes).toMatch(/different browser/i);
  });

  it('keeps the raw probe transcript — cryptic below plain words, never instead', () => {
    expect(content.detail).toContain('webgl2: null');
    expect(content.detail).toContain('WebGL unavailable');
  });

  it('carries the build stamp, so a screenshot is a filable bug report', () => {
    expect(content.build).toBe(BUILD);
  });
});

describe('describeBootFailure — any other init failure', () => {
  it('shows the cryptic renderer error as the payload, under a plain headline', () => {
    const content = describeBootFailure(new Error(PIXI_CRYPTIC), BUILD);
    expect(content.kind).toBe('init-failed');
    expect(content.headline).toBe('Planet Rush could not start');
    expect(content.detail).toContain(PIXI_CRYPTIC);
    expect(content.plain).not.toContain(PIXI_CRYPTIC); // the plain part stays plain
  });

  it('offers Retry/reload first — a one-off start-up error often does not repeat', () => {
    const content = describeBootFailure(new Error('boom'), BUILD);
    expect(content.fixes[0]).toMatch(/retry|reload/i);
  });

  it('handles being thrown something that is not an Error at all', () => {
    for (const thrown of ['just a string', 42, null, undefined, { code: 'E_ODD' }, () => 0]) {
      const content = describeBootFailure(thrown, BUILD);
      expect(content.kind).toBe('init-failed');
      expect(content.detail.length).toBeGreaterThan(0); // never an empty detail box
    }
  });

  it('defaults the build stamp to the live badge rather than printing nothing', () => {
    expect(describeBootFailure(new Error('boom')).build).not.toBe('');
  });
});

describe('describeError', () => {
  it('prefers the stack (the useful half of a bug report)', () => {
    const err = new Error('kaboom');
    expect(describeError(err)).toContain('kaboom');
  });

  it('falls back to name: message when there is no stack', () => {
    const err = new Error('kaboom');
    delete err.stack; // some engines/minifiers give you a stackless Error
    expect(describeError(err)).toBe('Error: kaboom');
  });

  it('describes a cyclic object instead of throwing on it', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => describeError(cyclic)).not.toThrow();
    expect(describeError(cyclic).length).toBeGreaterThan(0);
  });

  it('names the nothing-was-thrown case rather than printing "undefined"', () => {
    expect(describeError(undefined)).toMatch(/unknown error/i);
  });
});

describe('renderBootErrorHtml — what is actually on screen', () => {
  const content = describeBootFailure(new WebGlUnavailableError(NO_CONTEXT), BUILD);
  const html = renderBootErrorHtml(content);

  it('is findable by id and labels itself as an alert', () => {
    expect(html).toContain(`id="${BOOT_ERROR_ID}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-kind="no-webgl"');
  });

  it('carries the headline, the plain paragraph, every fix, and the error text', () => {
    expect(html).toContain(escapeHtml(content.headline));
    expect(html).toContain(escapeHtml(content.plain));
    for (const fix of content.fixes) expect(html).toContain(`<li>${renderInlineCode(escapeHtml(fix))}</li>`);
    expect(html).toContain('webgl2: null');
  });

  it('carries the build sha and the Retry button', () => {
    expect(html).toContain(BUILD.replace(/·/, '·'));
    expect(html).toContain(`id="${BOOT_ERROR_RETRY_ID}"`);
    expect(html).toContain('>Retry<');
  });

  it('paints in the Cold Vacuum palette and never uses RESERVED signal yellow', () => {
    expect(html).toContain('#0D1015'); // Vacuum background (style-guide §1)
    expect(html).toContain('#B23A3A'); // Threat red — this screen IS an alarm (§2)
    expect(html).toContain('#4DC3FF'); // Plasma on the one action
    // Signal yellow means ore or danger and nothing else (style-guide §2).
    expect(html).not.toContain('#F2D24B');
  });

  it('ships its own stylesheet inline — a CSS request could fail too', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('position:fixed');
  });

  it('renders chrome://gpu as selectable code, not as a (blocked) link', () => {
    expect(html).toContain('<code>chrome://gpu</code>');
    expect(html).not.toContain('href="chrome://gpu"');
  });

  it('escapes the error text — an error message can contain anything', () => {
    const nasty = renderBootErrorHtml(describeBootFailure(new Error('<img src=x onerror=alert(1)>'), BUILD));
    expect(nasty).not.toContain('<img');
    expect(nasty).toContain('&lt;img');
  });
});

describe('renderInlineCode / escapeHtml', () => {
  it('turns backticked spans into code after escaping', () => {
    expect(renderInlineCode(escapeHtml('open `chrome://gpu` now'))).toBe('open <code>chrome://gpu</code> now');
  });

  it('cannot be used to smuggle markup, because escaping runs first', () => {
    expect(renderInlineCode(escapeHtml('`<b>x</b>`'))).toBe('<code>&lt;b&gt;x&lt;/b&gt;</code>');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('showBootError — the DOM edge', () => {
  it('replaces the app root, so no dead canvas sits under the message', () => {
    const dom = new FakeDom();
    const host = dom.getElementById(BOOT_ERROR_MOUNT_ID)!;
    host.innerHTML = '<canvas></canvas>';

    const mounted = showBootError({
      dom,
      content: describeBootFailure(new WebGlUnavailableError(NO_CONTEXT), BUILD),
      onRetry: () => false,
    });

    expect(mounted).toBe(true);
    expect(host.innerHTML).not.toContain('<canvas>');
    expect(host.innerHTML).toContain(`id="${BOOT_ERROR_ID}"`);
  });

  it('falls back to <body> when there is no app root', () => {
    const dom = new FakeDom([]); // no #app
    expect(showBootError({ dom, content: describeBootFailure(new Error('x'), BUILD), onRetry: () => false })).toBe(
      true,
    );
    expect(dom.body?.innerHTML).toContain(BOOT_ERROR_ID);
  });

  it('reports failure only when there is nowhere at all to draw', () => {
    const dom = new FakeDom([]);
    dom.body = null;
    expect(showBootError({ dom, content: describeBootFailure(new Error('x'), BUILD), onRetry: () => false })).toBe(
      false,
    );
  });

  it('wires Retry to the handler', () => {
    const dom = new FakeDom();
    dom.parse();
    const onRetry = vi.fn(() => true);
    showBootError({ dom, content: describeBootFailure(new Error('x'), BUILD), onRetry });

    dom.getElementById(BOOT_ERROR_RETRY_ID)!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Recovered: the caller is reloading, so the screen says nothing further.
    expect(dom.getElementById(BOOT_ERROR_STATUS_ID)!.textContent).toBeNull();
  });

  it('answers a retry that changed nothing — never a button that looks dead', () => {
    const dom = new FakeDom();
    dom.parse();
    showBootError({
      dom,
      content: describeBootFailure(new WebGlUnavailableError(NO_CONTEXT), BUILD),
      onRetry: () => false,
    });

    const button = dom.getElementById(BOOT_ERROR_RETRY_ID)!;
    const status = dom.getElementById(BOOT_ERROR_STATUS_ID)!;

    button.click();
    expect(status.textContent).toContain('1 check');
    button.click();
    expect(status.textContent).toContain('2 checks');
    expect(status.textContent).toMatch(/quit the browser/i);
  });

  it('treats a throwing retry as a failed retry, not a crash', () => {
    const dom = new FakeDom();
    dom.parse();
    showBootError({
      dom,
      content: describeBootFailure(new Error('x'), BUILD),
      onRetry: () => {
        throw new Error('retry itself broke');
      },
    });

    expect(() => dom.getElementById(BOOT_ERROR_RETRY_ID)!.click()).not.toThrow();
    expect(dom.getElementById(BOOT_ERROR_STATUS_ID)!.textContent).toContain('Still failing');
  });

  it('mounts even if the parsed markup yields no button (nothing to wire)', () => {
    const dom = new FakeDom(); // parse() not called → no #boot-error-retry
    expect(
      showBootError({ dom, content: describeBootFailure(new Error('x'), BUILD), onRetry: () => false }),
    ).toBe(true);
  });
});

describe('retryStatusMessage', () => {
  it('counts checks in words a human reads, singular and plural', () => {
    expect(retryStatusMessage('no-webgl', 1)).toContain('1 check');
    expect(retryStatusMessage('no-webgl', 3)).toContain('3 checks');
  });

  it('points at the fix that works instead of inviting more tapping', () => {
    expect(retryStatusMessage('no-webgl', 1)).toMatch(/quit the browser completely/i);
  });
});
