import { type PluginHostSummary, type PluginSurfaceProps, useHosts, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  COLORS,
  type Daemon,
  type MergedCluster,
  type SidebarProject,
  clusterIcon,
  createCluster,
  DEFAULT_RECENT_HOURS,
  focusDaemon,
  getActive,
  getState,
  nodeLabelOf,
  nodeLabelOfKey,
  setHostLabels,
  isWeb,
  listSidebarProjects,
  mergedClusters,
  moveProjectToCluster,
  nodes,
  registerHost,
  setState,
  MAX_RECENT_HOURS,
  MIN_RECENT_HOURS,
  subscribe,
  t,
} from "./web";
import { ClusterForm, type ClusterDraft } from "./cluster-form";

const ALL_TAB = "__all__";
const NO_HOSTS: readonly PluginHostSummary[] = [];
/** Paseo before 0.9 has no host list; the screen then names only the nodes it hears from. */
const useHostList: () => readonly PluginHostSummary[] = typeof useHosts === "function" ? useHosts : () => NO_HOSTS;
const UPDATE_COMMAND = "paseo plugin update paseo-clusters --yes";
const OUTDATED = "#ef4444";

/** Orders versions like 0.13.0-beta.1: numbers first, and a pre-release before its release. */
function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.split("-", 2);
  const [coreB, preB] = b.split("-", 2);
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff) return diff;
  }
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
  return preA.localeCompare(preB, undefined, { numeric: true });
}

function newest(versions: (string | null | undefined)[]): string | null {
  return versions.filter((v): v is string => !!v).sort(compareVersions).pop() ?? null;
}
/** Local to this screen: the projects no cluster holds yet. */
const UNASSIGNED_TAB = "__unassigned__";

/** The sidebar key for a project, matching the one the desktop sidebar exposes. */
function projectKey(serverId: string, projectId: string): string {
  const isLocalPath = /^[a-z]:[\\/]/i.test(projectId) || projectId.startsWith("/");
  if (isLocalPath) return `host:${serverId}:${projectId.toLowerCase()}`;
  return `remote:${projectId.replace(/^remote:/, "")}`;
}

/**
 * The Clusters screen. It shows the clusters of every connected daemon, each on its own and named
 * with its node; any project can go into any cluster, and new clusters start on this daemon.
 */
export interface ClustersSurfaceProps extends PluginSurfaceProps {
  daemon: Daemon;
}

export function ClustersSurface({ theme, layout, host, navigation, daemon }: ClustersSurfaceProps) {
  const snapshot = useCallback(() => getState(daemon), [daemon]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const clusters = useSyncExternalStore(subscribe, mergedClusters);
  const connected = useSyncExternalStore(subscribe, nodes);
  const hosts = useHostList();
  // This screen is the one place the app names the host its daemon serves.
  useEffect(() => registerHost(daemon, host.id), [daemon, host.id]);
  // Looking at a daemon's clusters is what points the sidebar bar at that daemon.
  useEffect(() => focusDaemon(daemon), [daemon]);
  const strings = t();
  const [tab, setTab] = useState<string>(() => getActive() ?? ALL_TAB);
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [query, setQuery] = useState("");
  const paseo = usePaseo();
  const [sidebarProjects, setSidebarProjects] = useState(listSidebarProjects);

  // The desktop reads the live sidebar; other clients ask the daemon for the project list.
  const projectsQuery = useQuery({
    queryKey: ["paseo-clusters", "projects", host.id],
    queryFn: async () => {
      const { projects: entries } = await paseo.projects.list();
      return entries.map((project) => ({
        key: projectKey(host.id, project.projectKey ?? project.projectId),
        label: project.projectCustomName || project.projectDisplayName,
      }));
    },
    enabled: !isWeb,
  });
  const projects: SidebarProject[] = isWeb ? sidebarProjects : (projectsQuery.data ?? []);

  // Mobile has no sidebar to filter, so the cluster tab lists its workspaces instead.
  const workspacesQuery = useQuery({
    queryKey: ["paseo-clusters", "workspaces", host.id],
    queryFn: async () => (await paseo.workspaces.list()).entries,
    enabled: !isWeb,
    refetchInterval: 10_000,
  });

  const c = theme.colors;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: c.surface0 },
      body: { padding: layout.compact ? 12 : 20, gap: 10 },
      title: { color: c.foreground, fontSize: layout.compact ? 18 : 22, fontWeight: "600" as const },
      section: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const, marginTop: 8 },
      muted: { color: c.foregroundMuted, fontSize: 13 },
      text: { color: c.foreground, fontSize: 14 },
      rowWrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, alignItems: "center" as const },
      row: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 10,
        padding: 10,
        borderRadius: 8,
        backgroundColor: c.surface1,
      },
      button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: c.accent },
      buttonText: { color: c.accentForeground, fontSize: 13 },
      ghost: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: c.border },
      input: {
        flex: 1,
        minWidth: 160,
        color: c.foreground,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        padding: 10,
        backgroundColor: c.surface1,
      },
    }),
    [c, layout.compact],
  );

  // The sidebar tags projects with these names, and it has no hook to read them itself.
  useEffect(() => {
    if (hosts.length) setHostLabels(Object.fromEntries(hosts.map((h) => [h.serverId, h.label])));
  }, [hosts]);

  const hostLabel = (id: string | null) =>
    id === null ? null : (hosts.find((h) => h.serverId === id)?.label ?? (id === host.id ? host.label : id));

  // Every configured host, plus any connected daemon whose host the app has not listed.
  const nodeRows = [
    ...hosts.map((h) => ({ id: h.serverId, label: h.label, online: h.status === "online", node: connected.find((n) => n.hostId === h.serverId) ?? null })),
    ...connected
      .filter((n) => !n.hostId || !hosts.some((h) => h.serverId === n.hostId))
      .map((n) => ({ id: n.hostId ?? "", label: hostLabel(n.hostId) ?? "?", online: true, node: n })),
  ];
  const latestPaseo = newest(nodeRows.map((r) => r.node?.paseoVersion));
  const latestPlugin = newest(nodeRows.map((r) => r.node?.pluginVersion));
  const [tip, setTip] = useState<string | null>(null);

  const clusterOf = new Map<string, MergedCluster>();
  for (const cl of clusters) for (const key of cl.projects) clusterOf.set(key, cl);

  // One tab per cluster, named with its node when more than one is connected.
  const multiNode = connected.length > 1;
  const tabs = clusters.flatMap((cl) =>
    cl.members.map((m) => {
      const own = getState(m.daemon).clusters.find((c) => c.id === m.id);
      return {
        id: `${cl.id}@${m.id}`,
        merged: cl,
        daemon: m.daemon,
        own: own ?? { ...cl, id: m.id, projects: [] },
        node: nodeLabelOf(m.daemon),
      };
    }),
  );
  // A merged id (from the bar, or a cluster just created) opens that cluster on this node first.
  const currentTab =
    tabs.find((tb) => tb.id === tab) ??
    tabs.find((tb) => tb.merged.id === tab && tb.daemon === daemon) ??
    tabs.find((tb) => tb.merged.id === tab) ??
    null;
  const current = currentTab?.own ?? null;
  const needle = query.trim().toLowerCase();
  const matches = (p: SidebarProject) =>
    !needle || p.label.toLowerCase().includes(needle) || p.key.toLowerCase().includes(needle);
  const visible = projects.filter(matches);
  const inCurrent = current ? visible.filter((p) => current.projects.includes(p.key)) : [];
  const unassigned = visible.filter((p) => !clusterOf.has(p.key));
  const assigned = visible.filter((p) => clusterOf.has(p.key));
  const unassignedCount = projects.filter((p) => !clusterOf.has(p.key)).length;

  const create = (draft: ClusterDraft) => {
    setForm(null);
    const id = createCluster(daemon, draft);
    if (id) setTab(id);
  };

  /** Edits apply to the selected node's cluster only; its namesakes on other nodes stay. */
  const editOwn = (patch: Partial<ClusterDraft> | null) => {
    if (!currentTab) return;
    const owner = getState(currentTab.daemon);
    setState(currentTab.daemon, {
      ...owner,
      clusters: patch
        ? owner.clusters.map((c) => (c.id === currentTab.own.id ? { ...c, ...patch } : c))
        : owner.clusters.filter((c) => c.id !== currentTab.own.id),
    });
  };

  const remove = () => {
    if (!current) return;
    setTab(ALL_TAB);
    editOwn(null);
  };

  const hours = Math.min(MAX_RECENT_HOURS, Math.max(MIN_RECENT_HOURS, Math.round(state.recentHours ?? DEFAULT_RECENT_HOURS)));
  const setHours = (next: number) =>
    setState(daemon, { ...state, recentHours: Math.min(MAX_RECENT_HOURS, Math.max(MIN_RECENT_HOURS, next)) });

  const stepButton = (label: string, a11y: string, disabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 36,
        height: 36,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );

  const tabButton = (
    id: string,
    label: string,
    color: string | null,
    count: number,
    icon?: string,
    image?: string,
    node?: string | null,
  ) => {
    const selected = currentTab ? currentTab.id === id : tab === id;
    return (
      <Pressable
        key={id}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => setTab(id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: selected ? (color ?? c.foreground) : c.border,
          backgroundColor: selected ? c.surface2 : "transparent",
        }}
      >
        {color ? (
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              backgroundColor: color,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {image ? (
              <Image source={{ uri: image }} style={{ width: 20, height: 20 }} accessibilityIgnoresInvertColors />
            ) : (
              <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "700" }}>{icon}</Text>
            )}
          </View>
        ) : null}
        <Text style={styles.text}>{label}</Text>
        {node ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: 10, color: c.foregroundMuted, borderWidth: 1, borderColor: c.border, borderRadius: 4, paddingHorizontal: 4 }}
          >
            {node}
          </Text>
        ) : null}
        <Text style={styles.muted}>{count}</Text>
      </Pressable>
    );
  };

  const moveChip = (key: string, target: MergedCluster | null, isCurrent: boolean) => (
    <Pressable
      key={target?.id ?? "none"}
      accessibilityRole="button"
      accessibilityLabel={target ? strings.moveTo(target.name) : strings.removeFromCluster}
      disabled={isCurrent}
      onPress={() => moveProjectToCluster(key, target?.id ?? null)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: isCurrent ? (target?.color ?? c.foregroundMuted) : c.border,
        backgroundColor: isCurrent ? c.surface2 : "transparent",
      }}
    >
      {target ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: target.color }} /> : null}
      <Text style={{ color: isCurrent ? c.foreground : c.foregroundMuted, fontSize: 12 }}>
        {target
          ? multiNode
            ? `${target.name} · ${nodeLabelOf(target.members[0].daemon) ?? "?"}`
            : target.name
          : strings.noCluster}
      </Text>
    </Pressable>
  );

  const workspacesOf = (p: SidebarProject) => {
    if (isWeb) return [];
    const path = p.key.replace(/^host:[^:]+:/, "");
    return (workspacesQuery.data ?? []).filter(
      (w) => !w.archivingAt && w.projectRootPath.toLowerCase() === path,
    );
  };

  const workspaceRow = (w: { id: string; name: string; title?: string | null; status: string }) => (
    <Pressable
      key={w.id}
      accessibilityRole="button"
      accessibilityLabel={strings.openWorkspace(w.title || w.name)}
      disabled={!navigation}
      onPress={() => navigation?.openWorkspace({ workspaceId: w.id })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        marginLeft: 12,
        borderLeftWidth: 2,
        borderLeftColor: c.border,
      }}
    >
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {w.title || w.name}
      </Text>
      <Text style={styles.muted}>{w.status}</Text>
    </Pressable>
  );

  const projectRow = (p: SidebarProject) => {
    const owner = clusterOf.get(p.key) ?? null;
    const workspaces = current ? workspacesOf(p) : [];
    return (
      <View key={p.key}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.text, { flexShrink: 1 }]} numberOfLines={1}>
              {p.label}
            </Text>
            {nodeLabelOfKey(p.key) ? (
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  color: c.foregroundMuted,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 4,
                  paddingHorizontal: 5,
                }}
              >
                {nodeLabelOfKey(p.key)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {p.key.replace(/^host:[^:]+:/, "").replace(/^remote:/, "")}
          </Text>
        </View>
        <View style={[styles.rowWrap, { gap: 6 }]}>
          {clusters.map((cl) => moveChip(p.key, cl, owner?.id === cl.id))}
          {moveChip(p.key, null, owner === null)}
        </View>
      </View>
      {workspaces.map(workspaceRow)}
      </View>
    );
  };

  if (form === "create" || (form === "edit" && current)) {
    const editing = form === "edit" ? current : null;
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <ClusterForm
          key={editing?.id ?? "new"}
          theme={theme}
          title={editing ? strings.formEdit(editing.name) : strings.formNew}
          submitLabel={editing ? strings.save : strings.create}
          initial={editing ?? { name: "", color: COLORS[clusters.length % COLORS.length] }}
          onCancel={() => setForm(null)}
          onSubmit={(draft) => {
            if (!editing) return create(draft);
            editOwn(draft);
            setForm(null);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{strings.title}</Text>
      <Text style={styles.muted}>
{isWeb ? strings.intro : strings.mobileNotice}
      </Text>

      <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: c.border, borderRadius: 6, paddingVertical: 4 }}>
        {[{ id: "head", head: true }, ...nodeRows.map((r) => ({ ...r, head: false }))].map((r) => {
          const row = r.head ? null : (r as (typeof nodeRows)[number]);
          const cell = (key: string, text: string, width: number, outdated: string | null, muted = false) => (
            <Pressable
              key={key}
              onHoverIn={outdated ? () => setTip(`${row?.id}:${key}`) : undefined}
              onHoverOut={outdated ? () => setTip(null) : undefined}
              style={{ width, paddingHorizontal: 8, paddingVertical: 2 }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  fontWeight: r.head ? "600" : "400",
                  color: outdated ? OUTDATED : muted || r.head ? c.foregroundMuted : c.foreground,
                }}
              >
                {text}
              </Text>
              {outdated && tip === `${row?.id}:${key}` ? (
                <View
                  style={{
                    position: "absolute",
                    top: 20,
                    left: 8,
                    zIndex: 10,
                    width: 240,
                    padding: 6,
                    borderRadius: 4,
                    backgroundColor: c.surface2,
                    borderWidth: 1,
                    borderColor: OUTDATED,
                  }}
                >
                  <Text style={{ fontSize: 11, color: c.foreground }}>{outdated}</Text>
                </View>
              ) : null}
            </Pressable>
          );
          if (!row) {
            return (
              <View key="head" style={{ flexDirection: "row" }}>
                {cell("node", strings.nodeHeader, 150, null)}
                {cell("paseo", "Paseo", 110, null)}
                {cell("plugin", "Plugin", 70, null)}
              </View>
            );
          }
          const paseo = row.node?.paseoVersion ?? null;
          const plugin = row.node?.pluginVersion ?? null;
          const oldPaseo = row.online && paseo && latestPaseo && compareVersions(paseo, latestPaseo) < 0;
          const oldPlugin = row.online && (!plugin || (latestPlugin && compareVersions(plugin, latestPlugin) < 0));
          return (
            <View key={row.id || row.label} style={{ flexDirection: "row", zIndex: tip?.startsWith(`${row.id}:`) ? 10 : 0 }}>
              {cell("node", row.label, 150, null, !row.online)}
              {cell("paseo", row.online ? (paseo ?? "?") : "—", 110, oldPaseo ? strings.paseoOutdated(latestPaseo ?? "") : null, !paseo)}
              {cell(
                "plugin",
                !row.online ? "—" : (plugin ?? "< 0.4.1"),
                70,
                oldPlugin ? strings.pluginOutdated(latestPlugin ?? "0.4.1", UPDATE_COMMAND) : null,
              )}
            </View>
          );
        })}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.section}>{strings.recentWindow}</Text>
        <View style={styles.rowWrap}>
          {stepButton("−", strings.decrease, hours <= MIN_RECENT_HOURS, () => setHours(hours - 1))}
          <Text style={[styles.title, { minWidth: 64, textAlign: "center" }]}>{hours} h</Text>
          {stepButton("+", strings.increase, hours >= MAX_RECENT_HOURS, () => setHours(hours + 1))}
          <Text style={styles.muted}>{strings.recentWindowHint(hours)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={[styles.rowWrap, { flex: 1 }]}>
          {tabButton(ALL_TAB, strings.allTab, null, projects.length)}
          {tabButton(UNASSIGNED_TAB, strings.noCluster, null, unassignedCount)}
          {tabs.map((tb) =>
            tabButton(
              tb.id,
              tb.own.name,
              tb.own.color,
              tb.own.projects.length,
              clusterIcon(tb.own),
              tb.own.image,
              multiNode ? tb.node : null,
            ),
          )}
        </View>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setForm("create")}>
          <Text style={styles.buttonText}>{strings.newCluster}</Text>
        </Pressable>
      </View>

      <View style={styles.rowWrap}>
        <TextInput
          style={styles.input}
          placeholder={strings.searchPlaceholder}
          placeholderTextColor={c.foregroundMuted}
          value={query}
          onChangeText={setQuery}
        />
        <Pressable
          accessibilityRole="button"
          style={styles.ghost}
          onPress={() => (isWeb ? setSidebarProjects(listSidebarProjects()) : void projectsQuery.refetch())}
        >
          <Text style={styles.text}>{strings.refresh}</Text>
        </Pressable>
      </View>

      {current ? (
        <>
          <View style={[styles.rowWrap, { justifyContent: "space-between", marginTop: 4 }]}>
            <View style={{ gap: 2 }}>
              <Text style={styles.title}>{current.name}</Text>
              {currentTab?.node ? <Text style={styles.muted}>{strings.onNodes(currentTab.node)}</Text> : null}
            </View>
            <View style={styles.rowWrap}>
              <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => setForm("edit")}>
                <Text style={styles.text}>{strings.edit}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.ghost} onPress={remove}>
                <Text style={styles.text}>{strings.deleteCluster}</Text>
              </Pressable>
            </View>
          </View>
          {inCurrent.length === 0 ? (
            <Text style={styles.muted}>
              {needle ? strings.noMatches : strings.emptyCluster}
            </Text>
          ) : null}
          {inCurrent.map(projectRow)}
        </>
      ) : tab === UNASSIGNED_TAB ? (
        <>
          {unassigned.length === 0 ? (
            <Text style={styles.muted}>{needle ? strings.noMatches : strings.allClustered}</Text>
          ) : null}
          {unassigned.map(projectRow)}
        </>
      ) : (
        <>
          {projects.length === 0 ? (
            <Text style={styles.muted}>{strings.noProjects}</Text>
          ) : null}
          <Text style={styles.section}>{strings.withoutCluster} · {unassigned.length}</Text>
          {unassigned.map(projectRow)}
          <Text style={styles.section}>{strings.withCluster} · {assigned.length}</Text>
          {assigned.map(projectRow)}
        </>
      )}
    </ScrollView>
  );
}
