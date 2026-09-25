/**
 * Cluster state, one copy per connected daemon.
 *
 * Clusters belong to the daemon that serves them: the app keeps a separate state for each daemon,
 * caches it under that daemon's id, and never copies one daemon's clusters into another. A daemon
 * that comes back empty stays empty; only an edit made while looking at it is ever written to it.
 *
 * The app does not hand client contributions its own server id, so the id comes from the daemon
 * itself: it is stable per daemon (host plus PASEO_HOME) and only ever used to key the local cache.
 */

export interface Cluster {
  id: string;
  name: string;
  color: string;
  /** Letter, emoji or symbol shown in the circle; falls back to the name's initial. */
  icon?: string;
  projects: string[];
}

export interface ClusterState {
  clusters: Cluster[];
  active: string | null;
  /** Manual order of "Recientes": new projects enter on top, existing ones keep their place. */
  recentOrder?: string[];
  /** How long a project stays in Recents, in hours (1–48, default 24). */
  recentHours?: number;
  /** Projects hidden from Recents, with when; they come back once used after that. */
  recentHidden?: Record<string, number>;
}

/** The part stored on the daemon and shared between its clients; `active` stays local to each app. */
export interface SharedState {
  clusters: Cluster[];
  recentOrder?: string[];
  recentHours?: number;
  recentHidden?: Record<string, number>;
  revision: number;
}

/** The daemon side of one plugin copy: its identity plus its stored clusters. */
export interface DaemonSync {
  read(): Promise<{ serverId: string; state: SharedState | null }>;
  write(state: SharedState): Promise<void>;
}

/** A connected daemon. The handle is what tells the store whose clusters a call is about. */
export interface Daemon {
  /** Known once the daemon has answered its first read. */
  readonly serverId: string | null;
}

/** Where the local cache lives. The web client backs this with localStorage. */
export interface Persistence {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export const ALL_ID = "__all__";
export const DEFAULT_RECENT_HOURS = 24;
export const MIN_RECENT_HOURS = 1;
export const MAX_RECENT_HOURS = 48;

const KEY_PREFIX = "paseo-clusters:v1";
/** Which daemon the sidebar is showing, so it survives a reload. */
const CURRENT_KEY = `${KEY_PREFIX}:current`;
const SYNC_POLL_MS = 5000;
const PUSH_DELAY_MS = 300;

/** Returned whenever there is no daemon to speak of; a stable reference for useSyncExternalStore. */
const EMPTY: ClusterState = { clusters: [], active: null };

interface Entry extends Daemon {
  serverId: string | null;
  sync: DaemonSync;
  state: ClusterState;
  revision: number;
  pushTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

const entries = new Map<Daemon, Entry>();
const listeners = new Set<() => void>();
let current: Entry | null = null;
let persistence: Persistence | null = null;

export function setPersistence(next: Persistence | null): void {
  persistence = next;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Redraws everything watching the store after a change it does not hold itself (the language). */
export function notifyListeners(): void {
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dedupe(clusters: Cluster[]): Cluster[] {
  const seen = new Set<string>();
  return clusters.map((cluster) => ({
    ...cluster,
    projects: cluster.projects.filter((key) => !seen.has(key) && (seen.add(key), true)),
  }));
}

function cacheKey(serverId: string): string {
  return `${KEY_PREFIX}:${serverId}`;
}

/** The cached clusters of one daemon, read only under that daemon's own key. */
function loadCache(serverId: string): ClusterState {
  try {
    const raw = persistence?.read(cacheKey(serverId)) ?? null;
    const parsed = JSON.parse(raw ?? "null") as ClusterState | null;
    if (parsed && Array.isArray(parsed.clusters)) return { ...parsed, clusters: dedupe(parsed.clusters) };
  } catch {
    // Corrupt storage falls back to an empty state.
  }
  return { clusters: [], active: null };
}

function saveCache(entry: Entry): void {
  if (!entry.serverId) return;
  persistence?.write(cacheKey(entry.serverId), JSON.stringify(entry.state));
}

function sameShared(a: ClusterState, b: ClusterState): boolean {
  return (
    JSON.stringify(a.clusters) === JSON.stringify(b.clusters) &&
    JSON.stringify(a.recentOrder ?? []) === JSON.stringify(b.recentOrder ?? []) &&
    (a.recentHours ?? DEFAULT_RECENT_HOURS) === (b.recentHours ?? DEFAULT_RECENT_HOURS) &&
    JSON.stringify(a.recentHidden ?? {}) === JSON.stringify(b.recentHidden ?? {})
  );
}

/** Sends this daemon's state to that daemon, and to no other. */
function push(entry: Entry): void {
  if (entry.stopped || entry.pushTimer !== null) return;
  entry.pushTimer = setTimeout(() => {
    entry.pushTimer = null;
    if (entry.stopped) return;
    const shared: SharedState = {
      clusters: entry.state.clusters,
      recentOrder: entry.state.recentOrder,
      recentHours: entry.state.recentHours,
      recentHidden: entry.state.recentHidden,
      revision: entry.revision,
    };
    void entry.sync.write(shared).catch((error: unknown) => {
      console.warn("[paseo-clusters] Could not save to the daemon", error);
    });
  }, PUSH_DELAY_MS);
}

/**
 * Hidden projects only ever gain entries, so copies are merged rather than replaced: a daemon or
 * client still on an older version drops the field and must not bring hidden projects back.
 */
function mergeHidden(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!a || !b) return a ?? b;
  const merged = { ...a };
  for (const [key, at] of Object.entries(b)) merged[key] = Math.max(merged[key] ?? 0, at);
  return merged;
}

/** Takes the daemon's copy: it is the source of truth for its own clusters. */
function adopt(entry: Entry, incoming: SharedState): void {
  const shared = { ...incoming, recentHidden: mergeHidden(entry.state.recentHidden, incoming.recentHidden) };
  if (shared.revision <= entry.revision && sameShared(entry.state, { ...entry.state, ...shared })) return;
  if (shared.revision < entry.revision) return;
  entry.revision = shared.revision;
  const active = entry.state.active;
  entry.state = {
    clusters: dedupe(shared.clusters),
    recentOrder: shared.recentOrder,
    recentHours: shared.recentHours,
    recentHidden: shared.recentHidden,
    active: active !== null && active !== ALL_ID && !shared.clusters.some((c) => c.id === active) ? null : active,
  };
  saveCache(entry);
  notify();
}

/**
 * Names the daemon on its first answer and loads that daemon's cache. State already held under
 * another daemon's id stays there: nothing is carried over.
 */
function identify(entry: Entry, serverId: string): void {
  if (entry.serverId === serverId) return;
  entry.serverId = serverId;
  entry.state = loadCache(serverId);
  entry.revision = 0;
  if (persistence?.read(CURRENT_KEY) === serverId) current = entry;
  notify();
}

/** One round trip: read the daemon's copy and take it if it is not behind ours. */
export async function pull(daemon: Daemon): Promise<void> {
  const entry = entries.get(daemon);
  if (!entry || entry.stopped) return;
  try {
    const { serverId, state } = await entry.sync.read();
    if (entry.stopped) return;
    identify(entry, serverId);
    // A daemon with no clusters yet keeps none: the client never seeds it with its own.
    if (state && state.revision >= entry.revision) adopt(entry, state);
  } catch (error) {
    console.warn("[paseo-clusters] Could not read from the daemon", error);
  }
}

export interface DaemonOptions {
  /** How often to refresh from the daemon. 0 polls only when `pull` is called. */
  pollMs?: number;
}

/** Connects one daemon to the store: initial read, periodic refresh, and write-through. */
export function startDaemon(sync: DaemonSync, options: DaemonOptions = {}): Daemon {
  const entry: Entry = {
    serverId: null,
    sync,
    state: EMPTY,
    revision: 0,
    pushTimer: null,
    pollTimer: null,
    stopped: false,
  };
  entries.set(entry, entry);
  current ??= entry;
  const pollMs = options.pollMs ?? SYNC_POLL_MS;
  void pull(entry);
  if (pollMs > 0) entry.pollTimer = setInterval(() => void pull(entry), pollMs);
  notify();
  return entry;
}

export function stopDaemon(daemon: Daemon): void {
  const entry = entries.get(daemon);
  if (!entry) return;
  entry.stopped = true;
  if (entry.pollTimer !== null) clearInterval(entry.pollTimer);
  if (entry.pushTimer !== null) clearTimeout(entry.pushTimer);
  entries.delete(daemon);
  if (current === entry) current = entries.values().next().value ?? null;
  notify();
}

/** The daemon the sidebar is showing. */
export function currentDaemon(): Daemon | null {
  return current;
}

/** Points the sidebar at a daemon; the Clusters screen calls this for the daemon it belongs to. */
export function focusDaemon(daemon: Daemon): void {
  const entry = entries.get(daemon);
  if (!entry || current === entry) return;
  current = entry;
  if (entry.serverId) persistence?.write(CURRENT_KEY, entry.serverId);
  notify();
}

export function getState(daemon: Daemon | null): ClusterState {
  return (daemon && entries.get(daemon)?.state) || EMPTY;
}

/** An edit made while looking at one daemon, written to that daemon alone. */
export function setState(daemon: Daemon | null, next: ClusterState): void {
  const entry = daemon && entries.get(daemon);
  if (!entry) return;
  const changed = !sameShared(entry.state, next);
  entry.state = next;
  if (changed) entry.revision += 1;
  saveCache(entry);
  if (changed) push(entry);
  notify();
}

/** Test seam: drops every daemon and listener. */
export function resetStore(): void {
  for (const daemon of Array.from(entries.keys())) stopDaemon(daemon);
  listeners.clear();
  current = null;
  persistence = null;
}
