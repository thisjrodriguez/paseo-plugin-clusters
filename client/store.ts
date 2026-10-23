/**
 * Cluster state, one copy per connected daemon.
 *
 * Clusters belong to the daemon that serves them: the app keeps a separate state for each daemon,
 * caches it under that daemon's id, and never copies one daemon's clusters into another. A daemon
 * that comes back empty stays empty; only an edit made while looking at it is ever written to it.
 *
 * The app does not hand client contributions its own server id, so the id comes from the daemon
 * itself: it is stable per daemon (host plus PASEO_HOME) and only ever used to key the local cache.
 *
 * What the user sees is one list for every connected daemon. Each cluster is stored on one daemon
 * and shown on its own, namesakes included; a project of any daemon may be filed into any cluster.
 */

export interface Cluster {
  id: string;
  name: string;
  color: string;
  /** Letter, emoji or symbol shown in the circle; falls back to the name's initial. */
  icon?: string;
  /** An uploaded picture as a data URL; shown instead of the icon. */
  image?: string;
  /** Place in the bar among the clusters of every node, lowest first; unset ones go last. */
  order?: number;
  projects: string[];
}

export interface ClusterState {
  clusters: Cluster[];
  active: string | null;
  /**
   * Where each project sits in "Recientes", as a sortable mark (higher is nearer the top). The
   * sidebar mixes projects from every connected daemon, so the position has to survive being
   * merged with another daemon's: a plain list could not be interleaved, a mark can.
   */
  recentRank?: Record<string, number>;
  /** The same order as a list, for clients older than 0.3.0. Derived from `recentRank` on write. */
  recentOrder?: string[];
  /** How long a project stays in Recents, in hours (1–48, default 24). */
  recentHours?: number;
  /** Projects hidden from Recents, with when; they come back once used after that. */
  recentHidden?: Record<string, number>;
}

/** The part stored on the daemon and shared between its clients; `active` stays local to each app. */
export interface SharedState {
  clusters: Cluster[];
  recentRank?: Record<string, number>;
  recentOrder?: string[];
  recentHours?: number;
  recentHidden?: Record<string, number>;
  revision: number;
}

/** The daemon side of one plugin copy: its identity plus its stored clusters. */
export interface DaemonSync {
  read(): Promise<{ serverId: string; state: SharedState | null; pluginVersion?: string; paseoVersion?: string | null; hostId?: string | null; hostName?: string }>;
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
/** The selected circle of the bar, local to this app. */
const ACTIVE_KEY = `${KEY_PREFIX}:active`;
const SYNC_POLL_MS = 5000;
const PUSH_DELAY_MS = 300;

/** Returned whenever there is no daemon to speak of; a stable reference for useSyncExternalStore. */
const EMPTY: ClusterState = { clusters: [], active: null };

interface Entry extends Daemon {
  serverId: string | null;
  sync: DaemonSync;
  state: ClusterState;
  revision: number;
  /** Set once the daemon has answered a read; nothing is written to it before that. */
  loaded: boolean;
  pluginVersion: string | null;
  paseoVersion: string | null;
  hostName: string | null;
  pushTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

const entries = new Map<Daemon, Entry>();
/** Which daemon owns a sidebar project, learned from what each daemon reports about itself. */
const daemonByPath = new Map<string, Daemon>();
const daemonByKey = new Map<string, Daemon>();
const daemonByHost = new Map<string, Daemon>();
const listeners = new Set<() => void>();
let current: Entry | null = null;
let persistence: Persistence | null = null;
/** The merged clusters, rebuilt on the next read after any change. */
let merged: MergedCluster[] | null = null;
/** The connected daemons as the screen lists them, rebuilt on the next read after any change. */
let nodeList: Node[] | null = null;
/** The selected circle; undefined until first read. */
let active: string | null | undefined;

export function setPersistence(next: Persistence | null): void {
  persistence = next;
}

function notify(): void {
  merged = null;
  nodeList = null;
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
    if (parsed && Array.isArray(parsed.clusters)) return withRanks({ ...parsed, clusters: dedupe(parsed.clusters) });
  } catch {
    // Corrupt storage falls back to an empty state.
  }
  return { clusters: [], active: null };
}

function saveCache(entry: Entry): void {
  if (!entry.serverId) return;
  persistence?.write(cacheKey(entry.serverId), JSON.stringify(entry.state));
}

/** A state from before 0.3.0 carries the order as a list; read it as ranks, top of the list first. */
function withRanks(state: ClusterState): ClusterState {
  if (state.recentRank || !state.recentOrder?.length) return state;
  const order = state.recentOrder;
  const recentRank: Record<string, number> = {};
  for (const [i, key] of order.entries()) recentRank[key] = (order.length - i) * RANK_STEP;
  return { ...state, recentRank };
}

/** The ranks as the list older clients still read. */
function orderOfRanks(recentRank: Record<string, number> | undefined): string[] {
  return Object.entries(recentRank ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function sameShared(a: ClusterState, b: ClusterState): boolean {
  return (
    JSON.stringify(a.clusters) === JSON.stringify(b.clusters) &&
    JSON.stringify(a.recentRank ?? {}) === JSON.stringify(b.recentRank ?? {}) &&
    (a.recentHours ?? DEFAULT_RECENT_HOURS) === (b.recentHours ?? DEFAULT_RECENT_HOURS) &&
    JSON.stringify(a.recentHidden ?? {}) === JSON.stringify(b.recentHidden ?? {})
  );
}

/** Sends this daemon's state to that daemon, and to no other. */
function push(entry: Entry): void {
  if (entry.stopped || !entry.loaded || entry.pushTimer !== null) return;
  entry.pushTimer = setTimeout(() => {
    entry.pushTimer = null;
    if (entry.stopped) return;
    const shared: SharedState = {
      clusters: entry.state.clusters,
      recentRank: entry.state.recentRank,
      recentOrder: orderOfRanks(entry.state.recentRank),
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
  const ranked = withRanks({ ...entry.state, recentRank: shared.recentRank, recentOrder: shared.recentOrder });
  entry.state = {
    clusters: dedupe(shared.clusters),
    recentRank: ranked.recentRank,
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
    const { serverId, state, pluginVersion, paseoVersion, hostId, hostName } = await entry.sync.read();
    if (entry.stopped) return;
    identify(entry, serverId);
    if (hostId) registerHost(entry, hostId);
    entry.loaded = true;
    if (
      entry.pluginVersion !== (pluginVersion ?? null) ||
      entry.paseoVersion !== (paseoVersion ?? null) ||
      entry.hostName !== (hostName ?? null)
    ) {
      entry.pluginVersion = pluginVersion ?? null;
      entry.paseoVersion = paseoVersion ?? null;
      entry.hostName = hostName ?? null;
      notify();
    }
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
    loaded: false,
    pluginVersion: null,
    paseoVersion: null,
    hostName: null,
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
  for (const [path, owner] of daemonByPath) if (owner === daemon) daemonByPath.delete(path);
  for (const [key, owner] of daemonByKey) if (owner === daemon) daemonByKey.delete(key);
  for (const [host, owner] of daemonByHost) if (owner === daemon) daemonByHost.delete(host);
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

/** The projects of one daemon, as the sidebar keys them. Local ones are matched by path. */
export function registerProjectPath(daemon: Daemon, path: string): void {
  if (path && entries.has(daemon)) daemonByPath.set(path.toLowerCase(), daemon);
}

/** The app's id for the host a daemon serves, as the Clusters screen of that host reports it. */
export function registerHost(daemon: Daemon, hostId: string): void {
  if (!hostId || !entries.has(daemon) || daemonByHost.get(hostId) === daemon) return;
  daemonByHost.set(hostId, daemon);
  notify();
}

/** The app's id for the host a daemon serves, once known. */
export function hostIdOf(daemon: Daemon): string | null {
  for (const [host, owner] of daemonByHost) if (owner === daemon) return host;
  return null;
}

/** The app's id for the host a sidebar project lives on. */
export function hostIdOfKey(key: string): string | null {
  const local = /^host:([^:]+):/.exec(key);
  if (local) return local[1];
  const daemon = daemonOfKey(key);
  return daemon ? hostIdOf(daemon) : null;
}

/** The names the app gives its hosts, kept so the sidebar can use them without the screen open. */
const HOST_LABELS_KEY = `${KEY_PREFIX}:host-labels`;
let hostLabels: Record<string, string> | null = null;

function labels(): Record<string, string> {
  if (!hostLabels) {
    try {
      hostLabels = JSON.parse(persistence?.read(HOST_LABELS_KEY) ?? "{}") as Record<string, string>;
    } catch {
      hostLabels = {};
    }
  }
  return hostLabels;
}

export function setHostLabels(next: Record<string, string>): void {
  const merged = { ...labels(), ...next };
  if (JSON.stringify(merged) === JSON.stringify(labels())) return;
  hostLabels = merged;
  persistence?.write(HOST_LABELS_KEY, JSON.stringify(merged));
  notify();
}

/** The name of the node a sidebar project lives on: the app's label, else the machine's name. */
export function nodeLabelOfKey(key: string): string | null {
  const hostId = hostIdOfKey(key);
  if (hostId && labels()[hostId]) return labels()[hostId];
  const daemon = daemonOfKey(key) ?? (hostId ? (daemonByHost.get(hostId) ?? null) : null);
  const entry = daemon ? entries.get(daemon) : undefined;
  return entry?.hostName ?? hostId;
}

/** The name of a daemon's node: the app's label for its host, else the machine's name. */
export function nodeLabelOf(daemon: Daemon): string | null {
  const entry = entries.get(daemon);
  if (!entry) return null;
  const hostId = hostIdOf(entry);
  return (hostId && labels()[hostId]) || entry.hostName || hostId;
}

/** How many daemons have answered; node names only help once there is more than one. */
export function loadedCount(): number {
  let count = 0;
  for (const entry of entries.values()) if (entry.loaded) count += 1;
  return count;
}

/** One connected daemon, with the versions it reported. */
export interface Node {
  daemon: Daemon;
  hostId: string | null;
  pluginVersion: string | null;
  paseoVersion: string | null;
}

export function nodes(): Node[] {
  nodeList ??= Array.from(entries.values())
    .filter((entry) => entry.loaded)
    .map((entry) => ({
      daemon: entry,
      hostId: hostIdOf(entry),
      pluginVersion: entry.pluginVersion,
      paseoVersion: entry.paseoVersion,
    }));
  return nodeList;
}

export function registerProjectKey(daemon: Daemon, key: string): void {
  if (key && entries.has(daemon)) daemonByKey.set(key, daemon);
}

/**
 * The daemon a sidebar project belongs to. Local keys carry the app's own id for the host, which
 * the app never tells plugins; matching one project's path to the daemon that reported it names
 * that id for every other key under it.
 */
export function daemonOfKey(key: string): Daemon | null {
  const known = daemonByKey.get(key);
  if (known) return entries.has(known) ? known : null;
  const local = /^host:([^:]+):(.*)$/.exec(key);
  if (!local) return null;
  const [, host, path] = local;
  // Case is not compared: daemons report paths lowercased, the sidebar keeps them as typed.
  const byPath = daemonByPath.get(path.toLowerCase());
  if (byPath && entries.has(byPath)) {
    if (daemonByHost.get(host) !== byPath) {
      daemonByHost.set(host, byPath);
      nodeList = null;
    }
    return byPath;
  }
  const byHost = daemonByHost.get(host);
  return byHost && entries.has(byHost) ? byHost : null;
}

/** Reading and writing one project's Recents state on the daemon that owns it. */
export function stateOfKey(key: string): ClusterState | null {
  const daemon = daemonOfKey(key);
  return daemon ? getState(daemon) : null;
}

export const RANK_STEP = 1000;

export function rankOf(key: string): number | undefined {
  return stateOfKey(key)?.recentRank?.[key];
}

/** Every project in Recents across the connected daemons, nearest the top first. */
export function recentKeys(): string[] {
  const ranked: { key: string; rank: number }[] = [];
  for (const entry of entries.values()) {
    for (const [key, rank] of Object.entries(entry.state.recentRank ?? {})) ranked.push({ key, rank });
  }
  return ranked.sort((a, b) => b.rank - a.rank).map((r) => r.key);
}

/** Highest rank in use anywhere, so a project entering Recents lands on top of all of them. */
export function topRank(): number {
  let top = 0;
  for (const entry of entries.values()) {
    for (const rank of Object.values(entry.state.recentRank ?? {})) top = Math.max(top, rank);
  }
  return top;
}

/** Writes ranks home: each project's rank is stored on its own daemon, never on another. */
export function setRanks(changes: Map<string, number | null>): void {
  const byDaemon = new Map<Daemon, Map<string, number | null>>();
  for (const [key, rank] of changes) {
    const daemon = daemonOfKey(key);
    if (!daemon) continue;
    const group = byDaemon.get(daemon) ?? new Map<string, number | null>();
    group.set(key, rank);
    byDaemon.set(daemon, group);
  }
  for (const [daemon, group] of byDaemon) {
    const state = getState(daemon);
    const next = { ...(state.recentRank ?? {}) };
    let changed = false;
    for (const [key, rank] of group) {
      if (rank === null) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      } else if (next[key] !== rank) {
        next[key] = rank;
        changed = true;
      }
    }
    if (changed) setState(daemon, { ...state, recentRank: next });
  }
}

/**
 * One cluster as the user sees it. Every cluster lives on one daemon (its home) and is shown on its
 * own, even when another daemon has one with the same name; it may hold projects of any daemon.
 */
export interface MergedCluster extends Cluster {
  /** The daemon that stores it, and its id there. Always exactly one. */
  members: { daemon: Daemon; id: string }[];
}

/** The id a cluster is known by across the app: its home daemon plus its id there. */
function clusterKeyOf(entry: Entry, cluster: Cluster): string {
  return `${entry.serverId ?? "?"}:${cluster.id}`;
}

const ORDER_STEP = 1000;

function newClusterId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Entries with the one the sidebar is showing first, so its clusters lead. */
function orderedEntries(): Entry[] {
  const all = Array.from(entries.values());
  return current ? [current, ...all.filter((e) => e !== current)] : all;
}

/** Every connected daemon's clusters, each on its own. */
export function mergedClusters(): MergedCluster[] {
  if (merged) return merged;
  const all = orderedEntries()
    .filter((entry) => entry.serverId)
    .flatMap((entry) =>
      entry.state.clusters.map((cluster) => ({
        ...cluster,
        id: clusterKeyOf(entry, cluster),
        members: [{ daemon: entry as Daemon, id: cluster.id }],
      })),
    );
  // Clusters of different nodes interleave by their shared order; unordered ones keep their place
  // after the ordered ones.
  const place = (c: MergedCluster, i: number) => c.order ?? Number.MAX_SAFE_INTEGER / 2 + i;
  const placed = all.map((c, i) => ({ c, at: place(c, i) }));
  merged = placed.sort((a, b) => a.at - b.at).map(({ c }) => c);
  return merged;
}

function homeOf(id: string): { entry: Entry; own: string } | null {
  const target = mergedClusters().find((c) => c.id === id);
  const member = target?.members[0];
  const entry = member ? entries.get(member.daemon) : undefined;
  return entry && member ? { entry, own: member.id } : null;
}

/** The selected circle: null for Recents, ALL_ID, or a cluster id. */
export function getActive(): string | null {
  if (active === undefined) {
    try {
      const saved = persistence?.read(ACTIVE_KEY);
      active = saved === null || saved === undefined ? null : (JSON.parse(saved) as string | null);
    } catch {
      active = null;
    }
  }
  if (active === null || active === ALL_ID) return active;
  // A cluster deleted elsewhere falls back to Recents; it is not forgotten while daemons load.
  return mergedClusters().some((c) => c.id === active) ? active : null;
}

export function setActive(next: string | null): void {
  if (getActive() === next) return;
  active = next;
  persistence?.write(ACTIVE_KEY, JSON.stringify(next));
  notify();
}

function editClusters(entry: Entry, edit: (clusters: Cluster[]) => Cluster[]): void {
  const next = edit(entry.state.clusters);
  if (JSON.stringify(next) !== JSON.stringify(entry.state.clusters)) setState(entry, { ...entry.state, clusters: next });
}

/** A new cluster stored on one daemon. Returns its id. */
export function createCluster(daemon: Daemon, draft: Pick<Cluster, "name" | "color" | "icon" | "image">): string | null {
  const entry = entries.get(daemon);
  if (!entry) return null;
  const last = Math.max(-ORDER_STEP, ...mergedClusters().map((c) => c.order ?? -ORDER_STEP));
  const cluster = { id: newClusterId(), ...draft, projects: [], order: last + ORDER_STEP };
  editClusters(entry, (clusters) => [...clusters, cluster]);
  return clusterKeyOf(entry, cluster);
}

/** Renames or recolours one cluster; namesakes on other daemons are left alone. */
export function updateCluster(id: string, patch: Partial<Pick<Cluster, "name" | "color" | "icon" | "image">>): void {
  const home = homeOf(id);
  if (home) editClusters(home.entry, (clusters) => clusters.map((c) => (c.id === home.own ? { ...c, ...patch } : c)));
}

/** Deletes one cluster; namesakes on other daemons are left alone. Its projects are left in none. */
export function deleteCluster(id: string): void {
  const home = homeOf(id);
  if (!home) return;
  if (getActive() === id) setActive(null);
  editClusters(home.entry, (clusters) => clusters.filter((c) => c.id !== home.own));
}

/**
 * Files a project into one cluster, or into none. A project of any daemon may join any cluster; it
 * is written to the cluster's home and dropped from every other cluster on every daemon.
 */
export function moveProject(key: string, id: string | null): MergedCluster | null {
  const target = id === null ? null : (mergedClusters().find((c) => c.id === id) ?? null);
  if (id !== null && !target) return null;
  const home = target ? homeOf(target.id) : null;
  for (const entry of entries.values()) {
    editClusters(entry, (clusters) =>
      clusters.map((c) => {
        const projects = c.projects.filter((p) => p !== key);
        if (home && entry === home.entry && c.id === home.own) projects.push(key);
        return { ...c, projects };
      }),
    );
  }
  return target;
}

/** Puts the clusters in this order; each daemon stores the order of its own. */
export function reorderClusters(ids: readonly string[]): void {
  for (const entry of entries.values()) {
    const rank = (c: Cluster) => {
      const i = ids.indexOf(clusterKeyOf(entry, c));
      return i === -1 ? ids.length : i;
    };
    // Each node stores the shared place of its own clusters, so every app interleaves them alike.
    editClusters(entry, (clusters) =>
      [...clusters].sort((a, b) => rank(a) - rank(b)).map((c) => ({ ...c, order: rank(c) * ORDER_STEP })),
    );
  }
}

/** Puts these projects first, in this order, in one cluster. */
export function reorderProjects(id: string, ordered: readonly string[]): void {
  const home = homeOf(id);
  if (!home) return;
  editClusters(home.entry, (clusters) =>
    clusters.map((c) => {
      if (c.id !== home.own) return c;
      const first = ordered.filter((key) => c.projects.includes(key));
      return { ...c, projects: [...first, ...c.projects.filter((key) => !ordered.includes(key))] };
    }),
  );
}

/** Test seam: drops every daemon and listener. */
export function resetStore(): void {
  for (const daemon of Array.from(entries.keys())) stopDaemon(daemon);
  daemonByPath.clear();
  daemonByKey.clear();
  daemonByHost.clear();
  listeners.clear();
  current = null;
  persistence = null;
  merged = null;
  nodeList = null;
  active = undefined;
  hostLabels = null;
}
