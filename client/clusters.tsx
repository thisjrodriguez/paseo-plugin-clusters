import { type PluginSurfaceProps, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  COLORS,
  type Cluster,
  type SidebarProject,
  clusterIcon,
  getState,
  isWeb,
  listSidebarProjects,
  moveProjectToCluster,
  setState,
  subscribe,
} from "./web";
import { ClusterForm, type ClusterDraft } from "./cluster-form";

const ALL_TAB = "__all__";

/** The sidebar key for a project, matching the one the desktop sidebar exposes. */
function projectKey(serverId: string, projectId: string): string {
  const isLocalPath = /^[a-z]:[\\/]/i.test(projectId) || projectId.startsWith("/");
  if (isLocalPath) return `host:${serverId}:${projectId.toLowerCase()}`;
  return `remote:${projectId.replace(/^remote:/, "")}`;
}

export function ClustersSurface({ theme, layout, host, navigation }: PluginSurfaceProps) {
  const state = useSyncExternalStore(subscribe, getState);
  const [tab, setTab] = useState<string>(state.active && state.active !== ALL_TAB ? state.active : ALL_TAB);
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

  const clusterOf = new Map<string, Cluster>();
  for (const cl of state.clusters) for (const key of cl.projects) clusterOf.set(key, cl);

  const current = state.clusters.find((cl) => cl.id === tab) ?? null;
  const needle = query.trim().toLowerCase();
  const matches = (p: SidebarProject) =>
    !needle || p.label.toLowerCase().includes(needle) || p.key.toLowerCase().includes(needle);
  const visible = projects.filter(matches);
  const inCurrent = current ? visible.filter((p) => clusterOf.get(p.key)?.id === current.id) : [];
  const unassigned = visible.filter((p) => !clusterOf.has(p.key));
  const assigned = visible.filter((p) => clusterOf.has(p.key));

  const createCluster = (draft: ClusterDraft) => {
    const cluster: Cluster = { id: `c${Date.now().toString(36)}`, ...draft, projects: [] };
    setForm(null);
    setTab(cluster.id);
    setState({ ...state, clusters: [...state.clusters, cluster] });
  };

  const updateCluster = (id: string, patch: Partial<Cluster>) =>
    setState({ ...state, clusters: state.clusters.map((cl) => (cl.id === id ? { ...cl, ...patch } : cl)) });

  const deleteCluster = () => {
    if (!current) return;
    setTab(ALL_TAB);
    setState({
      clusters: state.clusters.filter((cl) => cl.id !== current.id),
      active: state.active === current.id ? null : state.active,
    });
  };

  const tabButton = (id: string, label: string, color: string | null, count: number, icon?: string) => {
    const selected = tab === id;
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
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "700" }}>{icon}</Text>
          </View>
        ) : null}
        <Text style={styles.text}>{label}</Text>
        <Text style={styles.muted}>{count}</Text>
      </Pressable>
    );
  };

  const moveChip = (key: string, target: Cluster | null, isCurrent: boolean) => (
    <Pressable
      key={target?.id ?? "none"}
      accessibilityRole="button"
      accessibilityLabel={target ? `Mover a ${target.name}` : "Quitar del cluster"}
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
        {target ? target.name : "Sin cluster"}
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
      accessibilityLabel={`Abrir ${w.title || w.name}`}
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
          <Text style={styles.text} numberOfLines={1}>
            {p.label}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {p.key.replace(/^host:[^:]+:/, "").replace(/^remote:/, "")}
          </Text>
        </View>
        <View style={[styles.rowWrap, { gap: 6 }]}>
          {state.clusters.map((cl) => moveChip(p.key, cl, owner?.id === cl.id))}
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
          title={editing ? `Editar ${editing.name}` : "Nuevo cluster"}
          submitLabel={editing ? "Guardar" : "Crear cluster"}
          initial={editing ?? { name: "", color: COLORS[state.clusters.length % COLORS.length] }}
          onCancel={() => setForm(null)}
          onSubmit={(draft) => {
            if (!editing) return createCluster(draft);
            updateCluster(editing.id, draft);
            setForm(null);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.title}>Clusters</Text>
      <Text style={styles.muted}>
        Cada proyecto pertenece a un solo cluster. Pulsa un cluster en una fila para moverlo allí, o arrástralo desde la
        barra lateral hasta su círculo.
      </Text>

      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={[styles.rowWrap, { flex: 1 }]}>
          {tabButton(ALL_TAB, "Todos", null, projects.length)}
          {state.clusters.map((cl) => tabButton(cl.id, cl.name, cl.color, cl.projects.length, clusterIcon(cl)))}
        </View>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setForm("create")}>
          <Text style={styles.buttonText}>+ Nuevo cluster</Text>
        </Pressable>
      </View>

      <View style={styles.rowWrap}>
        <TextInput
          style={styles.input}
          placeholder="Buscar proyecto…"
          placeholderTextColor={c.foregroundMuted}
          value={query}
          onChangeText={setQuery}
        />
        <Pressable
          accessibilityRole="button"
          style={styles.ghost}
          onPress={() => (isWeb ? setSidebarProjects(listSidebarProjects()) : void projectsQuery.refetch())}
        >
          <Text style={styles.text}>Actualizar lista</Text>
        </Pressable>
      </View>

      {current ? (
        <>
          <View style={[styles.rowWrap, { justifyContent: "space-between", marginTop: 4 }]}>
            <Text style={styles.title}>{current.name}</Text>
            <View style={styles.rowWrap}>
              <Pressable accessibilityRole="button" style={styles.ghost} onPress={() => setForm("edit")}>
                <Text style={styles.text}>Editar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.ghost} onPress={deleteCluster}>
                <Text style={styles.text}>Borrar cluster</Text>
              </Pressable>
            </View>
          </View>
          {inCurrent.length === 0 ? (
            <Text style={styles.muted}>
              {needle ? "Ningún proyecto coincide." : "Sin proyectos. Añádelos desde la pestaña Todos."}
            </Text>
          ) : null}
          {inCurrent.map(projectRow)}
        </>
      ) : (
        <>
          {projects.length === 0 ? (
            <Text style={styles.muted}>No encuentro proyectos en la barra lateral. Ábrela y pulsa “Actualizar lista”.</Text>
          ) : null}
          <Text style={styles.section}>SIN CLUSTER · {unassigned.length}</Text>
          {unassigned.map(projectRow)}
          <Text style={styles.section}>CON CLUSTER · {assigned.length}</Text>
          {assigned.map(projectRow)}
        </>
      )}
    </ScrollView>
  );
}
