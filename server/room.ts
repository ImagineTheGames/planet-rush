/**
 * server/room.ts — one room, one match, one authority. OWNER: Netcode Engineer
 * (GDD §3.5, §4.2).
 *
 * A room is created from the lobby with a shareable code, fills its empty slots
 * with bots server-side, and then holds **all** simulation authority: clients
 * send input ticks, this object runs the one true sim (`src/sim/`, never PixiJS)
 * and broadcasts state. A three-human classroom match is still an eight-station
 * war, because the five empty seats are bots on this side of the wire (GDD §4.2).
 *
 * **The clock lives here.** {@link MatchRoom.update} is handed a wall-clock
 * reading and converts it into whole fixed 60 Hz sim ticks — the same fixed
 * timestep the client and the QA harness run (GDD §4.1). Nothing inside this
 * file reads a clock, spawns a timer, or touches the network: time and sockets
 * are injected, which is what makes a sixty-second reconnect window something a
 * unit test can watch pass in a microsecond.
 *
 * **The reconnect grace rule** (GDD §4.2), which is most of the state machine:
 *
 *  1. A player's socket drops mid-match. Their ship is *not* removed — a bot
 *     takes over the controls immediately, so the match keeps its shape and the
 *     room does not stall. Everyone is told (`playerSubstituted`).
 *  2. For {@link DEFAULT_GRACE_MS} (~60 s, TUNABLE) that slot is held. The
 *     player rejoins by room code, presents the reclaim token their `welcome`
 *     gave them, and takes the controls back: same ship, same hull, same cargo,
 *     same banked ore, same upgrades — because the ship was never touched, only
 *     the hands on it changed (`playerReclaimed`).
 *  3. If the window closes first, the bot keeps the seat for the rest of the
 *     match and the token stops working.
 *
 * This is written for mobile play, where a screen lock, an app backgrounding, or
 * a cellular hand-off is routine rather than exceptional (GDD §4.2, mobile
 * amendment).
 */

import type { PlayerId } from '@shared/types';
import { ShipClass } from '@shared/types';
import type { Bot } from '../src/bots';
import {
  Difficulty,
  MATCH_SLOTS,
  PERSONALITIES,
  ROSTER,
  createBot,
  rosterAt,
  thinkOnce,
} from '../src/bots';
import type { PersonalityId } from '../src/bots';
import { InputQueue } from '../src/net/input-queue';
import { encodeWorldSnapshot } from '../src/net/snapshot';
import type {
  BotDifficulty,
  ClientMessage,
  EntityEventMessage,
  InputMessage,
  LobbySlot,
  PlayerEconomy,
  RoomCode,
  ServerMessage,
} from '../src/net/transport';
import { encodeServerMessage } from '../src/net/wire';
import type { WireFrame } from '../src/net/wire';
import { TICK_DT, createWorld, isOver, step } from '../src/sim';
import type { Bounds, MatchMode, PlayerInput, World } from '../src/sim';
import { FogTracker, StaticEntityTracker, fullEntityState } from './static-events';

// ---------------------------------------------------------------------------
// The socket seam
// ---------------------------------------------------------------------------

/**
 * All the room needs from a connection. `server/ws.ts` implements it over a
 * real WebSocket; a test implements it with an array. Deliberately tiny: the
 * authoritative sim must not be reachable only through a network stack.
 */
export interface ServerSocket {
  /** Deliver one encoded frame. Must not throw on a dead socket — drop it. */
  send(frame: WireFrame): void;
  /** Hang up. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** The reconnect-grace window (GDD §4.2: "~60 seconds", TUNABLE). */
export const DEFAULT_GRACE_MS = 60_000;

/** Snapshot every 2nd sim tick = 30 Hz, the rate the day-0 spike decided
 *  (docs/netcode-spike.md). */
export const DEFAULT_SNAPSHOT_INTERVAL_TICKS = 2;

/** Static-entity diffs every 6th tick = 10 Hz. A turret builds over ten seconds
 *  and a wave lands every two and a half minutes (GDD §2.8), so this is already
 *  far finer than anything it reports — and it costs nothing when nothing moved. */
export const DEFAULT_EVENT_INTERVAL_TICKS = 6;

/**
 * The most sim ticks one {@link MatchRoom.update} will run. A server that has
 * been descheduled (a noisy neighbour on a free-tier ARM core) must catch up
 * *gradually*: the remainder runs on the next update rather than in one burst
 * that would stall every other room in the process. Half a second of sim.
 */
export const MAX_CATCHUP_TICKS = 30;

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Why a join was refused. Reported to the client so a lobby can say something
 *  truthful instead of "connection failed". */
export type JoinRejection =
  | 'room-full'
  | 'match-live'
  | 'reclaim-unknown'
  | 'reclaim-expired'
  | 'reclaim-denied';

/** The outcome of a join attempt. */
export type JoinOutcome =
  | { readonly ok: true; readonly player: PlayerId; readonly reclaimed: boolean }
  | { readonly ok: false; readonly reason: JoinRejection };

/** One seat in the room: who is in it, who is flying it, and whether the seat
 *  is being held open for someone who dropped. */
interface Slot {
  readonly player: PlayerId;
  /** The live human connection, or null when a bot has the controls. */
  socket: ServerSocket | null;
  shipClass: ShipClass;
  /** The side this slot fights for (variable-slots Task C4). FFA is teams-of-one,
   *  so it is the slot's own id; TEAMS (Milestone D/E) shares one team across
   *  allies. Carried on `lobbyState`/`matchStart`, never the per-tick snapshot. */
  team: number;
  ready: boolean;
  /** The bot currently flying: a lobby fill, or a substitute for a dropped
   *  human. Null exactly when a human is connected and flying. */
  bot: Bot | null;
  personality: PersonalityId | null;
  difficulty: BotDifficulty | null;
  /** Wall-clock ms at which the reconnect window closes, or -1 when the seat is
   *  not being held for anyone. */
  graceUntil: number;
  /** The secret issued to the human who holds this seat (GDD §4.2 reclaim). */
  token: string | null;
  /**
   * Latest input sequence from this slot the world has **actually simulated**;
   * echoed in every snapshot so the client can retire settled predictions.
   *
   * Acknowledged on application, not on arrival (`InputQueue.take` carries the
   * seq through to here). The difference is the whole of client-side
   * reconciliation: a client replays every input past `ackSeq` on top of the
   * snapshot, so an ack for input the server is still holding in its queue would
   * make the client throw away a press whose effect has not happened yet, and
   * the ship would visibly stutter backwards (GDD §4.2).
   */
  ackSeq: number;
  /** Per-client fog of war over station health (GDD §2.2). */
  fog: FogTracker | null;
  /**
   * The wallet this slot's client was last *told* (`src/net/transport`
   * EconomyMessage), or null when it has never been told one — the whole of the
   * economy channel's change detection. Held ore, banked ore and upgrade tiers do
   * not ride the per-tick snapshot, so authority volunteers them on the ticks they
   * move and stays quiet otherwise; comparing against what went out last is what
   * makes "otherwise" the common case.
   */
  wallet: PlayerEconomy | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How to stand a room up. Everything non-deterministic is injected. */
export interface RoomConfig {
  readonly code: RoomCode;
  /** Match seed — the world and every bot derive from it (GDD §4.1). */
  readonly seed: number;
  /** Seats in the match — N, the variable match size (2..8, variable-slots
   *  Task C1). Default {@link MATCH_SLOTS} (8 stations, GDD §2.1). A room is sized
   *  once, at open; "closing" a lobby slot is resolved to a smaller N *before* it
   *  reaches here (dense-roster discipline, spike §S2 / Trap 6), so the room's
   *  seats are always a contiguous `0..N-1` and no sparse id ever enters the sim. */
  readonly slots?: number;
  /** Match mode (`'ffa' | 'teams'`), advertised in the heartbeat so a lobby can
   *  show/refuse the room before dialing (Task C3). Default `'ffa'`. The sim reads
   *  team allegiance per-ship; mode here is the room's advertised label. */
  readonly mode?: MatchMode;
  /** Reconnect grace, ms. Default {@link DEFAULT_GRACE_MS}. */
  readonly graceMs?: number;
  /** Fixed sim timestep. Default the sim's 60 Hz `TICK_DT`. */
  readonly dt?: number;
  readonly snapshotIntervalTicks?: number;
  readonly eventIntervalTicks?: number;
  /** Play bounds handed to `createWorld`. */
  readonly bounds?: Bounds;
  /** Asteroids per wave — the QA harness runs cramped worlds on purpose. */
  readonly asteroidCount?: number;
  /** Issues reclaim tokens. Injected so the server owns its randomness in one
   *  place and a test can make it predictable. */
  readonly makeToken: () => string;
}

/** Lobby / live / finished — the room's own three states. */
export type RoomPhase = 'lobby' | 'live' | 'ended';

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

export class MatchRoom {
  readonly code: RoomCode;

  private readonly slots: Slot[];
  /** The room's advertised mode (Task C3); `'ffa'` unless the lobby said teams. */
  private readonly matchMode: MatchMode;
  private readonly queue = new InputQueue();
  private readonly statics = new StaticEntityTracker();
  private readonly graceMs: number;
  private readonly dt: number;
  private readonly snapshotInterval: number;
  private readonly eventInterval: number;

  private authoritative: World | null = null;
  private phase: RoomPhase = 'lobby';
  /** The slot that created the room. A lobby word, not a network role (GDD
   *  §4.2): it picks bot difficulties and presses start, and is otherwise a
   *  client like any other. */
  private creator: PlayerId | null = null;
  private botDifficulties: readonly BotDifficulty[] = [];
  /** Wall clock of the last update, so elapsed real time becomes whole ticks. */
  private lastUpdateMs = -1;
  /** Fractional tick time carried between updates — dropping it would make the
   *  match run slow by up to one tick per update forever. */
  private carryMs = 0;

  constructor(private readonly config: RoomConfig) {
    this.code = config.code;
    this.graceMs = config.graceMs ?? DEFAULT_GRACE_MS;
    this.dt = config.dt ?? TICK_DT;
    this.snapshotInterval = config.snapshotIntervalTicks ?? DEFAULT_SNAPSHOT_INTERVAL_TICKS;
    this.eventInterval = config.eventIntervalTicks ?? DEFAULT_EVENT_INTERVAL_TICKS;
    this.matchMode = config.mode ?? 'ffa';
    const count = config.slots ?? MATCH_SLOTS;
    this.slots = Array.from({ length: count }, (_, player) => ({
      player,
      socket: null,
      // The onboarding default, until the lobby says otherwise (GDD §2.11).
      shipClass: ShipClass.Vanguard,
      // FFA teams-of-one until a TEAMS lobby regroups them (Milestone D/E).
      team: player,
      ready: false,
      bot: null,
      personality: null,
      difficulty: null,
      graceUntil: -1,
      token: null,
      ackSeq: 0,
      fog: null,
      wallet: null,
    }));
  }

  // --- Read-only surface --------------------------------------------------

  get state(): RoomPhase {
    return this.phase;
  }

  /** The authoritative world, or null before the match starts. */
  get world(): World | null {
    return this.authoritative;
  }

  /** Connected humans. A room with none and no grace left is garbage. */
  get humanCount(): number {
    return this.slots.filter((s) => s.socket !== null).length;
  }

  /** N — the seat count this room was opened at (variable-slots Task C1). This is
   *  the match size a heartbeat advertises and the world is built to (2..8). */
  get size(): number {
    return this.slots.length;
  }

  /** The room's advertised mode (Task C3). */
  get mode(): MatchMode {
    return this.matchMode;
  }

  /**
   * Seats a new human could take *right now* (Task C3): empty seats while the
   * room is still in its lobby. Once the match is live a new arrival is refused
   * (`join` → `'match-live'`) — reclaim is the only way back in — so a live or
   * ended room advertises zero joinable seats even if a bot-flown seat is "empty".
   */
  get joinableSeats(): number {
    if (this.phase !== 'lobby') return 0;
    return this.slots.filter((s) => s.socket === null).length;
  }

  /** True while somebody may still come back to a held seat (GDD §4.2). */
  get hasPendingReclaim(): boolean {
    return this.slots.some((s) => s.graceUntil >= 0);
  }

  /** Seconds left on a slot's reconnect window, or 0 when it holds no seat. */
  graceRemaining(player: PlayerId, nowMs: number): number {
    const slot = this.slots[player];
    if (!slot || slot.graceUntil < 0) return 0;
    return Math.max(0, (slot.graceUntil - nowMs) / 1000);
  }

  /** The public lobby view (GDD §2.1; player colors are the slot index, §5.2). */
  lobbyState(): LobbySlot[] {
    return this.slots.map((slot) => ({
      player: slot.player,
      isBot: slot.bot !== null,
      ...(slot.difficulty ? { botDifficulty: slot.difficulty } : {}),
      shipClass: slot.shipClass,
      team: slot.team,
      ready: slot.ready,
    }));
  }

  // --- Joining, dropping, reclaiming --------------------------------------

  /**
   * Seat a connection. Three doors, in order:
   *
   *  1. **Reclaim** — a `reclaim` slot plus the token that seat issued, inside
   *     its grace window: the player takes their ship back (GDD §4.2).
   *  2. **Lobby** — the match has not started: the lowest free seat.
   *  3. **Refused** — the match is live and this is not a reclaim. Joining a
   *     match in progress would mean spawning a fresh station into a war that
   *     has already been fought; the lobby is where matches are entered.
   */
  join(
    socket: ServerSocket,
    request: { reclaim?: PlayerId; reclaimToken?: string },
    nowMs: number,
  ): JoinOutcome {
    if (request.reclaim !== undefined) return this.reclaim(socket, request, nowMs);

    if (this.phase !== 'lobby') return { ok: false, reason: 'match-live' };
    const slot = this.slots.find((s) => s.socket === null);
    if (!slot) return { ok: false, reason: 'room-full' };

    slot.socket = socket;
    slot.ready = true;
    slot.token = this.config.makeToken();
    slot.fog = new FogTracker(slot.player);
    if (this.creator === null) this.creator = slot.player;

    this.welcome(slot);
    this.broadcastLobby();
    return { ok: true, player: slot.player, reclaimed: false };
  }

  /** The reconnect-grace door (GDD §4.2). */
  private reclaim(
    socket: ServerSocket,
    request: { reclaim?: PlayerId; reclaimToken?: string },
    nowMs: number,
  ): JoinOutcome {
    const slot = this.slots[request.reclaim as number];
    if (!slot) return { ok: false, reason: 'reclaim-unknown' };
    // A seat nobody is holding is not reclaimable: either the window closed and
    // the bot owns it now, or that player never dropped in the first place.
    if (slot.graceUntil < 0) {
      return { ok: false, reason: slot.socket ? 'reclaim-denied' : 'reclaim-expired' };
    }
    if (slot.graceUntil < nowMs) {
      // Expired but not yet swept (the sweep runs on `update`); treat it as gone.
      this.expireGrace(slot);
      return { ok: false, reason: 'reclaim-expired' };
    }
    // The room code is shared with the whole classroom by design, so it cannot
    // be the credential. The token is.
    if (!slot.token || slot.token !== request.reclaimToken) {
      return { ok: false, reason: 'reclaim-denied' };
    }

    slot.socket = socket;
    slot.graceUntil = -1;
    // The substituting bot lets go of the controls. The *ship* is untouched —
    // hull, cargo, banked ore and upgrades are exactly where the player left
    // them, because nothing ever removed it from the world (GDD §4.2).
    slot.bot = null;
    slot.personality = null;
    slot.difficulty = null;
    slot.ready = true;
    slot.fog = new FogTracker(slot.player);

    this.welcome(slot);
    // Sixty seconds is long enough for the field to have changed underneath
    // them, so a reclaiming client is re-taught the whole static map.
    if (this.authoritative) {
      this.sendMatchStart(slot);
      for (const event of fullEntityState(this.authoritative)) this.sendTo(slot, event);
      this.sendSnapshot(slot, this.authoritative);
    }
    this.broadcast({ type: 'playerReclaimed', player: slot.player });
    this.broadcastLobby();
    return { ok: true, player: slot.player, reclaimed: true };
  }

  /**
   * A connection went away. In the lobby the seat simply frees. Mid-match it is
   * *held*: a bot takes the controls at once so the match keeps its shape, and
   * the grace clock starts (GDD §4.2).
   */
  disconnect(player: PlayerId, nowMs: number): void {
    const slot = this.slots[player];
    if (!slot || slot.socket === null) return;
    slot.socket = null;
    slot.fog = null;
    // Nobody is listening to this seat's economy channel any more, and whoever
    // reclaims it will be told the wallet afresh in their welcome (`welcome`).
    slot.wallet = null;

    if (this.phase !== 'live') {
      slot.ready = false;
      slot.token = null;
      if (this.creator === player) this.creator = this.slots.find((s) => s.socket)?.player ?? null;
      this.broadcastLobby();
      return;
    }

    this.seatBot(slot, this.substituteFor(slot.player));
    slot.graceUntil = nowMs + this.graceMs;
    this.broadcast({
      type: 'playerSubstituted',
      player: slot.player,
      graceSeconds: this.graceMs / 1000,
    });
    this.broadcastLobby();
  }

  // --- Client messages ----------------------------------------------------

  /** Route one validated client message. `player` comes from the *connection*,
   *  never from the message: the server never lets a client say who it is. */
  receive(player: PlayerId, message: ClientMessage): void {
    const slot = this.slots[player];
    if (!slot || slot.socket === null) return;

    switch (message.type) {
      case 'join':
        // Joining is the connection's business, not the room's; a second join
        // on a seated connection is a no-op rather than a second seat.
        break;
      case 'lobbyChoice':
        if (this.phase !== 'lobby') return; // a hull is locked for the match (§2.11)
        slot.shipClass = message.shipClass;
        // Only the room creator picks the bots' difficulties (GDD §4.2).
        if (player === this.creator && message.botDifficulties) {
          this.botDifficulties = message.botDifficulties;
        }
        this.broadcastLobby();
        break;
      case 'startMatch':
        if (player === this.creator) this.startMatch();
        break;
      case 'input':
        this.acceptInput(slot, message);
        break;
    }
  }

  /**
   * File one client's input for the tick it names.
   *
   * The queue's rules stand — input is applied to the tick it names, never to
   * "now", and duplicates and absurd futures are refused (`src/net/input-queue`).
   * One server-side softening: input that arrives *late* (its tick has already
   * been simulated) is re-filed on the next unsimulated tick rather than thrown
   * away. On a real network a player whose packet lost a race would otherwise
   * have their hands go dead for a frame — the ship holding its last intent is a
   * far better lie than the ship forgetting the player pressed anything. The
   * re-filed message keeps its `seq`, so it is acknowledged when it is *run*,
   * one tick later than the client asked for — which is the truth.
   */
  private acceptInput(slot: Slot, message: InputMessage): void {
    const simTick = this.authoritative?.tick ?? 0;
    const verdict = this.queue.accept(slot.player, message, simTick);
    if (verdict === 'late') this.queue.accept(slot.player, { ...message, tick: simTick + 1 }, simTick);
  }

  // --- The match ----------------------------------------------------------

  /**
   * RUSH! (GDD §2.1). Every seat without a human becomes a bot — server-side,
   * so a three-human classroom match is still an eight-station war (GDD §4.2) —
   * and the world is built from the lobby as it stands, so a hull picked a
   * moment ago is the hull that spawns.
   */
  startMatch(): void {
    if (this.phase !== 'lobby') return;

    let botIndex = 0;
    for (const slot of this.slots) {
      if (slot.socket !== null) continue;
      this.seatBot(slot, this.castFor(botIndex++));
      // A bot flies the hull its character flies (style-guide §4: the livery is
      // a palette swap over one of the four silhouettes).
      slot.shipClass = PERSONALITIES[slot.personality as PersonalityId].shipClass;
      slot.ready = true;
    }

    this.authoritative = createWorld({
      seed: this.config.seed,
      players: this.slots.map((slot) => ({
        id: slot.player,
        shipClass: slot.shipClass,
        team: slot.team,
      })),
      ...(this.config.bounds ? { bounds: this.config.bounds } : {}),
      ...(this.config.asteroidCount !== undefined
        ? { asteroidCount: this.config.asteroidCount }
        : {}),
    });
    this.phase = 'live';
    this.lastUpdateMs = -1;
    this.carryMs = 0;

    for (const slot of this.slots) {
      if (!slot.socket) continue;
      this.sendMatchStart(slot);
      for (const event of fullEntityState(this.authoritative)) this.sendTo(slot, event);
    }
    this.statics.prime(this.authoritative);
    this.broadcastLobby();
    this.broadcastSnapshot(this.authoritative);
  }

  /**
   * Turn elapsed wall-clock time into whole fixed sim ticks, run them, and
   * broadcast what changed. The only entry point that advances anything.
   *
   * Called by the process loop (`server/index.ts`) as fast as it likes: this is
   * a fixed-timestep sim (GDD §4.1), so calling it twice as often does not make
   * the match run twice as fast — it just makes the leftover fraction smaller.
   */
  update(nowMs: number): void {
    this.sweepGrace(nowMs);

    const world = this.authoritative;
    if (!world || this.phase !== 'live') {
      this.lastUpdateMs = nowMs;
      return;
    }
    if (this.lastUpdateMs < 0) {
      this.lastUpdateMs = nowMs;
      return;
    }

    const dtMs = this.dt * 1000;
    const elapsed = Math.max(0, nowMs - this.lastUpdateMs) + this.carryMs;
    this.lastUpdateMs = nowMs;

    let ticks = Math.floor(elapsed / dtMs);
    this.carryMs = elapsed - ticks * dtMs;
    if (ticks > MAX_CATCHUP_TICKS) {
      // Do not try to swallow a long stall in one update — run what we can and
      // let the rest arrive next time, so one lagging room cannot stall the
      // process every other room shares.
      ticks = MAX_CATCHUP_TICKS;
      this.carryMs = 0;
    }

    for (let i = 0; i < ticks && this.phase === 'live'; i++) this.tick(world);
  }

  /** One fixed sim tick: gather the ordered input, step, broadcast. */
  private tick(world: World): void {
    step(world, this.inputsFor(world), this.dt);

    if (world.tick % this.snapshotInterval === 0) this.broadcastSnapshot(world);
    if (world.tick % this.eventInterval === 0) {
      for (const event of this.statics.diff(world)) this.broadcast(event);
      // Health is scouted, not broadcast: each client is told only what its own
      // ship can see (GDD §2.2, `./static-events`).
      for (const slot of this.slots) {
        if (!slot.socket || !slot.fog) continue;
        for (const event of slot.fog.events(world)) this.sendTo(slot, event);
      }
    }

    if (isOver(world)) {
      this.phase = 'ended';
      this.broadcast({ type: 'matchEnd', winner: world.match.winner, tick: world.tick });
    }
  }

  /**
   * The tick's input, in slot order. Human rows come out of the ordered queue;
   * bot rows are thought up here, through the same `Action` channel a human
   * uses — the sim cannot tell them apart, and that is the design (GDD §2.9).
   *
   * A seat that a bot is flying ignores any human input still filed for it: a
   * player who dropped two ticks ago must not steer their own substitute.
   */
  private inputsFor(world: World): PlayerInput[] {
    const nextTick = world.tick + 1;
    const rows: PlayerInput[] = [];
    const botSeats = new Set<PlayerId>();

    for (const slot of this.slots) {
      if (!slot.bot) continue;
      botSeats.add(slot.player);
      rows.push({ id: slot.player, actions: thinkOnce(world, slot.bot, this.dt) });
    }
    for (const row of this.queue.take(nextTick)) {
      if (botSeats.has(row.id)) continue; // a substitute's seat ignores its human
      rows.push(row);
      // This input is about to be simulated, so this is the moment it becomes
      // true to tell its client "I have run this" (GDD §4.2 reconciliation).
      const slot = this.slots[row.id];
      if (slot && row.seq > slot.ackSeq) slot.ackSeq = row.seq;
    }

    // Sorted, so packet arrival order can never change the sim's resolution
    // order — the property the determinism replay rests on (GDD §4.8).
    rows.sort((a, b) => a.id - b.id);
    return rows;
  }

  // --- Bots ---------------------------------------------------------------

  /** Seat a bot in a slot, and take any human's hands off the controls. */
  private seatBot(slot: Slot, character: PersonalityId): void {
    slot.personality = character;
    slot.difficulty = PERSONALITIES[character].difficulty;
    slot.bot = createBot({ id: slot.player, personality: character }, { seed: this.config.seed });
  }

  /**
   * The character that fills the nth empty lobby seat. The creator's difficulty
   * list is honored slot by slot (GDD §2.1: "before the match, the host picks
   * each bot's difficulty"); anything it does not name falls back to roster
   * order, so a lobby that says nothing still gets the full cast.
   */
  private castFor(index: number): PersonalityId {
    const wanted = this.botDifficulties[index];
    if (wanted) {
      const tier = rosterAt(wanted as Difficulty);
      const pick = tier[index % Math.max(1, tier.length)];
      if (pick) return pick;
    }
    return ROSTER[index % ROSTER.length] as PersonalityId;
  }

  /**
   * The character that substitutes for a dropped player. Chosen by slot so the
   * same player always gets the same stand-in, and Medium so the substitute
   * plays the triangle rather than turtling or throwing the seat away
   * (GDD §2.9) — a bot minding your station should not be a punishment.
   */
  private substituteFor(player: PlayerId): PersonalityId {
    const medium = rosterAt(Difficulty.Medium);
    return (medium[player % Math.max(1, medium.length)] ?? ROSTER[0]) as PersonalityId;
  }

  // --- Grace --------------------------------------------------------------

  /** Close any reconnect window that has run out (GDD §4.2). */
  private sweepGrace(nowMs: number): void {
    for (const slot of this.slots) {
      if (slot.graceUntil >= 0 && slot.graceUntil <= nowMs) this.expireGrace(slot);
    }
  }

  /** The window closed: the bot keeps the seat for the rest of the match, and
   *  the token stops working. */
  private expireGrace(slot: Slot): void {
    slot.graceUntil = -1;
    slot.token = null;
    this.broadcastLobby();
  }

  // --- Sending ------------------------------------------------------------

  /**
   * Volunteer this slot's wallet when authority has moved it since the client was
   * last told (`src/net/transport` EconomyMessage): held ore, banked ore, upgrade
   * tiers — the match-lifetime state the per-tick snapshot deliberately does not
   * carry (`src/net/snapshot`).
   *
   * Sent immediately *ahead of* the snapshot for the same tick, and to that slot
   * only. The client stages it and writes it inside that tick's reconcile, so its
   * own unacknowledged mining replays on top of authority's figure instead of on
   * top of its own compounding one (`src/net/prediction` `stageEconomy`) — the
   * drift the reclaim welcome alone cannot fix, because it happens in normal
   * flight. Quiet by default: a wallet that has not moved sends nothing.
   */
  private syncEconomy(slot: Slot, world: World): void {
    // No socket, nobody told: recording a wallet against a seat a bot is flying
    // would make the next reclaimer's client miss the statement it is owed.
    if (!slot.socket) return;
    const ship = world.ships.find((s) => s.id === slot.player);
    if (!ship) return;
    const wallet = walletOf(ship);
    if (slot.wallet && sameWallet(slot.wallet, wallet)) return;
    slot.wallet = wallet;
    this.sendTo(slot, { type: 'economy', player: slot.player, tick: world.tick, economy: wallet });
  }

  private welcome(slot: Slot): void {
    // A reclaim hands the wallet back over the wire: the streaming snapshot never
    // carries a ship's cargo/bank/upgrades (`src/net/snapshot`), so a returning
    // client that rebuilds a fresh world would otherwise fly a naked ship (GDD
    // §4.2, QA m10 "economy-not-on-wire"). Present only when authority already
    // holds a live ship for this slot — a lobby join has none yet.
    const ship = this.authoritative?.ships.find((s) => s.id === slot.player);
    // What the welcome states is also what this client has now been told, so the
    // economy channel stays quiet until authority actually moves it (`syncEconomy`).
    const wallet = ship ? walletOf(ship) : null;
    slot.wallet = wallet;
    this.sendTo(slot, {
      type: 'welcome',
      you: slot.player,
      room: this.code,
      tick: this.authoritative?.tick ?? 0,
      ...(slot.token ? { reclaimToken: slot.token } : {}),
      ...(wallet ? { economy: wallet } : {}),
    });
  }

  /** RUSH!, and the arguments the world was built from — the client rebuilds the
   *  same arena from them and predicts inside it (GDD §4.2, `src/net/prediction`). */
  private sendMatchStart(slot: Slot): void {
    if (!this.authoritative) return;
    this.sendTo(slot, {
      type: 'matchStart',
      tick: this.authoritative.tick,
      seed: this.config.seed,
      slots: this.slots.map((s) => ({ player: s.player, shipClass: s.shipClass, team: s.team })),
      ...(this.config.bounds ? { bounds: { ...this.config.bounds } } : {}),
      ...(this.config.asteroidCount !== undefined
        ? { asteroidCount: this.config.asteroidCount }
        : {}),
    });
  }

  private sendSnapshot(slot: Slot, world: World): void {
    this.syncEconomy(slot, world);
    this.sendTo(slot, {
      type: 'snapshot',
      tick: world.tick,
      ackSeq: slot.ackSeq,
      payload: encodeWorldSnapshot(world),
    });
  }

  /** One encode of the world, one frame per client — each carrying that
   *  client's own `ackSeq`, which is the only per-client part of a snapshot. */
  private broadcastSnapshot(world: World): void {
    const payload = encodeWorldSnapshot(world);
    for (const slot of this.slots) {
      if (!slot.socket) continue;
      // The wallet first, when it moved: the client applies it in the reconcile the
      // snapshot on its heels triggers (`syncEconomy`).
      this.syncEconomy(slot, world);
      this.sendTo(slot, { type: 'snapshot', tick: world.tick, ackSeq: slot.ackSeq, payload });
    }
  }

  private broadcastLobby(): void {
    this.broadcast({ type: 'lobbyState', slots: this.lobbyState() });
  }

  private broadcast(message: ServerMessage | EntityEventMessage): void {
    const frame = encodeServerMessage(message);
    for (const slot of this.slots) slot.socket?.send(frame);
  }

  private sendTo(slot: Slot, message: ServerMessage): void {
    slot.socket?.send(encodeServerMessage(message));
  }
}

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

/** The wallet fields this file reads off an authoritative ship. Structural rather
 *  than `Ship` itself: the room states a wallet, it does not own one. */
interface Walleted {
  readonly cargo: number;
  readonly banked: number;
  readonly tiers: Readonly<Record<string, number>>;
}

/** One immutable reading of a ship's wallet, copied out of the live ship so the
 *  record of what a client was told cannot be mutated by the next tick. */
function walletOf(ship: Walleted): PlayerEconomy {
  return { held: ship.cargo, banked: ship.banked, tiers: { ...ship.tiers } };
}

/** True when two wallet readings say the same thing — the test for "nothing to
 *  tell this client". Exact comparison on purpose: held ore is fractional while a
 *  tractor beam is running, and rounding the comparison would let a sub-ore
 *  divergence live in the client's hold forever. */
function sameWallet(a: PlayerEconomy, b: PlayerEconomy): boolean {
  if (a.held !== b.held || a.banked !== b.banked) return false;
  const tracks = Object.keys(b.tiers);
  if (Object.keys(a.tiers).length !== tracks.length) return false;
  return tracks.every((track) => a.tiers[track] === b.tiers[track]);
}
