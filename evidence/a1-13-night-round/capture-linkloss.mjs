/**
 * evidence/a1-13-night-round/capture-linkloss.mjs — CONNECTION LOST, on a REAL
 * online match on the SERVED build. OWNER: QA Manager (a1-13 §2; n6-01 / #370).
 *
 * From the developer's own zombie-match report:
 *
 *   *"Left browser, came back, disconnected — bots frozen but I could still move.
 *   I should get kicked out and presented reconnect / abandon buttons, and
 *   verbosity of what happened."*
 *
 * Everything that report asked for shipped, and `installLinkLossView` had ZERO
 * callers until tonight — the fix existed as a module and never as a behaviour.
 * So the question is not whether the overlay renders. It is whether a real match
 * on the served bundle, losing a real link, puts it on the screen, and whether the
 * buttons on it DO anything. **A button that appears and does nothing is a failed
 * verdict**, so each is pressed and its consequence recorded.
 *
 * ── TWO HUMANS, AND THE GUEST IS THE ONE KILLED ──────────────────────────
 * The shape is n6-01's own live-stage spec: host CREATEs a real room on the real
 * fleet, guest JOINs by typing the code, host RUSHes, and the GUEST's link is the
 * one taken away. A one-human room was tried first and could not answer the
 * question — see below.
 *
 * ── HOW THE LINK IS KILLED, AND TWO METHODS THAT FAILED FIRST ────────────
 * CDP `Network.emulateNetworkConditions {offline:true}` on the guest's page. The
 * browser stops carrying that page's traffic; no client code is involved in
 * producing the loss, which is the point — the shipped bundle has to notice on its
 * own. Lifting it is one call back, so RECONNECT can be pressed under a link that
 * is genuinely reclaimable.
 *
 * 1. `page.routeWebSocket`, proxying the socket and dropping server→client frames
 *    (the closest thing to the spec's Fly-edge `?gag=1`), produced a beautiful and
 *    WORTHLESS result: no overlay for 41 s. The socket probe caught why. At the
 *    instant the gag flipped, the page's socket had already been silent 7.0 s, had
 *    received 8 frames in a whole match, and sat at `readyState: 2` — CLOSING. The
 *    proxy had broken the link long before the experiment began, so the run
 *    measured the client's reaction to a link THE INSTRUMENT killed, at a moment
 *    the instrument did not choose. A finding filed off that would have been
 *    fabricated.
 * 2. With the proxy removed entirely, a ONE-human room (host + one BOT seat) did
 *    the same thing on its own: `./probe-socket.mjs`, which interferes with
 *    nothing at all, watched the match socket close **1006, unclean, no reason**
 *    about 8 s after CREATE and right at RUSH, then watched the match run 60 s
 *    more with 7 frames ever received and no overlay. That is a real observation
 *    and it is kept — but it cannot answer THIS question, because a link that dies
 *    before the experiment starts is not a link the experiment took away.
 *
 * Which is why the socket probe is not optional, and why `requireLiveLink` refuses
 * to run the experiment at all unless the guest's socket is OPEN and taking real
 * frames first. "The overlay never appeared" is a claim about the client only if
 * the frames provably stopped when I said they did, and were provably flowing
 * before.
 *
 *   node evidence/a1-13-night-round/capture-linkloss.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const VIEW = { width: 1280, height: 800 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

const out = { base: BASE, capturedAt: new Date().toISOString(), view: VIEW, runs: {} };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** The overlay's ids — `src/net/link-loss-view.ts` exports these by name. */
const ROOT = '#pr-link-loss';
const BTN = {
  reconnect: '#pr-link-loss-reconnect',
  abandon: '#pr-link-loss-abandon',
  menu: '#pr-link-loss-menu',
};

/** Counts frames on the page's own socket and records the close verbatim. The
 *  control without which "no overlay" means nothing. */
const WS_PROBE = () => {
  const w = window;
  w.__wsProbe = { sockets: [] };
  const Native = w.WebSocket;
  const P = function (url, protocols) {
    const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
    const rec = {
      url: String(url),
      openedAt: Date.now(),
      received: 0,
      sent: 0,
      lastRecvAt: 0,
      close: null,
      sock: s,
    };
    w.__wsProbe.sockets.push(rec);
    s.addEventListener('message', () => {
      rec.received++;
      rec.lastRecvAt = Date.now();
    });
    s.addEventListener('close', (e) => {
      rec.close = { at: Date.now(), code: e.code, reason: String(e.reason ?? ''), wasClean: e.wasClean };
    });
    const send = s.send.bind(s);
    s.send = (d) => {
      rec.sent++;
      return send(d);
    };
    return s;
  };
  P.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) P[k] = Native[k];
  w.WebSocket = P;
};

const wsProbe = (page) =>
  page.evaluate(() =>
    (window.__wsProbe?.sockets ?? []).map((r) => ({
      url: r.url.split('?')[0],
      received: r.received,
      sent: r.sent,
      sinceLastRecvMs: r.lastRecvAt ? Date.now() - r.lastRecvAt : null,
      readyState: r.sock.readyState,
      close: r.close,
      ageMs: Date.now() - r.openedAt,
    })),
  );

/** What the overlay says and offers, read off the live DOM. */
const overlay = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('pr-link-loss');
    if (!root) return { present: false };
    const txt = (id) => document.getElementById(id)?.textContent ?? null;
    const buttons = Array.from(root.querySelectorAll('button')).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        id: b.id,
        label: b.textContent,
        disabled: b.disabled,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    const box = root.getBoundingClientRect();
    return {
      present: true,
      covers: { w: Math.round(box.width), h: Math.round(box.height) },
      title: txt('pr-link-loss-title'),
      detail: txt('pr-link-loss-detail'),
      buttons,
    };
  });

async function shoot(page, name) {
  const file = `a1-13-${name}.png`;
  await page.screenshot({ path: join(IMAGES, file) });
  return `images/${file}`;
}

const ctrl = (page, seam, kind) =>
  page.evaluate(
    ([w, k]) => {
      const l =
        w === 'menu' ? (window.__mainMenu?.controls ?? []) : (window.__onlineMenu?.doorControls ?? []);
      const c = l.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind],
  );

async function press(page, seam, kind) {
  const p = await ctrl(page, seam, kind);
  if (!p) throw new Error(`no '${kind}' control drawn on the ${seam} screen`);
  await page.mouse.click(p.x, p.y);
}

async function newClient(who, log, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  await ctx.addInitScript(WS_PROBE);

  // THE SILENT LOSS. `setOffline` closes the socket, and a genuinely closed socket
  // is the case `link-loss.ts` `transportState` sends straight to `redialing` —
  // "a loss with a dial already in flight, so it goes straight to redialing rather
  // than asking a player to press RECONNECT at a transport that is already
  // pressing it". Correct, and it means the RECONNECT button is unreachable that
  // way. The developer's report is the OTHER loss: frames stop and nothing hangs
  // up. This proxy produces it — server→client delivery stops, both ends stay
  // open, no close event — which is the n6-01 edge's `?gag=1` in a route handler.
  const silent = { on: false };
  if (opts.proxy) {
    await ctx.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        try {
          server.send(m);
        } catch {
          /* server side gone */
        }
      });
      server.onMessage((m) => {
        if (silent.on) return; // ← the gag
        try {
          ws.send(m);
        } catch {
          /* client side gone */
        }
      });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.errors.push({ who, kind: 'pageerror', message: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') log.errors.push({ who, kind: 'console.error', message: m.text() });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const setOffline = (on) =>
    cdp.send('Network.emulateNetworkConditions', {
      offline: on,
      latency: 0,
      downloadThroughput: on ? 0 : -1,
      uploadThroughput: on ? 0 : -1,
    });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 90_000 });
  const setSilent = (on) => {
    silent.on = on;
    return Promise.resolve();
  };
  return { ctx, page, setOffline, setSilent };
}

const badge = (page) =>
  page.evaluate(() => {
    const b = window.__buildBadge;
    return b ? { text: b.text, server: b.server, rttMs: b.rttMs } : null;
  });

/** A real room on the real fleet with TWO humans in it, RUSH pressed by the host. */
async function twoHumanMatch(log, opts = {}) {
  const host = await newClient('host', log);
  const guest = await newClient('guest', log, opts.guest ?? {});

  await press(host.page, 'menu', 'play');
  await host.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 60_000,
  });
  await press(host.page, 'door', 'create');
  await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 120_000 });
  await sleep(1200);
  const room = await host.page.evaluate(() => window.__lobby.room);
  log.room = room;

  await press(guest.page, 'menu', 'play');
  await guest.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 60_000,
  });
  await press(guest.page, 'door', 'join');
  await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, {
    timeout: 30_000,
  });
  for (const ch of room.split('')) {
    await guest.page.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
    await sleep(120);
  }
  await guest.page.evaluate(() => window.__onlineMenu.submit());
  await guest.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 120_000 });
  await sleep(1500);

  log.hostLobby = await host.page.evaluate(() => ({
    online: window.__lobby.online,
    room: window.__lobby.room,
    humanCount: window.__lobby.humanCount,
    seats: window.__lobby.seatStates.map((s) => s.label),
  }));
  log.guestLobby = await guest.page.evaluate(() => ({
    online: window.__lobby.online,
    room: window.__lobby.room,
    humanCount: window.__lobby.humanCount,
    isHost: window.__lobby.isHost,
  }));
  log.hostBadge = await badge(host.page);
  log.guestBadge = await badge(guest.page);
  log.lobbyImage = await shoot(guest.page, `${log.name}-1-lobby-guest`);

  const rc = await host.page.evaluate(() => {
    const p = window.__lobby.rushControl.physicalCenter;
    return { x: p.x, y: p.y };
  });
  await host.page.mouse.click(rc.x, rc.y);
  await host.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 120_000,
  });
  await guest.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 120_000,
  });
  log.matchStartedAt = Date.now();
  return { host, guest };
}

/**
 * THE PRECONDITION. Before taking a link away, prove it was alive: the guest's
 * match socket must be OPEN and taking real frames. Without this the run repeats
 * the mistake in the header — measuring a reaction to a link that was already gone.
 */
async function requireLiveLink(page, log, tag) {
  const a = await wsProbe(page);
  await sleep(4000);
  const b = await wsProbe(page);
  const match = b.find((s) => s.url.endsWith('/play')) ?? b[b.length - 1];
  const before = a.find((s) => s.url === match?.url);
  const gained = match && before ? match.received - before.received : 0;
  log[`${tag}Link`] = { before, after: match, framesIn4s: gained };
  if (!match || match.readyState !== 1 || gained < 5) {
    throw new Error(
      `the guest's link was NOT alive before the experiment: readyState=${match?.readyState}, ` +
        `frames in 4 s=${gained}, close=${JSON.stringify(match?.close ?? null)}`,
    );
  }
  return match;
}

/** Watch for the overlay while sampling the socket once a second. */
async function watchForOverlay(page, log, cutAt, tag, waitMs = 40_000) {
  const timeline = [];
  let appearedAt = null;
  while (Date.now() - cutAt < waitMs) {
    const ws = await wsProbe(page);
    const up = await page.$(`${ROOT} button`);
    timeline.push({ atMs: Date.now() - cutAt, ws: ws[ws.length - 1] ?? null, overlay: !!up });
    if (up) {
      appearedAt = Date.now();
      break;
    }
    await sleep(1000);
  }
  log[`${tag}Timeline`] = timeline;
  log[`${tag}NoticedAfterMs`] = appearedAt ? appearedAt - cutAt : null;
  if (!appearedAt) {
    log[`${tag}Overlay`] = await overlay(page);
    log[`${tag}Image`] = await shoot(page, `${log.name}-${tag}-NO-OVERLAY`);
    throw new Error(
      `no CONNECTION LOST overlay ${Math.round((Date.now() - cutAt) / 1000)}s after the link was cut`,
    );
  }
  await sleep(400); // let the countdown paint a real value
  log[`${tag}Overlay`] = await overlay(page);
  log[`${tag}Image`] = await shoot(page, `${log.name}-${tag}`);
}

async function run(name, body, opts = {}) {
  const log = { name, errors: [] };
  let clients = null;
  try {
    clients = await twoHumanMatch(log, opts);
    await sleep(3000);
    log.beforeCut = await overlay(clients.guest.page);
    log.beforeCutImage = await shoot(clients.guest.page, `${name}-2-healthy-guest`);
    await requireLiveLink(clients.guest.page, log, 'pre');
    await body(clients, log);
  } catch (e) {
    log.failure = String(e && e.message ? e.message : e);
    try {
      if (clients) log.failureImage = await shoot(clients.guest.page, `${name}-failure`);
    } catch {
      /* page may be gone */
    }
  } finally {
    if (clients) {
      await clients.host.ctx.close().catch(() => {});
      await clients.guest.ctx.close().catch(() => {});
    }
  }
  out.runs[name] = log;
  return log;
}

// ---------------------------------------------------------------------------
// RUN A — the overlay, then RECONNECT twice: into the dark, then for real
// ---------------------------------------------------------------------------
const ONLY = process.env.A1_13_ONLY ?? '';
if (!ONLY || ONLY === 'reconnect')
  await run('linkloss-reconnect', async ({ guest }, log) => {
  const cutAt = Date.now();
  await guest.setOffline(true);
  await watchForOverlay(guest.page, log, cutAt, 'lost');

  // THE FIRST CARD IS NOT THE ONE WITH RECONNECT ON IT, and an earlier run failed
  // here by assuming it was. A fresh loss is owed one automatic redial
  // (`link-loss.ts` `pollLink` — "spending the one automatic redial a fresh loss
  // is owed"), so what comes up 3 s after the cut is RECONNECTING…, whose only
  // button is ABANDON MATCH. RECONNECT appears once that automatic attempt has
  // failed and the card settles into the lost phase. Waiting for it is the test.
  await guest.page.waitForSelector(BTN.reconnect, { timeout: 90_000 });
  log.reconnectOfferedAfterMs = Date.now() - cutAt;
  await sleep(300);
  log.lostCard = await overlay(guest.page);
  log.lostCardImage = await shoot(guest.page, `${log.name}-3-reconnect-offered`);

  // Press 1: the link is still dead. A redial into the dark must still DO
  // something visible — the difference between a wired button and a painted one.
  await guest.page.click(BTN.reconnect, { timeout: 20_000 });
  await sleep(1500);
  log.afterPress1 = await overlay(guest.page);
  log.afterPress1Image = await shoot(guest.page, `${log.name}-4-after-press-offline`);
  await sleep(3500);
  log.afterPress1Settled = await overlay(guest.page);
  log.afterPress1SettledImage = await shoot(guest.page, `${log.name}-5-settled-offline`);

  // Press 2: put the network back first, so the seat is genuinely reclaimable and
  // the claim under test is the strong one — "same cargo, same upgrades".
  await guest.setOffline(false);
  log.linkRestoredAt = Date.now();
  await sleep(2000);
  log.afterRestoreNoPress = await overlay(guest.page);

  if (await guest.page.$(BTN.reconnect)) {
    await guest.page.click(BTN.reconnect, { timeout: 20_000 });
    log.press2At = Date.now();
  } else {
    log.press2Skipped = (await guest.page.$(`${ROOT} button`))
      ? 'the card had moved on from RECONNECT by the time the link came back'
      : 'the overlay had already cleared itself once the link came back';
  }
  await sleep(5000);
  log.afterPress2 = await overlay(guest.page);
  log.afterPress2Image = await shoot(guest.page, `${log.name}-6-after-reconnect`);
  log.afterPress2Link = (await wsProbe(guest.page)).slice(-2);
  log.recovered = await guest.page.evaluate(() => ({
    matchStarted: window.__mainMenu?.matchStarted ?? null,
    overlayGone: !document.getElementById('pr-link-loss')?.querySelector('button'),
  }));
});

// ---------------------------------------------------------------------------
// RUN B — a second real match, and the other button
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'abandon')
  await run('linkloss-abandon', async ({ guest }, log) => {
  const cutAt = Date.now();
  await guest.setOffline(true);
  await watchForOverlay(guest.page, log, cutAt, 'lost');

  await guest.page.click(BTN.abandon, { timeout: 20_000 });
  await sleep(3000);
  log.afterAbandon = await overlay(guest.page);
  log.afterAbandonImage = await shoot(guest.page, `${log.name}-4-after-abandon`);

  // BACK TO MENU is the caller's own `exitToMenu` — the last link in the chain the
  // report asked for.
  if (await guest.page.$(BTN.menu)) {
    await guest.setOffline(false);
    await guest.page.click(BTN.menu, { timeout: 20_000 });
    await sleep(3500);
    log.afterMenu = await overlay(guest.page);
    log.afterMenuState = await guest.page.evaluate(() => ({
      mainMenuVisible: window.__mainMenu?.visible ?? null,
      onlineMenuVisible: window.__onlineMenu?.visible ?? null,
      matchStarted: window.__mainMenu?.matchStarted ?? null,
    }));
    log.afterMenuImage = await shoot(guest.page, `${log.name}-5-after-back-to-menu`);
  } else {
    log.menuSkipped = 'no BACK TO MENU button on the card after ABANDON';
  }
});

// ---------------------------------------------------------------------------
// RUN C — THE DEVELOPER'S OWN LOSS: frames stop, nothing hangs up, and the
// player is the one who has to press RECONNECT
// ---------------------------------------------------------------------------
if (!ONLY || ONLY === 'silent')
  await run(
    'linkloss-silent',
    async ({ guest }, log) => {
      const cutAt = Date.now();
      await guest.setSilent(true);
      await watchForOverlay(guest.page, log, cutAt, 'lost');

      // On a silent loss the socket never closed, so nothing is auto-dialling and
      // the card must offer the player the redial. If RECONNECT is not here, the
      // report's central ask is unmet.
      await guest.page.waitForSelector(BTN.reconnect, { timeout: 60_000 });
      log.reconnectOfferedAfterMs = Date.now() - cutAt;
      await sleep(300);
      log.lostCard = await overlay(guest.page);
      log.lostCardImage = await shoot(guest.page, `${log.name}-3-reconnect-offered`);
      log.linkAtCard = (await wsProbe(guest.page)).slice(-1);

      // Press 1 — still silent. A redial into the dark must still DO something
      // visible: that is the difference between a wired button and a painted one.
      const before1 = await overlay(guest.page);
      await guest.page.click(BTN.reconnect, { timeout: 20_000 });
      await sleep(1200);
      log.afterPress1 = await overlay(guest.page);
      log.press1ChangedTheCard = JSON.stringify(before1) !== JSON.stringify(log.afterPress1);
      log.afterPress1Image = await shoot(guest.page, `${log.name}-4-after-press-silent`);
      await sleep(4000);
      log.afterPress1Settled = await overlay(guest.page);

      // Press 2 — lift the gag first, so the seat is genuinely reclaimable and the
      // claim under test is the strong one: "same cargo, same upgrades".
      await guest.setSilent(false);
      log.gagLiftedAt = Date.now();
      await sleep(2500);
      log.afterUngagNoPress = await overlay(guest.page);
      log.afterUngagLink = (await wsProbe(guest.page)).slice(-1);

      if (await guest.page.$(BTN.reconnect)) {
        await guest.page.click(BTN.reconnect, { timeout: 20_000 });
        log.press2At = Date.now();
      } else {
        log.press2Skipped = (await guest.page.$(`${ROOT} button`))
          ? 'the card had moved on from RECONNECT by the time the frames came back'
          : 'the overlay took itself down the moment the frames came back';
      }
      await sleep(5000);
      log.afterPress2 = await overlay(guest.page);
      log.afterPress2Image = await shoot(guest.page, `${log.name}-5-after-reconnect`);
      log.afterPress2Link = (await wsProbe(guest.page)).slice(-1);
      log.recovered = await guest.page.evaluate(() => ({
        matchStarted: window.__mainMenu?.matchStarted ?? null,
        overlayGone: !document.getElementById('pr-link-loss')?.querySelector('button'),
      }));
    },
    { guest: { proxy: true } },
  );

// ---------------------------------------------------------------------------
// RUN D — THE WHOLE GRACE WINDOW. What a player actually watches for 100 s.
// ---------------------------------------------------------------------------
// Runs A and C both waited for a RECONNECT button that never came and then threw,
// which says "not within 90 s" and nothing about what WAS on the glass. This one
// asserts nothing and photographs everything: the card, once every two seconds,
// from the cut until well past the 60 s grace, with a shot at every change of
// title. That is the answer to "show the overlay and say what the buttons do",
// including the honest part — which button was never drawn at all.
if (!ONLY || ONLY === 'grace')
  await run('linkloss-grace', async ({ guest }, log) => {
    const cutAt = Date.now();
    await guest.setOffline(true);
    const cards = [];
    let lastTitle = null;
    for (let i = 0; i < 55; i++) {
      const o = await overlay(guest.page);
      const title = o.present ? o.title : null;
      const entry = {
        atMs: Date.now() - cutAt,
        title,
        detail: o.present ? o.detail : null,
        buttons: o.present ? o.buttons.map((b) => `${b.label} (${b.w}x${b.h})`) : [],
      };
      if (title !== lastTitle) {
        entry.image = await shoot(guest.page, `${log.name}-t${String(entry.atMs).padStart(6, '0')}`);
        lastTitle = title;
      }
      cards.push(entry);
      await sleep(2000);
    }
    log.cards = cards;
    log.titlesSeen = [...new Set(cards.map((c) => c.title))];
    log.buttonsEverOffered = [
      ...new Set(cards.flatMap((c) => c.buttons.map((b) => b.split(' (')[0]))),
    ];
    log.reconnectEverOffered = log.buttonsEverOffered.some((b) => b.startsWith('RECONNECT'));
    log.finalCard = cards[cards.length - 1];
  });

// ---------------------------------------------------------------------------
// RUN E — does it come DOWN by itself when the frames come back?
// ---------------------------------------------------------------------------
// The other half of "the buttons do something": an overlay that never leaves is
// its own kick-out. Silent loss, let the card come up, then simply restore
// delivery and press NOTHING.
if (!ONLY || ONLY === 'recovery')
  await run(
    'linkloss-recovery',
    async ({ guest }, log) => {
      const cutAt = Date.now();
      await guest.setSilent(true);
      await watchForOverlay(guest.page, log, cutAt, 'lost');
      await sleep(6000);
      log.beforeRestore = await overlay(guest.page);
      log.beforeRestoreImage = await shoot(guest.page, `${log.name}-3-up`);

      await guest.setSilent(false);
      const restoredAt = Date.now();
      let clearedAfterMs = null;
      for (let i = 0; i < 40; i++) {
        if (!(await guest.page.$(`${ROOT} button`))) {
          clearedAfterMs = Date.now() - restoredAt;
          break;
        }
        await sleep(1000);
      }
      log.clearedAfterMs = clearedAfterMs;
      log.afterRestore = await overlay(guest.page);
      log.afterRestoreImage = await shoot(guest.page, `${log.name}-4-after-restore`);
      log.afterRestoreLink = (await wsProbe(guest.page)).slice(-1);
      log.resumed = await guest.page.evaluate(() => ({
        matchStarted: window.__mainMenu?.matchStarted ?? null,
        shipPos: window.__mainMenu?.localShipPos ?? null,
      }));
    },
    { guest: { proxy: true } },
  );

await browser.close();
const FILE = join(HERE, 'readback-linkloss.json');
if (ONLY && existsSync(FILE)) {
  // Re-running one leg must not delete the other leg's record.
  const prior = JSON.parse(readFileSync(FILE, 'utf8'));
  out.runs = { ...prior.runs, ...out.runs };
  out.priorCapturedAt = prior.capturedAt;
}
writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
