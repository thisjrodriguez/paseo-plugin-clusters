import { Platform } from "react-native";

// Desktop/web only: the native sidebar is manipulated through the DOM.
// This plugin typechecks without the DOM library. Declare only what this module uses.
interface El {
  readonly parentElement: El | null;
  readonly children: ArrayLike<El>;
  readonly isConnected: boolean;
  textContent: string | null;
  innerHTML: string;
  title: string;
  style: Record<string, string>;
  onclick: (() => void) | null;
  onmouseenter: (() => void) | null;
  onmouseleave: (() => void) | null;
  getBoundingClientRect(): { left: number; top: number; bottom: number; width: number; height: number };
  readonly offsetWidth: number;
  closest(selector: string): El | null;
  setPointerCapture?(pointerId: number): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  insertBefore(node: El, ref: El | null): void;
  appendChild(node: El): void;
  replaceChildren(...nodes: El[]): void;
  remove(): void;
  contains(node: El): boolean;
}
interface PointerLike {
  readonly pointerId?: number;
  readonly type?: string;
  readonly target: unknown;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}
declare const document: {
  readonly body: El;
  elementsFromPoint(x: number, y: number): El[];
  addEventListener(type: string, listener: (event: PointerLike) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: PointerLike) => void, capture: boolean): void;
  createElement(tag: string): El;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
};
declare const localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
declare class MutationObserver {
  constructor(cb: () => void);
  observe(target: El, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}
declare function requestAnimationFrame(cb: () => void): number;
declare const window: {
  readonly innerWidth: number;
  addEventListener(type: string, listener: (event: PointerLike) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: PointerLike) => void, capture: boolean): void;
};
declare function setTimeout(cb: () => void, ms: number): number;
declare function setInterval(cb: () => void, ms: number): number;
declare function clearInterval(id: number): void;

export const isWeb = Platform.OS === "web";

export const COLORS = ["#3b82f6", "#ef4444", "#f97316", "#10b981", "#a855f7", "#eab308", "#ec4899", "#14b8a6"];

export interface Cluster {
  id: string;
  name: string;
  color: string;
  /** Letter, emoji or symbol shown in the circle; falls back to the name's initial. */
  icon?: string;
  projects: string[];
}
export function clusterIcon(cluster: Pick<Cluster, "name" | "icon">): string {
  const icon = cluster.icon?.trim();
  return icon ? Array.from(icon).slice(0, 2).join("") : (Array.from(cluster.name.trim())[0] ?? "?").toUpperCase();
}

export interface ClusterState {
  clusters: Cluster[];
  active: string | null;
  /** Manual order of "Recientes": new projects enter on top, existing ones keep their place. */
  recentOrder?: string[];
}

const STORAGE_KEY = "paseo-clusters:v1";
const ROW_PREFIX = "sidebar-project-row-";
const BAR_ID = "paseo-clusters-bar";
const SYNC_POLL_MS = 5000;
export const ALL_ID = "__all__";

/** Clusters live on the daemon so every client of that host shares them. */
export interface ClusterSync {
  read(): Promise<SharedState | null>;
  write(state: SharedState): Promise<void>;
}

/** The part shared between clients; `active` stays local to each app. */
export interface SharedState {
  clusters: Cluster[];
  recentOrder?: string[];
  revision: number;
}

let state: ClusterState = load();
let revision = 0;
let sync: ClusterSync | null = null;
let pushTimer: number | null = null;
const listeners = new Set<() => void>();

function dedupe(clusters: Cluster[]): Cluster[] {
  const seen = new Set<string>();
  return clusters.map((cluster) => ({
    ...cluster,
    projects: cluster.projects.filter((key) => !seen.has(key) && (seen.add(key), true)),
  }));
}

function load(): ClusterState {
  if (!isWeb) return { clusters: [], active: null };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ClusterState | null;
    if (parsed && Array.isArray(parsed.clusters)) return { ...parsed, clusters: dedupe(parsed.clusters) };
  } catch {
    // Corrupt storage falls back to an empty state.
  }
  return { clusters: [], active: null };
}

function sameShared(a: ClusterState, b: ClusterState): boolean {
  return (
    JSON.stringify(a.clusters) === JSON.stringify(b.clusters) &&
    JSON.stringify(a.recentOrder ?? []) === JSON.stringify(b.recentOrder ?? [])
  );
}

function push(): void {
  if (!sync || pushTimer !== null) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const shared: SharedState = { clusters: state.clusters, recentOrder: state.recentOrder, revision };
    void sync?.write(shared).catch((error: unknown) => {
      console.warn("[paseo-clusters] No se pudo guardar en el daemon", error);
    });
  }, 300);
}

function adopt(shared: SharedState): void {
  if (shared.revision <= revision && sameShared(state, { ...state, ...shared })) return;
  if (shared.revision < revision) return;
  revision = shared.revision;
  const active = state.active;
  state = {
    clusters: dedupe(shared.clusters),
    recentOrder: shared.recentOrder,
    active: active !== null && active !== ALL_ID && !shared.clusters.some((c) => c.id === active) ? null : active,
  };
  if (isWeb) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  for (const listener of listeners) listener();
}

/** Connects the store to the daemon: initial read, periodic refresh, and write-through. */
export function startSync(bridge: ClusterSync): () => void {
  sync = bridge;
  let stopped = false;
  const pull = async () => {
    try {
      const shared = await bridge.read();
      if (stopped) return;
      if (shared) adopt(shared);
      else if (state.clusters.length > 0) push();
    } catch (error) {
      console.warn("[paseo-clusters] No se pudo leer del daemon", error);
    }
  };
  void pull();
  const timer = setInterval(() => void pull(), SYNC_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    sync = null;
  };
}

export function getState(): ClusterState {
  return state;
}

export function setState(next: ClusterState): void {
  const changed = !sameShared(state, next);
  state = next;
  if (changed) revision += 1;
  if (isWeb) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (changed) push();
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface SidebarProject {
  key: string;
  label: string;
}

export function listSidebarProjects(): SidebarProject[] {
  if (!isWeb) return [];
  return Array.from(document.querySelectorAll(`[data-testid^="${ROW_PREFIX}"]`)).map((row) => {
    const key = (row.getAttribute("data-testid") ?? "").slice(ROW_PREFIX.length);
    const fromKey = key.split(/[\\/]/).pop() ?? key;
    return { key, label: row.getAttribute("aria-label") || fromKey };
  });
}

function projectGroups(): { group: El; key: string }[] {
  const first = document.querySelector(`[data-testid^="${ROW_PREFIX}"]`);
  let list: El | null = first;
  // Climb to the container whose direct children are the per-project groups.
  while (list && list.querySelectorAll(`[data-testid^="${ROW_PREFIX}"]`).length < 2) list = list.parentElement;
  if (!list) {
    return first ? [{ group: first, key: (first.getAttribute("data-testid") ?? "").slice(ROW_PREFIX.length) }] : [];
  }
  const out: { group: El; key: string }[] = [];
  for (const child of Array.from(list.children)) {
    const row = child.querySelector(`[data-testid^="${ROW_PREFIX}"]`);
    if (row) out.push({ group: child, key: (row.getAttribute("data-testid") ?? "").slice(ROW_PREFIX.length) });
  }
  return out;
}

const WORKSPACE_PREFIX = "sidebar-workspace-row-";

export type WorkspaceStatus = "running" | "attention" | "needs_input" | "failed" | "done";

export interface WorkspaceActivity {
  at: number;
  projectPath: string;
  status?: WorkspaceStatus | null;
}

/** Last activity per workspace id, kept live from the Paseo API. */
const activity = new Map<string, WorkspaceActivity>();
let filterScheduled = false;

function scheduleFilter(): void {
  if (filterScheduled || !isWeb) return;
  filterScheduled = true;
  requestAnimationFrame(() => {
    filterScheduled = false;
    applyFilter();
  });
}

export function setWorkspaceActivity(id: string, next: WorkspaceActivity): void {
  const current = activity.get(id);
  const status = next.status === undefined ? current?.status : next.status;
  if (
    current &&
    current.at >= next.at &&
    current.projectPath === next.projectPath &&
    current.status === status
  ) {
    return;
  }
  activity.set(id, {
    at: Math.max(next.at, current?.at ?? 0),
    projectPath: next.projectPath || current?.projectPath || "",
    status,
  });
  scheduleFilter();
}

export function touchWorkspace(id: string, at: number): void {
  const current = activity.get(id);
  setWorkspaceActivity(id, { at, projectPath: current?.projectPath ?? "", status: current?.status });
}

export function removeWorkspace(id: string): void {
  if (activity.delete(id)) scheduleFilter();
}

function activityAt(id: string): number {
  return activity.get(id)?.at ?? 0;
}

function projectPathOfKey(key: string): string {
  return key.startsWith("host:") ? key.replace(/^host:[^:]+:/, "").toLowerCase() : "";
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DISPLAY_PREFERENCES = '[data-testid="sidebar-display-preferences-menu"]';

function workspaceId(row: El): string {
  return (row.getAttribute("data-testid") ?? "").split(":").pop() ?? "";
}

/** The element that holds one workspace row inside its project group. */
function workspaceItem(row: El): El {
  return row.parentElement?.parentElement ?? row;
}

function setDisplay(el: El, hide: boolean): void {
  const want = hide ? "none" : "";
  if (el.style.display !== want) el.style.display = want;
}

/** Workspaces seen under each project, so collapsed projects keep their recency. */
const knownWorkspaces = new Map<string, Set<string>>();

/** Sidebar projects already seen; null until the list first renders. */
let seenProjects: Set<string> | null = null;

/** Files projects that appear while a cluster is selected into that cluster. */
function adoptNewProjects(groups: { key: string }[]): void {
  if (groups.length === 0) return;
  if (!seenProjects) {
    seenProjects = new Set(groups.map((g) => g.key));
    return;
  }
  const fresh = groups.map((g) => g.key).filter((key) => !seenProjects?.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) seenProjects.add(key);
  const cluster = state.clusters.find((c) => c.id === state.active);
  if (!cluster) return;
  const assigned = new Set(state.clusters.flatMap((c) => c.projects));
  const toAdd = fresh.filter((key) => !assigned.has(key));
  if (toAdd.length === 0) return;
  setState({
    ...state,
    clusters: state.clusters.map((c) => (c.id === cluster.id ? { ...c, projects: [...c.projects, ...toAdd] } : c)),
  });
}

/** The display-preferences button plus any wrapper that only holds it (Paseo hangs the tooltip there). */
function preferencesTarget(): El | null {
  let el = document.querySelector(DISPLAY_PREFERENCES);
  while (el?.parentElement && el.parentElement.children.length === 1) el = el.parentElement;
  return el;
}

/**
 * Keeps "Recientes" stable: expired projects drop out, newly active ones enter on top,
 * and everything else stays where it was (or where the user dragged it).
 */
function syncRecentOrder(
  groups: { key: string }[],
  eligible: (key: string) => boolean,
  latestByKey: Map<string, number>,
): string[] {
  const previous = state.recentOrder ?? [];
  // Until activity has loaded, every project looks idle; don't prune the saved order yet.
  if (groups.length === 0 || activity.size === 0) return previous;
  const present = new Set(groups.map((g) => g.key));
  const kept = previous.filter((key) => !present.has(key) || eligible(key));
  const incoming = groups
    .map((g) => g.key)
    .filter((key) => eligible(key) && !kept.includes(key))
    .sort((a, b) => (latestByKey.get(b) ?? 0) - (latestByKey.get(a) ?? 0));
  const next = [...incoming, ...kept];
  if (next.length !== previous.length || next.some((key, i) => key !== previous[i])) {
    setState({ ...state, recentOrder: next });
  }
  return next;
}

function applyFilter(): void {
  const groups = projectGroups();
  adoptNewProjects(groups);
  const recent = state.active === null;
  const cluster = state.clusters.find((c) => c.id === state.active) ?? null;
  const inAnyCluster = new Set(state.clusters.flatMap((c) => c.projects));
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const latestByKey = new Map<string, number>();

  for (const { group, key } of groups) {
    let latest = 0;
    const known = knownWorkspaces.get(key) ?? new Set<string>();
    knownWorkspaces.set(key, known);
    for (const row of Array.from(group.querySelectorAll(`[data-testid^="${WORKSPACE_PREFIX}"]`))) {
      known.add(workspaceId(row));
    }
    const path = projectPathOfKey(key);
    if (path) {
      for (const [id, info] of activity) if (info.projectPath === path) known.add(id);
    }
    for (const id of known) {
      const at = activityAt(id);
      if (at >= cutoff) latest = Math.max(latest, at);
    }
    for (const row of Array.from(group.querySelectorAll(`[data-testid^="${WORKSPACE_PREFIX}"]`))) {
      const at = activityAt(workspaceId(row));
      const fresh = at >= cutoff;
      setDisplay(workspaceItem(row), recent && !fresh);
      const item = workspaceItem(row);
      if (item.style.order) item.style.order = "";
    }
    latestByKey.set(key, latest);
  }

  // "Recientes" is ordered by use, so Paseo's sort/display menu is hidden only there.
  const preferences = preferencesTarget();
  // Hidden but still laid out, so the header keeps its height and nothing jumps.
  if (preferences) {
    const visibility = recent ? "hidden" : "";
    if (preferences.style.visibility !== visibility) {
      Object.assign(preferences.style, { visibility, pointerEvents: recent ? "none" : "" });
    }
  }

  const eligible = (key: string) =>
    (latestByKey.get(key) ?? 0) > 0 && (inAnyCluster.size === 0 || inAnyCluster.has(key));
  const recentOrder = recent ? syncRecentOrder(groups, eligible, latestByKey) : [];
  for (const { group, key } of groups) {
    const hide = cluster ? !cluster.projects.includes(key) : recent && !recentOrder.includes(key);
    setDisplay(group, hide);
    const order = recent
      ? String(recentOrder.indexOf(key))
      : cluster && cluster.projects.includes(key)
        ? String(cluster.projects.indexOf(key))
        : "";
    if (group.style.order !== order) group.style.order = order;
  }
  updateRings();
}

const PLUS_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const LAYERS_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>';
const BOLT_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';

interface CircleOptions {
  label: string;
  clusterId?: string;
  ringKey?: string;
  tooltipText?: string;
  active: boolean;
  onClick: () => void;
  text?: string;
  svg?: string;
  style: Record<string, string>;
}

let tooltip: El | null = null;

function showTooltip(anchor: El, text: string): void {
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "99999",
      pointerEvents: "none",
      padding: "4px 8px",
      borderRadius: "6px",
      background: "#18181b",
      color: "#fafafa",
      fontSize: "12px",
      fontFamily: "inherit",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
    });
  }
  const rect = anchor.getBoundingClientRect();
  tooltip.textContent = text;
  Object.assign(tooltip.style, { left: "0px", top: `${rect.bottom + 6}px`, display: "block" });
  if (!tooltip.isConnected) document.body.appendChild(tooltip);
  const margin = 8;
  const width = tooltip.offsetWidth;
  const centered = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(margin, Math.min(centered, window.innerWidth - width - margin));
  tooltip.style.left = `${left}px`;
}

function hideTooltip(): void {
  if (tooltip) tooltip.style.display = "none";
}

function circle({ label, clusterId, ringKey, tooltipText, active, onClick, text, svg, style }: CircleOptions): El {
  const item = document.createElement("div");
  Object.assign(item.style, {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    flex: "0 0 auto",
  });
  const el = document.createElement("div");
  if (svg) el.innerHTML = svg;
  else el.textContent = text ?? "";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", label);
  el.setAttribute("aria-pressed", String(active));
  if (clusterId) el.setAttribute("data-cluster-id", clusterId);
  if (ringKey) el.setAttribute("data-ring-key", ringKey);
  Object.assign(el.style, { transition: "transform 120ms ease, box-shadow 120ms ease" });
  Object.assign(el.style, {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: "700",
    fontFamily: "inherit",
    cursor: "pointer",
    userSelect: "none",
    boxSizing: "border-box",
    ...style,
  });
  el.onclick = () => {
    hideTooltip();
    onClick();
  };
  el.onmouseenter = () => showTooltip(el, tooltipText ?? label);
  el.onmouseleave = hideTooltip;
  const indicator = document.createElement("div");
  Object.assign(indicator.style, {
    width: "14px",
    height: "3px",
    borderRadius: "2px",
    background: active ? "#18181b" : "transparent",
  });
  item.appendChild(el);
  item.appendChild(indicator);
  return item;
}

const RING_WORKING = "#3b82f6";
const RING_DONE = "#22c55e";
const RING_STYLE_ID = "paseo-clusters-ring-style";

function ensureRingStyle(): void {
  if (document.querySelector(`#${RING_STYLE_ID}`)) return;
  const style = document.createElement("style");
  style.setAttribute("id", RING_STYLE_ID);
  style.textContent = "@keyframes paseo-clusters-spin { to { transform: rotate(360deg); } }";
  document.body.appendChild(style);
}

interface RingState {
  working: boolean;
  done: boolean;
}

function workspacesOfProject(key: string): Set<string> {
  const ids = new Set(knownWorkspaces.get(key) ?? []);
  const path = projectPathOfKey(key);
  if (path) for (const [id, info] of activity) if (info.projectPath === path) ids.add(id);
  return ids;
}

function ringStateOf(projects: readonly string[]): RingState {
  const ring = { working: false, done: false };
  for (const key of projects) {
    for (const id of workspacesOfProject(key)) {
      const status = activity.get(id)?.status;
      if (status === "running") ring.working = true;
      // "done" is Paseo's idle state; "attention" means finished and not yet seen.
      else if (status === "attention") ring.done = true;
    }
  }
  return ring;
}

/** Paints the working (dashed, spinning) and done (solid green) rings on one circle. */
function paintRing(circleEl: El, ring: RingState): void {
  const signature = `${ring.working ? "w" : ""}${ring.done ? "d" : ""}`;
  if (circleEl.getAttribute("data-ring") === signature) return;
  circleEl.setAttribute("data-ring", signature);
  circleEl.style.position = "relative";
  circleEl.querySelector("[data-ring-working]")?.remove();
  circleEl.style.boxShadow = ring.done ? `0 0 0 1.5px #ffffff, 0 0 0 2.5px ${RING_DONE}` : "";
  if (!ring.working) return;
  ensureRingStyle();
  const dashed = document.createElement("div");
  dashed.setAttribute("data-ring-working", "");
  const inset = ring.done ? "-5px" : "-3px";
  Object.assign(dashed.style, {
    position: "absolute",
    top: inset,
    left: inset,
    right: inset,
    bottom: inset,
    borderRadius: "50%",
    border: `1px dashed ${RING_WORKING}`,
    boxSizing: "border-box",
    pointerEvents: "none",
    animation: "paseo-clusters-spin 4s linear infinite",
  });
  circleEl.appendChild(dashed);
}

function updateRings(): void {
  const bar = document.querySelector(`#${BAR_ID}`);
  if (!bar) return;
  const recentCircle = bar.querySelector('[data-ring-key="recent"]');
  if (recentCircle) paintRing(recentCircle, ringStateOf(state.recentOrder ?? []));
  for (const cluster of state.clusters) {
    const el = bar.querySelector(`[data-cluster-id="${cluster.id}"]`);
    if (el) paintRing(el, ringStateOf(cluster.projects));
  }
}

function renderBar(bar: El, onAdd: () => void): void {
  const setActive = (id: string | null) => setState({ ...state, active: id });
  bar.replaceChildren(
    circle({
      label: "Recientes de mis clusters",
      ringKey: "recent",
      active: state.active === null,
      onClick: () => setActive(null),
      svg: BOLT_SVG,
      style: { background: "#dbeafe", color: "#3b82f6" },
    }),
    ...state.clusters.map((c) =>
      circle({
        label: c.name,
        clusterId: c.id,
        tooltipText: `${c.name} · ${c.projects.length} ${c.projects.length === 1 ? "proyecto" : "proyectos"}`,
        active: c.id === state.active,
        onClick: () => setActive(c.id),
        text: clusterIcon(c),
        style: { background: c.color },
      }),
    ),
    circle({
      label: "Todos los proyectos",
      active: state.active === ALL_ID,
      onClick: () => setActive(ALL_ID),
      svg: LAYERS_SVG,
      style: { background: "#e4e4e7", color: "#52525b" },
    }),
    circle({
      label: "Crear y editar clusters",
      active: false,
      onClick: onAdd,
      svg: PLUS_SVG,
      style: { background: "transparent", color: "#a1a1aa", border: "1px solid #d4d4d8" },
    }),
  );
  updateRings();
}
function mountBar(onAdd: () => void): El | null {
  const existing = document.querySelector(`#${BAR_ID}`);
  if (existing) return existing;
  const newButton = document.querySelector('[data-testid="sidebar-global-new-workspace"]');
  const nav = newButton?.parentElement?.parentElement;
  if (!nav?.parentElement) return null;
  const bar = document.createElement("div");
  bar.setAttribute("id", BAR_ID);
  Object.assign(bar.style, {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: "10px",
    marginTop: "8px",
    marginBottom: "6px",
    padding: "0 12px 4px",
    borderBottom: "1px solid rgba(113, 113, 122, 0.25)",
    position: "relative",
    zIndex: "1",
  });
  // Keep the bar out of Electron's window-drag region so pointer drags reach the plugin.
  const barStyle = bar.style as unknown as { setProperty(name: string, value: string): void };
  barStyle.setProperty("-webkit-app-region", "no-drag");
  barStyle.setProperty("app-region", "no-drag");
  renderBar(bar, onAdd);
  nav.parentElement.insertBefore(bar, nav);
  return bar;
}

function flash(anchor: El, text: string): void {
  showTooltip(anchor, text);
  setTimeout(hideTooltip, 1500);
}

/** Moves a project into one cluster (removing it from the rest), or out of all of them with `null`. */
export function moveProjectToCluster(key: string, clusterId: string | null): Cluster | null {
  const target = state.clusters.find((c) => c.id === clusterId) ?? null;
  if (clusterId !== null && !target) return null;
  setState({
    ...state,
    clusters: state.clusters.map((c) => {
      const without = c.projects.filter((p) => p !== key);
      return c.id === clusterId ? { ...c, projects: [...without, key] } : { ...c, projects: without };
    }),
  });
  return target;
}

function clusterCircleAt(x: number, y: number): El | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const hit = el.closest("[data-cluster-id]");
    if (hit) return hit;
  }
  return null;
}

let dropLine: El | null = null;

function showDropLine(left: number, top: number, width: number): void {
  if (!dropLine) {
    dropLine = document.createElement("div");
    Object.assign(dropLine.style, {
      position: "fixed",
      height: "2px",
      borderRadius: "1px",
      background: "#3b82f6",
      zIndex: "99998",
      pointerEvents: "none",
    });
  }
  Object.assign(dropLine.style, { left: `${left}px`, top: `${top - 1}px`, width: `${width}px`, display: "block" });
  if (!dropLine.isConnected) document.body.appendChild(dropLine);
}

function hideDropLine(): void {
  if (dropLine) dropLine.style.display = "none";
}

interface DropSlot {
  /** Visible cluster projects in on-screen order, without the dragged one. */
  keys: string[];
  index: number;
}

/** Bounding box without the drag-preview translate, so slots don't chase the animation. */
function restingRect(el: El): { left: number; top: number; bottom: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const match = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform ?? "");
  const dy = match ? Number(match[1]) : 0;
  return { left: rect.left, top: rect.top - dy, bottom: rect.bottom - dy, width: rect.width, height: rect.height };
}

/** The manually ordered list behind the current view: a cluster's projects or "Recientes". */
function activeOrder(): string[] | null {
  if (state.active === null) return state.recentOrder ?? [];
  return state.clusters.find((c) => c.id === state.active)?.projects ?? null;
}

/** Where a dragged project would land among the visible projects of the current view. */
function dropSlot(dragKey: string, y: number): (DropSlot & { lineTop: number; left: number; width: number }) | null {
  const order = activeOrder();
  if (!order || !order.includes(dragKey)) return null;
  const visible = projectGroups()
    .filter((g) => g.key !== dragKey && g.group.style.display !== "none" && order.includes(g.key))
    .map((g) => ({ key: g.key, rect: restingRect(g.group) }))
    .sort((a, b) => a.rect.top - b.rect.top);
  const draggedGroup = projectGroups().find((g) => g.key === dragKey)?.group;
  const dragged = draggedGroup ? restingRect(draggedGroup) : undefined;
  const anyRect = visible[0]?.rect ?? dragged;
  if (!anyRect) return null;
  let index = visible.findIndex((v) => y < v.rect.top + v.rect.height / 2);
  if (index === -1) index = visible.length;
  const lineTop =
    index < visible.length ? visible[index].rect.top : (visible[visible.length - 1]?.rect.bottom ?? anyRect.bottom);
  return { keys: visible.map((v) => v.key), index, lineTop, left: anyRect.left + 8, width: anyRect.width - 16 };
}

/** Native-feeling drag preview: the dragged project follows the pointer and neighbours make room. */
function previewReorder(dragKey: string, dy: number, slot: DropSlot | null): void {
  const groups = projectGroups();
  const dragged = groups.find((g) => g.key === dragKey);
  if (!dragged) return;
  const height = dragged.group.getBoundingClientRect().height;
  Object.assign(dragged.group.style, {
    transform: `translateY(${dy}px)`,
    transition: "none",
    position: "relative",
    zIndex: "10",
    opacity: "0.92",
    boxShadow: "0 6px 16px rgba(0, 0, 0, 0.18)",
    borderRadius: "6px",
  });
  if (!slot) return;
  const current = (activeOrder() ?? []).filter((key) => slot.keys.includes(key) || key === dragKey);
  const from = current.indexOf(dragKey);
  for (const [i, key] of slot.keys.entries()) {
    const group = groups.find((g) => g.key === key)?.group;
    if (!group) continue;
    // Index among the visible order before the drag, counting the dragged project.
    const before = current.indexOf(key);
    let shift = 0;
    if (from !== -1 && before > from && i < slot.index) shift = -height;
    else if (from !== -1 && before < from && i >= slot.index) shift = height;
    Object.assign(group.style, { transform: shift ? `translateY(${shift}px)` : "", transition: "transform 150ms ease" });
  }
}

function clearPreview(): void {
  for (const { group } of projectGroups()) {
    Object.assign(group.style, {
      transform: "",
      transition: "",
      position: "",
      zIndex: "",
      opacity: "",
      boxShadow: "",
      borderRadius: "",
    });
  }
}

function reorderInCluster(dragKey: string, slot: DropSlot): void {
  const ordered = [...slot.keys];
  ordered.splice(slot.index, 0, dragKey);
  if (state.active === null) {
    const rest = (state.recentOrder ?? []).filter((key) => !ordered.includes(key));
    setState({ ...state, recentOrder: [...ordered, ...rest] });
    return;
  }
  const cluster = state.clusters.find((c) => c.id === state.active);
  if (!cluster) return;
  const rest = cluster.projects.filter((key) => !ordered.includes(key));
  setState({
    ...state,
    clusters: state.clusters.map((c) => (c.id === cluster.id ? { ...c, projects: [...ordered, ...rest] } : c)),
  });
}

function setDropHighlight(circleEl: El | null, on: boolean): void {
  if (!circleEl) return;
  Object.assign(circleEl.style, {
    transform: on ? "scale(1.2)" : "",
    boxShadow: on ? "0 0 0 3px rgba(59, 130, 246, 0.5)" : "",
  });
  if (!on) {
    // The highlight overwrote the status ring; force it to repaint.
    circleEl.setAttribute("data-ring", "stale");
    updateRings();
  }
}

/** Bounding box without any preview translate applied by the cluster drag. */
function restingBox(el: El): { left: number; top: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const match = /translate(?:X)?\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\)/.exec(el.style.transform ?? "");
  const dx = match ? Number(match[1]) : 0;
  const dy = match?.[2] ? Number(match[2]) : 0;
  return { left: rect.left - dx, top: rect.top - dy, width: rect.width, height: rect.height };
}

/** Drag cluster circles to reorder them; "Recientes" stays first and "Todos"/"+" stay last. */
function startClusterDrag(): () => void {
  let dragId: string | null = null;
  let item: El | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let suppressClick = false;

  const circles = () =>
    Array.from(document.querySelectorAll(`#${BAR_ID} [data-cluster-id]`)).map((el) => ({
      id: el.getAttribute("data-cluster-id") ?? "",
      item: el.parentElement ?? el,
    }));

  const targetIndex = (x: number, y: number): number => {
    const others = circles().filter((c) => c.id !== dragId);
    let best = others.length;
    let bestDistance = Number.POSITIVE_INFINITY;
    others.forEach((c, i) => {
      const r = restingBox(c.item);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const distance = Math.hypot(x - cx, (y - cy) * 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = x < cx ? i : i + 1;
      }
    });
    return best;
  };

  const onDown = (event: PointerLike) => {
    if (event.button !== 0) return;
    const target = event.target as El | null;
    const circleEl = target && typeof target.closest === "function" ? target.closest(`#${BAR_ID} [data-cluster-id]`) : null;
    if (!circleEl) return;
    dragId = circleEl.getAttribute("data-cluster-id");
    item = circleEl.parentElement;
    if (event.pointerId !== undefined) circleEl.setPointerCapture?.(event.pointerId);
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
  };
  const onMove = (event: PointerLike) => {
    if (!dragId || !item) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < 5) return;
    if (!dragging) hideTooltip();
    dragging = true;
    event.stopImmediatePropagation();
    Object.assign(item.style, {
      transform: `translate(${dx}px, ${dy}px) scale(1.1)`,
      zIndex: "5",
      opacity: "0.9",
      transition: "none",
      cursor: "grabbing",
    });
    const index = targetIndex(event.clientX, event.clientY);
    for (const [i, c] of circles().filter((c) => c.id !== dragId).entries()) {
      Object.assign(c.item.style, {
        transform: i >= index ? "translateX(6px)" : "",
        transition: "transform 120ms ease",
      });
    }
  };
  const onUp = (event: PointerLike) => {
    const id = dragId;
    const wasDragging = dragging;
    dragId = null;
    dragging = false;
    if (!id || !wasDragging) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    const index = targetIndex(event.clientX, event.clientY);
    for (const c of circles()) Object.assign(c.item.style, { transform: "", zIndex: "", opacity: "", transition: "", cursor: "" });
    item = null;
    if (event.type === "pointercancel") return;
    const moving = state.clusters.find((c) => c.id === id);
    if (!moving) return;
    const rest = state.clusters.filter((c) => c.id !== id);
    rest.splice(index, 0, moving);
    setState({ ...state, clusters: rest });
  };
  const onClick = (event: PointerLike) => {
    if (!suppressClick) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    window.removeEventListener("click", onClick, true);
  };
}

function blocksNative(): boolean {
  return state.active !== ALL_ID;
}

/** Lets the user drop a sidebar project (or one of its workspaces) onto a cluster circle. */
function startProjectDrag(): () => void {
  let dragKey: string | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let hovered: El | null = null;

  const onDown = (event: PointerLike) => {
    if (event.button !== 0) return;
    const target = event.target as El | null;
    if (!target || typeof target.closest !== "function" || target.closest(`#${BAR_ID}`)) return;
    const found = projectGroups().find((g) => g.group.contains(target));
    dragKey = found?.key ?? null;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
  };
  const onMove = (event: PointerLike) => {
    if (!dragKey) return;
    // Outside "all", Paseo's own reorder would fight the filtered list; the plugin handles it instead.
    if (blocksNative()) event.stopImmediatePropagation();
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
    dragging = true;
    const over = clusterCircleAt(event.clientX, event.clientY);
    const slot = !blocksNative() ? null : dropSlot(dragKey, event.clientY);
    if (slot && !over) previewReorder(dragKey, event.clientY - startY, slot);
    else if (blocksNative()) clearPreview();
    hideDropLine();
    if (over !== hovered) {
      setDropHighlight(hovered, false);
      setDropHighlight(over, true);
      hovered = over;
      if (over) showTooltip(over, `Mover a ${over.getAttribute("aria-label") ?? "cluster"}`);
      else hideTooltip();
    }
  };
  const onUp = (event: PointerLike) => {
    const key = dragKey;
    const wasDragging = dragging;
    dragKey = null;
    dragging = false;
    setDropHighlight(hovered, false);
    hovered = null;
    hideDropLine();
    if (wasDragging) clearPreview();
    if (!key || !wasDragging) return;
    const over = clusterCircleAt(event.clientX, event.clientY);
    const clusterId = over?.getAttribute("data-cluster-id");
    if (!over || !clusterId) {
      hideTooltip();
      const slot = blocksNative() ? dropSlot(key, event.clientY) : null;
      if (slot) reorderInCluster(key, slot);
      return;
    }
    const moved = moveProjectToCluster(key, clusterId);
    const fresh = document.querySelector(`[data-cluster-id="${clusterId}"]`) ?? over;
    if (moved) flash(fresh, `Movido a ${moved.name}`);
  };

  // Window capture runs before any listener Paseo registers, for every input type its drag may use.
  const block = (event: PointerLike) => {
    if (dragKey && blocksNative()) event.stopImmediatePropagation();
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("mousemove", block, true);
  window.addEventListener("touchmove", block, true);
  window.addEventListener("dragstart", block, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("mousemove", block, true);
    window.removeEventListener("touchmove", block, true);
    window.removeEventListener("dragstart", block, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  };
}

/** Injects the cluster bar into the native sidebar and keeps the project filter applied. */
export function startSidebarClusters(onAdd: () => void): () => void {
  if (!isWeb) return () => {};
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    mountBar(onAdd);
    applyFilter();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = subscribe(() => {
    const bar = document.querySelector(`#${BAR_ID}`);
    if (bar) renderBar(bar, onAdd);
    applyFilter();
  });
  sync();
  const stopDrag = startProjectDrag();
  const stopClusterDrag = startClusterDrag();
  const tick = setInterval(scheduleFilter, 60_000);
  return () => {
    stopDrag();
    stopClusterDrag();
    clearInterval(tick);
    observer.disconnect();
    unsubscribe();
    document.querySelector(`#${BAR_ID}`)?.remove();
    tooltip?.remove();
    const preferences = preferencesTarget();
    if (preferences) Object.assign(preferences.style, { visibility: "", pointerEvents: "" });
    dropLine?.remove();
    for (const { group } of projectGroups()) {
      Object.assign(group.style, { display: "", order: "" });
      for (const row of Array.from(group.querySelectorAll(`[data-testid^="${WORKSPACE_PREFIX}"]`))) {
        Object.assign(workspaceItem(row).style, { display: "", order: "" });
      }
    }
  };
}


