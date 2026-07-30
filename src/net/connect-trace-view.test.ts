/**
 * src/net/connect-trace-view.test.ts — the panel, asserted without a browser.
 * OWNER: Netcode Engineer (M10, the developer's twice-repeated ask).
 *
 * Same discipline as `./playtest-log-button.test.ts`: the markup is pure, so the
 * wording, the ids, the touch minimum and — the one that matters — *which
 * affordances appear at which moment* are all testable in node. A fake DOM covers
 * the mounting half.
 */

import { describe, expect, it } from 'vitest';
import {
  CONNECT_TRACE_COPY_ID,
  CONNECT_TRACE_RETRY_ID,
  CONNECT_TRACE_ROOT_ID,
  CONNECT_TRACE_STEPS_ID,
  ConnectTraceView,
  renderConnectTraceHtml,
} from './connect-trace-view';
import type { TraceDom, TraceElement } from './connect-trace-view';
import {
  STALL_MS,
  beginConnect,
  connectDialing,
  connectRefused,
  connectTicketed,
  connectTraceModel,
} from './connect-trace';

const T0 = 1_700_000_000_000;
const MACHINE = '0800d5b6f1e208';

function dialingTrace(): ReturnType<typeof connectDialing> {
  let trace = beginConnect('create', T0);
  trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE, region: 'iad' }, T0 + 200);
  return connectDialing(trace, { machine: MACHINE, room: 'Q5RN' }, T0 + 250);
}

// --- A fake DOM, the same shape `./playtest-log-button.test.ts` uses ---------

function fakeElement(id = ''): TraceElement & { listeners: Record<string, (() => void)[]>; children: unknown[] } {
  return {
    id,
    innerHTML: '',
    hidden: false,
    listeners: {},
    children: [],
    addEventListener(type, handler): void {
      (this.listeners[type] ??= []).push(handler);
    },
    appendChild(child): void {
      this.children.push(child);
    },
    remove(): void {
      this.children.length = 0;
    },
  };
}

function fakeDom(): TraceDom & {
  root: ReturnType<typeof fakeElement>;
  byId: Map<string, ReturnType<typeof fakeElement>>;
  mounted: ReturnType<typeof fakeElement>;
} {
  const body = fakeElement('body');
  const byId = new Map<string, ReturnType<typeof fakeElement>>();
  const dom = {
    body,
    byId,
    root: body,
    mounted: body,
    createElement(): TraceElement {
      const el = fakeElement();
      dom.root = el;
      return el;
    },
    getElementById(id: string): TraceElement | null {
      // The buttons only "exist" once the panel's markup names them, which is what
      // makes "is RETRY on screen?" a real question rather than a stub's opinion.
      if (!dom.root.innerHTML.includes(`id="${id}"`)) return null;
      let el = byId.get(id);
      if (!el) {
        el = fakeElement(id);
        byId.set(id, el);
      }
      return el;
    },
  };
  return dom;
}

describe('renderConnectTraceHtml', () => {
  it('draws every step, marking the live one and dimming the done ones', () => {
    const html = renderConnectTraceHtml(connectTraceModel(dialingTrace(), T0 + 250));
    expect(html).toContain(`id="${CONNECT_TRACE_STEPS_ID}"`);
    expect(html).toContain('ALLOCATING ROOM');
    expect(html).toContain('ROOM Q5RN · TICKET SIGNED');
    expect(html).toContain('DIALING MACHINE 0800d5b6');
    expect(html).toContain('pr-ct-done'); // the two behind it
    expect(html).toContain('pr-ct-live'); // the one being waited on
    // Nothing has failed, so neither affordance is on the panel yet.
    expect(html).not.toContain(CONNECT_TRACE_RETRY_ID);
    expect(html).not.toContain(CONNECT_TRACE_COPY_ID);
  });

  it('puts RETRY and COPY LOG on the panel the moment a join is refused', () => {
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(refused, T0 + 300));
    expect(html).toContain('REFUSED: bad-ticket — machine mismatch');
    expect(html).toContain('pr-ct-bad'); // threat red, the one failure on the panel
    expect(html).toContain(`id="${CONNECT_TRACE_RETRY_ID}"`);
    expect(html).toContain('RETRY');
    expect(html).toContain(`id="${CONNECT_TRACE_COPY_ID}"`);
    expect(html).toContain('COPY LOG');
    expect(html).toContain('COPY LOG to report this.');
    // …and says the reason once, not twice: it is already the last step above.
    expect(html.match(/machine mismatch/g)).toHaveLength(1);
  });

  it('offers COPY LOG (and only COPY LOG) on a stall, with the seconds', () => {
    const html = renderConnectTraceHtml(connectTraceModel(dialingTrace(), T0 + 250 + STALL_MS));
    expect(html).toContain(`id="${CONNECT_TRACE_COPY_ID}"`);
    // The attempt is still live, so RETRY would race a socket that may yet open.
    expect(html).not.toContain(`id="${CONNECT_TRACE_RETRY_ID}"`);
    expect(html).toContain('5s');
    expect(html).toContain('Stuck on');
  });

  it('keeps a 44-px touch target on every button', () => {
    const html = renderConnectTraceHtml(
      connectTraceModel(connectRefused(dialingTrace(), 'room-full', T0 + 300), T0 + 300),
    );
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('escapes a reason the server chose the words for', () => {
    const nasty = connectRefused(dialingTrace(), '<script>x</script>', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(nasty, T0 + 300));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('ConnectTraceView', () => {
  it('mounts once, re-renders on change, and does nothing when nothing changed', () => {
    const dom = fakeDom();
    const view = new ConnectTraceView({ dom, onRetry: () => {}, onCopyLog: () => {} });
    view.update(dialingTrace(), T0 + 250);
    expect(dom.mounted.children).toHaveLength(1);
    expect(dom.root.id).toBe(CONNECT_TRACE_ROOT_ID);
    expect(view.visible).toBe(true);
    const first = view.html;

    // A frame later with nothing new: same markup, no DOM write.
    view.update(dialingTrace(), T0 + 260);
    expect(view.html).toBe(first);
    expect(dom.mounted.children).toHaveLength(1);

    // …until the stall crosses five seconds, which is a real change.
    view.update(dialingTrace(), T0 + 250 + STALL_MS);
    expect(view.html).not.toBe(first);
    expect(view.html).toContain('COPY LOG');
  });

  it('wires RETRY and COPY LOG to their handlers', () => {
    const dom = fakeDom();
    let retried = 0;
    let copied = 0;
    const view = new ConnectTraceView({
      dom,
      onRetry: () => retried++,
      onCopyLog: () => copied++,
    });
    view.update(connectRefused(dialingTrace(), 'bad-ticket', T0 + 300), T0 + 300);

    dom.byId.get(CONNECT_TRACE_RETRY_ID)?.listeners['click']?.forEach((fn) => fn());
    dom.byId.get(CONNECT_TRACE_COPY_ID)?.listeners['click']?.forEach((fn) => fn());
    expect(retried).toBe(1);
    expect(copied).toBe(1);
  });

  it('takes itself off screen when the attempt ends', () => {
    const dom = fakeDom();
    const view = new ConnectTraceView({ dom, onRetry: () => {}, onCopyLog: () => {} });
    view.update(dialingTrace(), T0 + 250);
    view.hide();
    expect(view.visible).toBe(false);
    expect(dom.root.hidden).toBe(true);
  });

  it('survives a page with no body to mount into', () => {
    const view = new ConnectTraceView({
      dom: { body: null, createElement: () => fakeElement(), getElementById: () => null },
      onRetry: () => {},
      onCopyLog: () => {},
    });
    expect(() => view.update(dialingTrace(), T0 + 250)).not.toThrow();
    expect(view.visible).toBe(false);
  });
});
