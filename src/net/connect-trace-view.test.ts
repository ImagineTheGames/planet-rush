/**
 * src/net/connect-trace-view.test.ts — RETRY and DOWNLOAD LOG, asserted without a
 * browser. OWNER: Netcode Engineer (M10, the developer's ask, third pass).
 *
 * Same discipline as `./playtest-log-button.test.ts`: the markup is pure, so the
 * wording, the ids, the touch minimum and — the one that matters — *which
 * affordances appear at which moment* are all testable in node. A fake DOM covers
 * the mounting half.
 *
 * The load-bearing assertion in here is now a negative one: on a healthy connect
 * this module renders **nothing**. The story is the screen's title
 * (`./connect-trace` `connectTitleLine`), and the second surface that used to
 * repeat it at the foot of the screen is gone.
 */

import { describe, expect, it } from 'vitest';
import {
  CONNECT_TRACE_DOWNLOAD_ID,
  CONNECT_TRACE_RETRY_ID,
  CONNECT_TRACE_ROOT_ID,
  CONNECT_TRACE_TOP_PX,
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
  it('draws NOTHING while a connect is simply working', () => {
    // The developer's whole complaint, as an assertion: no second surface. The
    // steps are the title's now, and a connect that is going fine has no
    // affordance to offer, so it has no markup either.
    const html = renderConnectTraceHtml(connectTraceModel(dialingTrace(), T0 + 250));
    expect(html).toBe('');
  });

  it('never repeats the story the title is telling', () => {
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(refused, T0 + 300));
    // Not one step line — not the refusal, not the two successes behind it.
    expect(html).not.toContain('ALLOCATING ROOM');
    expect(html).not.toContain('TICKET SIGNED');
    expect(html).not.toContain('DIALING MACHINE');
    expect(html).not.toContain('machine mismatch');
  });

  it('puts RETRY and DOWNLOAD LOG under the title the moment a join is refused', () => {
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(refused, T0 + 300));
    expect(html).toContain(`id="${CONNECT_TRACE_RETRY_ID}"`);
    expect(html).toContain('RETRY');
    expect(html).toContain(`id="${CONNECT_TRACE_DOWNLOAD_ID}"`);
    expect(html).toContain('DOWNLOAD LOG');
    expect(html).toContain('DOWNLOAD LOG to report this.');
  });

  it('offers exactly two buttons on a refusal — the log control has no sibling', () => {
    // Ratified M10: one log affordance, and it saves a file. A refused join is
    // where a phone report starts, and the developer's "too large for mobile
    // clipboard" is about exactly the paste that is no longer on offer here.
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(refused, T0 + 300));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.toUpperCase()).not.toContain('CLIPBOARD');
  });

  it('sits at the top of the screen, below the title — never at the foot of it', () => {
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(refused, T0 + 300));
    expect(html).toContain(`top:calc(${CONNECT_TRACE_TOP_PX}px`);
    expect(html).not.toContain('bottom:');
    // Only the buttons take taps: on the shortest phone these two float over the
    // top of the door stack, and PLAY SOLO has to stay pressable (GDD §4.8 risk 6).
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('pointer-events:auto');
  });

  it('offers the log button (and no RETRY) on a stall', () => {
    const html = renderConnectTraceHtml(connectTraceModel(dialingTrace(), T0 + 250 + STALL_MS));
    // A stalled dial on a phone is precisely the report the clipboard route could
    // not carry, so the offer that rides the stall is the file one.
    expect(html).toContain(`id="${CONNECT_TRACE_DOWNLOAD_ID}"`);
    expect(html).toContain('DOWNLOAD LOG');
    // The attempt is still live, so RETRY would race a socket that may yet open.
    expect(html).not.toContain(`id="${CONNECT_TRACE_RETRY_ID}"`);
    // The seconds are the title's tail (`connectTitleLine`), not a line down here.
    expect(html).not.toContain('5s');
  });

  it('keeps a 44-px touch target on every button', () => {
    const html = renderConnectTraceHtml(
      connectTraceModel(connectRefused(dialingTrace(), 'room-full', T0 + 300), T0 + 300),
    );
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('escapes the one line it still writes', () => {
    // The hint is fixed copy today, but it goes through `escapeHtml` because the
    // day it names a server-chosen token is the day nobody re-reads this file.
    const nasty = connectRefused(dialingTrace(), '<script>x</script>', T0 + 300);
    const html = renderConnectTraceHtml(connectTraceModel(nasty, T0 + 300));
    expect(html).not.toContain('<script>');
  });
});

describe('ConnectTraceView', () => {
  it('stays off the screen entirely while the connect is working', () => {
    const dom = fakeDom();
    const view = new ConnectTraceView({ dom, onRetry: () => {}, onDownloadLog: () => {} });

    // Four hundred milliseconds into a perfectly ordinary dial: nothing mounts, so
    // there is no second surface to disagree with the title — not even an empty one.
    view.update(dialingTrace(), T0 + 250);
    expect(view.visible).toBe(false);
    expect(dom.mounted.children).toHaveLength(0);

    // …until the stall crosses five seconds, which is the first thing worth saying.
    view.update(dialingTrace(), T0 + 250 + STALL_MS);
    expect(view.visible).toBe(true);
    expect(dom.mounted.children).toHaveLength(1);
    expect(dom.root.id).toBe(CONNECT_TRACE_ROOT_ID);
    const first = view.html;
    expect(first).toContain('DOWNLOAD LOG');

    // A frame later with nothing new: same markup, no second mount.
    view.update(dialingTrace(), T0 + 260 + STALL_MS);
    expect(view.html).toBe(first);
    expect(dom.mounted.children).toHaveLength(1);
  });

  it('withdraws again if the attempt gets moving after a stall', () => {
    const dom = fakeDom();
    const view = new ConnectTraceView({ dom, onRetry: () => {}, onDownloadLog: () => {} });
    view.update(dialingTrace(), T0 + 250 + STALL_MS);
    expect(view.visible).toBe(true);
    // The socket finally opened and the story moved on — the offer goes with it.
    view.update(dialingTrace(), T0 + 250);
    expect(view.visible).toBe(false);
    expect(dom.root.hidden).toBe(true);
  });

  it('wires RETRY and DOWNLOAD LOG to their handlers', () => {
    const dom = fakeDom();
    let retried = 0;
    let downloaded = 0;
    const view = new ConnectTraceView({
      dom,
      onRetry: () => retried++,
      onDownloadLog: () => downloaded++,
    });
    view.update(connectRefused(dialingTrace(), 'bad-ticket', T0 + 300), T0 + 300);

    dom.byId.get(CONNECT_TRACE_RETRY_ID)?.listeners['click']?.forEach((fn) => fn());
    dom.byId.get(CONNECT_TRACE_DOWNLOAD_ID)?.listeners['click']?.forEach((fn) => fn());
    expect(retried).toBe(1);
    expect(downloaded, 'the log button reached its own handler').toBe(1);
  });

  it('takes itself off screen when the attempt ends', () => {
    const dom = fakeDom();
    const view = new ConnectTraceView({ dom, onRetry: () => {}, onDownloadLog: () => {} });
    view.update(connectRefused(dialingTrace(), 'bad-ticket', T0 + 300), T0 + 300);
    view.hide();
    expect(view.visible).toBe(false);
    expect(dom.root.hidden).toBe(true);
  });

  it('survives a page with no body to mount into', () => {
    const view = new ConnectTraceView({
      dom: { body: null, createElement: () => fakeElement(), getElementById: () => null },
      onRetry: () => {},
      onDownloadLog: () => {},
    });
    const refused = connectRefused(dialingTrace(), 'bad-ticket', T0 + 300);
    expect(() => view.update(refused, T0 + 300)).not.toThrow();
    expect(view.visible).toBe(false);
  });
});
