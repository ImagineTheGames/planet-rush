/**
 * src/net/playtest-log-button.test.ts — the COPY LOG affordance
 * (`./playtest-log-button`, M10 playtest-log brief §2, §3).
 *
 * The button is the whole feature from the developer's side: if its words are wrong,
 * or if a press looks like it did nothing, the log never gets pasted. So the wording
 * and the phases are asserted through the pure model, and the DOM half is driven with
 * a fake document — the same split (and the same reason) as
 * `@platform/boot-error`'s tests, since this repo has no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import {
  COPY_LOG_BUTTON_ID,
  COPY_LOG_HINT_ID,
  COPY_LOG_ROOT_ID,
  CopyLogAffordance,
  ERROR_OFFER_HINT,
  copyLogLabel,
  copyLogModel,
  disconnectOfferHint,
  hideCopyLog,
  installCopyLogButton,
  renderCopyLogHtml,
  resetCopyLogButton,
  showCopyLog,
} from './playtest-log-button';
import type { CopyLogDom, CopyLogElement } from './playtest-log-button';

afterEach(() => resetCopyLogButton());

function newLog(): PlaytestLog {
  const log = new PlaytestLog({ env: describeEnvironment({ sha: 'abc1234' }) });
  log.recordSessionStart();
  return log;
}

// ---------------------------------------------------------------------------
// A fake document, just enough to mount into
// ---------------------------------------------------------------------------

interface FakeElement extends CopyLogElement {
  readonly listeners: (() => void)[];
  readonly children: FakeElement[];
  removed: boolean;
}

function fakeDom(): CopyLogDom & { body: FakeElement; find: (id: string) => FakeElement | null } {
  const registry = new Map<string, FakeElement>();

  const make = (): FakeElement => {
    const el: FakeElement = {
      id: '',
      hidden: false,
      listeners: [],
      children: [],
      removed: false,
      get innerHTML(): string {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        // A write replaces the children: re-register the ids the markup declares, so
        // `getElementById` behaves like a browser's after an innerHTML write.
        for (const id of [COPY_LOG_BUTTON_ID, COPY_LOG_HINT_ID]) {
          registry.delete(id);
          if (value.includes(`id="${id}"`)) {
            const child = make();
            child.id = id;
            registry.set(id, child);
          }
        }
      },
      addEventListener: (_type, handler): void => void el.listeners.push(handler),
      appendChild: (child): void => {
        const c = child as FakeElement;
        el.children.push(c);
        if (c.id) registry.set(c.id, c);
      },
      remove: (): void => void (el.removed = true),
    };
    let html = '';
    return el;
  };

  const body = make();
  return {
    body,
    createElement: (): CopyLogElement => make(),
    getElementById: (id): CopyLogElement | null => registry.get(id) ?? null,
    find: (id): FakeElement | null => registry.get(id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe('the words on the button', () => {
  it('rests on COPY LOG — the label the brief names', () => {
    expect(copyLogLabel('idle')).toBe('COPY LOG');
  });

  it('answers a press, so it never looks dead', () => {
    expect(copyLogLabel('working')).toBe('COPYING…');
    // The share sheet is the phone's route out (M10 action-echo §5), and the
    // button says where the log actually went rather than claiming a clipboard it
    // never touched.
    expect(copyLogLabel('shared')).toBe('LOG SENT');
    expect(copyLogLabel('copied')).toBe('LOG COPIED');
    expect(copyLogLabel('saved')).toBe('LOG SAVED');
    expect(copyLogLabel('failed')).toBe('COPY FAILED');
  });

  it('offers the report on an error screen (the auto-offer, brief §3)', () => {
    expect(copyLogModel({ reason: 'error' }, 'idle').hint).toBe(ERROR_OFFER_HINT);
  });

  it('lets an error screen name its own failure instead', () => {
    const hint = "Couldn't reach the servers.";
    expect(copyLogModel({ reason: 'error', hint }, 'idle').hint).toBe(hint);
  });

  it('stays quiet on the pause menu — the label says enough there', () => {
    expect(copyLogModel({ reason: 'pause' }, 'idle').hint).toBe('');
  });

  it('tells the developer where the log went, including the download case', () => {
    expect(copyLogModel({ reason: 'pause' }, 'copied').hint).toContain('paste it into chat');
    expect(copyLogModel({ reason: 'pause' }, 'saved').hint).toContain('downloaded as a file');
    expect(copyLogModel({ reason: 'pause' }, 'shared').hint).toContain('share sheet');
    expect(copyLogModel({ reason: 'error' }, 'failed').hint).toContain('Could not copy');
  });

  it('names what happened before it asks for the log, on a drop', () => {
    expect(disconnectOfferHint('reconnecting')).toBe(`Reconnecting — ${ERROR_OFFER_HINT}`);
    expect(disconnectOfferHint('closed', 'grace-elapsed')).toBe(
      `Disconnected (grace-elapsed) — ${ERROR_OFFER_HINT}`,
    );
    // No reason to give (a plain drop) still reads as a sentence.
    expect(disconnectOfferHint('closed', null)).toBe(`Disconnected — ${ERROR_OFFER_HINT}`);
  });

  it('disables the button only while a press is in flight', () => {
    expect(copyLogModel({ reason: 'pause' }, 'working').busy).toBe(true);
    expect(copyLogModel({ reason: 'pause' }, 'idle').busy).toBe(false);
  });
});

describe('the markup', () => {
  it('carries the ids, a real touch target, and no reserved colour', () => {
    const html = renderCopyLogHtml(copyLogModel({ reason: 'error' }, 'idle'));

    expect(html).toContain(`id="${COPY_LOG_BUTTON_ID}"`);
    expect(html).toContain(`id="${COPY_LOG_HINT_ID}"`);
    expect(html).toContain('COPY LOG');
    // 44px minimum touch target (mobile amendment §1).
    expect(html).toContain('min-height:44px');
    // Signal yellow means ore or danger; threat red means damage (style-guide §2).
    // A diagnostic button is neither, so neither colour appears.
    expect(html.toUpperCase()).not.toContain('F2D24B');
    expect(html.toUpperCase()).not.toContain('B23A3A');
  });

  it('omits the hint element entirely when there is no hint', () => {
    const html = renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'idle'));
    expect(html).not.toContain(COPY_LOG_HINT_ID);
  });

  it('escapes a hint, which can carry a server’s own words', () => {
    const html = renderCopyLogHtml(
      copyLogModel({ reason: 'error', hint: '<script>alert("x")</script>' }, 'idle'),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks the button disabled while working', () => {
    expect(renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'working'))).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

describe('CopyLogAffordance', () => {
  it('mounts on the first show and hides rather than unmounting', () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });

    affordance.show({ reason: 'pause' });
    expect(dom.body.children).toHaveLength(1);
    expect(dom.body.children[0]!.id).toBe(COPY_LOG_ROOT_ID);
    expect(dom.body.children[0]!.hidden).toBe(false);

    affordance.hide();
    expect(dom.body.children[0]!.hidden).toBe(true);
    expect(dom.body.children[0]!.removed).toBe(false);
    expect(affordance.visible).toBe(false);

    // Re-showing reuses the same element: the screens it serves come and go often.
    affordance.show({ reason: 'pause' });
    expect(dom.body.children).toHaveLength(1);
  });

  it('is a no-op on a repeat of the same offer, so a per-frame caller is free', () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });
    affordance.show({ reason: 'pause' });
    const button = dom.find(COPY_LOG_BUTTON_ID)!;

    for (let i = 0; i < 100; i++) affordance.show({ reason: 'pause' });
    // The element was not rewritten, so no listener piled up on it.
    expect(dom.find(COPY_LOG_BUTTON_ID)).toBe(button);
    expect(button.listeners).toHaveLength(1);
  });

  it('copies the log when the button is pressed', async () => {
    const dom = fakeDom();
    const log = newLog();
    const writeText = vi.fn(async (_text: string) => {});
    const affordance = new CopyLogAffordance({
      dom,
      log,
      schedule: null,
      exportOptions: { clipboard: { writeText }, save: null },
    });

    affordance.show({ reason: 'error', hint: "Couldn't reach the servers." });
    const result = await affordance.copy();

    expect(result.ok && result.route).toBe('clipboard');
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
      schema: 'planet-rush.playtest-log',
    });
    expect(affordance.state).toBe('copied');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG COPIED');
  });

  it('reports the download fallback in its own words', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: null, save: () => {} },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('saved');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG SAVED');
  });

  it('says COPY FAILED rather than pretending', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: null, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('failed');
    expect(dom.body.children[0]!.innerHTML).toContain('COPY FAILED');
  });

  it('collapses a doubled press into one export', async () => {
    const dom = fakeDom();
    let writes = 0;
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: { writeText: async () => void writes++ }, save: null },
    });
    affordance.show({ reason: 'pause' });

    const [first, second] = await Promise.all([affordance.copy(), affordance.copy()]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(writes).toBe(1);
  });

  it('reverts to COPY LOG once the answer has been read', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('copied');
    pending.forEach((fn) => fn());
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('COPY LOG');
  });

  it('does not let a stale revert wipe a newer press’s answer', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    await affordance.copy(); // a second press before the first timer fires
    pending[0]!(); // the FIRST press's revert, now stale
    expect(affordance.state).toBe('copied');
  });

  it('drops a previous answer when a new screen makes a new offer', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });
    await affordance.copy();
    expect(affordance.state).toBe('copied');

    affordance.show({ reason: 'error', hint: 'Lost the match server.' });
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('Lost the match server.');
  });

  it('survives a page with no body to mount into', () => {
    const dom: CopyLogDom = {
      body: null,
      createElement: fakeDom().createElement,
      getElementById: () => null,
    };
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });
    expect(() => affordance.show({ reason: 'pause' })).not.toThrow();
  });
});

describe('the shared affordance', () => {
  it('does nothing where none was installed — a caller needs no null check', () => {
    expect(() => showCopyLog({ reason: 'pause' })).not.toThrow();
    expect(() => hideCopyLog()).not.toThrow();
  });

  it('routes show/hide to the installed one', () => {
    const dom = fakeDom();
    const affordance = installCopyLogButton({ dom, log: newLog(), schedule: null });

    showCopyLog({ reason: 'error' });
    expect(affordance.visible).toBe(true);
    hideCopyLog();
    expect(affordance.visible).toBe(false);
  });

  it('tears the old element down when a new affordance is installed', () => {
    const dom = fakeDom();
    const first = installCopyLogButton({ dom, log: newLog(), schedule: null });
    first.show({ reason: 'pause' });
    installCopyLogButton({ dom, log: newLog(), schedule: null });
    expect(dom.body.children[0]!.removed).toBe(true);
  });
});
