import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ClustersSurface } from "./client/clusters";
import { readState, writeState } from "./shared/storage";
import { type WorkspaceStatus, isWeb, removeWorkspace, startSync, setWorkspaceActivity, startSidebarClusters, touchWorkspace } from "./client/web";

/** Fallback resync; live updates arrive through the subscriptions below. */
const RESYNC_MS = 60_000;

function toMs(value: string | null | undefined): number {
  const at = Date.parse(value ?? "");
  return Number.isNaN(at) ? 0 : at;
}

interface WorkspaceLike {
  id: string;
  projectRootPath: string;
  activityAt?: string | null;
  statusEnteredAt?: string | null;
  status?: WorkspaceStatus;
}

function recordWorkspace(w: WorkspaceLike): void {
  setWorkspaceActivity(w.id, {
    at: Math.max(toMs(w.activityAt), toMs(w.statusEnteredAt)),
    projectPath: w.projectRootPath.toLowerCase(),
    status: w.status ?? null,
  });
}

export default function contribute(client: PluginClientContext) {
  client.addSurface("clusters", ClustersSurface);
  client.addSidebarItem({
    id: "clusters",
    title: "Clusters",
    icon: "LayoutGrid",
    surface: "clusters",
  });
  client.addCommandCenterItem({
    id: "open-clusters",
    title: "Gestionar clusters de proyectos",
    icon: "LayoutGrid",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("clusters");
    },
  });

  const stopSync = startSync({
    read: async () => (await client.rpc(readState, {})).state,
    write: async (shared) => {
      await client.rpc(writeState, { state: shared });
    },
  });
  const stopSidebar = startSidebarClusters(() => client.openSurface("clusters"));
  if (!isWeb) {
    return () => {
      stopSync();
      stopSidebar();
    };
  }

  const resync = async () => {
    try {
      const { entries } = await client.paseo.workspaces.list();
      for (const w of entries) recordWorkspace(w);
    } catch (error) {
      console.warn("[paseo-clusters] No se pudo leer la actividad de workspaces", error);
    }
  };

  const stopWorkspaces = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") recordWorkspace(update.workspace);
    else if ("id" in update && typeof update.id === "string") removeWorkspace(update.id);
  });
  const stopAgents = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    const at = Math.max(toMs(update.agent.updatedAt), toMs(update.agent.lastUserMessageAt));
    touchWorkspace(update.agent.workspaceId, at || Date.now());
  });

  // Ask the daemon to stream workspace changes for as long as the plugin runs.
  let released = false;
  let release: (() => Promise<void>) | null = null;
  client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      for (const w of result.entries) recordWorkspace(w);
      release = () => result.subscription.release();
      if (released) void release();
    })
    .catch((error: unknown) => console.warn("[paseo-clusters] Sin suscripción en vivo", error));

  const timer = setInterval(() => void resync(), RESYNC_MS);

  return () => {
    released = true;
    void release?.();
    clearInterval(timer);
    stopWorkspaces();
    stopAgents();
    stopSidebar();
    stopSync();
  };
}
