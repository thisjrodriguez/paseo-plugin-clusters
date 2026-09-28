import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ClustersSurface } from "./client/clusters";
import { t } from "./client/web";
import { type AgentLike, toMs, usedAt } from "./shared/activity";
import { readState, writeState } from "./shared/storage";
import { type WorkspaceStatus, connectDaemon, disconnectDaemon, isWeb, removeWorkspace, setWorkspaceActivity, startSidebarClusters, touchWorkspace } from "./client/web";

/** Fallback resync; live updates arrive through the subscriptions below. */
const RESYNC_MS = 60_000;

interface WorkspaceLike {
  id: string;
  projectRootPath: string;
  activityAt?: string | null;
  status?: WorkspaceStatus;
}

/** The daemon's own workspace activity, when it has one; the status clock is not activity. */
function recordWorkspace(w: WorkspaceLike): void {
  setWorkspaceActivity(w.id, {
    at: toMs(w.activityAt),
    projectPath: w.projectRootPath.toLowerCase(),
    status: w.status ?? null,
  });
}

function recordAgent(agent: AgentLike): void {
  const at = usedAt(agent);
  if (agent.workspaceId && at) touchWorkspace(agent.workspaceId, at);
}

export default function contribute(client: PluginClientContext) {
  // One copy of this plugin runs per connected daemon. This one speaks only for its own daemon:
  // its clusters are read from and written to that daemon, never to any other.
  const daemon = connectDaemon({
    read: () => client.rpc(readState, {}),
    write: async (shared) => {
      await client.rpc(writeState, { state: shared });
    },
  });

  client.addSurface("clusters", (props: PluginSurfaceProps) => <ClustersSurface {...props} daemon={daemon} />);
  client.addSidebarItem({
    id: "clusters",
    title: t().sidebarItem,
    icon: "LayoutGrid",
    surface: "clusters",
  });
  client.addCommandCenterItem({
    id: "open-clusters",
    title: t().commandOpen,
    icon: "LayoutGrid",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("clusters");
    },
  });

  const stopSidebar = startSidebarClusters(daemon, () => client.openSurface("clusters"));
  if (!isWeb) {
    return () => {
      disconnectDaemon(daemon);
      stopSidebar();
    };
  }

  const resyncWorkspaces = async () => {
    try {
      const { entries } = await client.paseo.workspaces.list();
      for (const w of entries) recordWorkspace(w);
    } catch (error) {
      console.warn("[paseo-clusters] Could not read workspace activity", error);
    }
  };

  // Recents needs the last use of every project from the start, not only the changes that happen
  // to arrive while the app is open.
  const resyncAgents = async () => {
    try {
      const { entries } = await client.paseo.agents.list();
      for (const entry of entries) recordAgent(entry.agent);
    } catch (error) {
      console.warn("[paseo-clusters] Could not read agent activity", error);
    }
  };

  const stopWorkspaces = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") recordWorkspace(update.workspace);
    else if ("id" in update && typeof update.id === "string") removeWorkspace(update.id);
  });
  const stopAgents = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert") return;
    recordAgent(update.agent);
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
    .catch((error: unknown) => console.warn("[paseo-clusters] No live subscription", error));

  void resyncAgents();
  const timer = setInterval(() => {
    void resyncWorkspaces();
    void resyncAgents();
  }, RESYNC_MS);

  return () => {
    released = true;
    void release?.();
    clearInterval(timer);
    stopWorkspaces();
    stopAgents();
    stopSidebar();
    disconnectDaemon(daemon);
  };
}
