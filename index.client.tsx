import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ClustersSurface } from "./client/clusters";
import { t } from "./client/web";
import { type AgentLike, toMs, usedAt } from "./shared/activity";
import { readState, writeState } from "./shared/storage";
import { type Daemon, type WorkspaceStatus, claimScreen, registerProjectHistory, registerProjectRoots, connectDaemon, disconnectDaemon, isWeb, registerProjects, removeWorkspace, setWorkspaceActivity, startSidebarClusters, touchWorkspace } from "./client/web";

/** Fallback resync; live updates arrive through the subscriptions below. */
const RESYNC_MS = 60_000;

interface WorkspaceLike {
  id: string;
  projectRootPath: string;
  activityAt?: string | null;
  status?: WorkspaceStatus;
  archivingAt?: string | null;
}

/** The daemon's own workspace activity, when it has one; the status clock is not activity. */
function recordWorkspace(daemon: Daemon, w: WorkspaceLike): void {
  // An archived workspace no longer counts: its project may be left with none.
  if (w.archivingAt) return removeWorkspace(w.id);
  setWorkspaceActivity(daemon, w.id, {
    at: toMs(w.activityAt),
    projectPath: w.projectRootPath.toLowerCase(),
    status: w.status ?? null,
  });
}

function recordAgent(daemon: Daemon, agent: AgentLike): void {
  const at = usedAt(agent);
  if (agent.workspaceId && at) touchWorkspace(daemon, agent.workspaceId, at);
}

/** The sidebar keys this daemon owns. Local projects are matched by path, the rest by key. */
function sidebarKey(project: { projectKey?: string | null; projectId: string }): string | null {
  const id = project.projectKey ?? project.projectId;
  const isLocalPath = /^[a-z]:[\\/]/i.test(id) || id.startsWith("/");
  return isLocalPath ? null : `remote:${id.replace(/^remote:/, "")}`;
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

  // The screen lists every connected daemon, so only one copy registers it: one entry, no host picker.
  const releaseScreen = claimScreen(daemon, () => {
    const removers = [
      client.addSurface("clusters", (props: PluginSurfaceProps) => <ClustersSurface {...props} daemon={daemon} />),
      client.addSidebarItem({
        id: "clusters",
        title: t().sidebarItem,
        icon: "LayoutGrid",
        surface: "clusters",
      }),
      client.addCommandCenterItem({
        id: "open-clusters",
        title: t().commandOpen,
        icon: "LayoutGrid",
        context: "global",
        onSelect({ openSurface }) {
          openSurface("clusters");
        },
      }),
    ];
    return () => {
      for (const remove of removers) void remove();
    };
  });

  const stopSidebar = startSidebarClusters(daemon, () => client.openSurface("clusters"));
  if (!isWeb) {
    return () => {
      releaseScreen();
      disconnectDaemon(daemon);
      stopSidebar();
    };
  }

  const resyncWorkspaces = async () => {
    try {
      const { entries } = await client.paseo.workspaces.list();
      for (const w of entries) recordWorkspace(daemon, w);
    } catch (error) {
      console.warn("[paseo-clusters] Could not read workspace activity", error);
    }
  };

  // Recents needs the last use of every project from the start, not only the changes that happen
  // to arrive while the app is open.
  const resyncAgents = async () => {
    try {
      const { entries } = await client.paseo.agents.list();
      for (const entry of entries) recordAgent(daemon, entry.agent);
    } catch (error) {
      console.warn("[paseo-clusters] Could not read agent activity", error);
    }
  };

  const stopWorkspaces = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") recordWorkspace(daemon, update.workspace);
    else if ("id" in update && typeof update.id === "string") removeWorkspace(update.id);
  });
  const stopAgents = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert") return;
    recordAgent(daemon, update.agent);
  });

  // Ask the daemon to stream workspace changes for as long as the plugin runs.
  let released = false;
  let release: (() => Promise<void>) | null = null;
  client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      for (const w of result.entries) recordWorkspace(daemon, w);
      release = () => result.subscription.release();
      if (released) void release();
    })
    .catch((error: unknown) => console.warn("[paseo-clusters] No live subscription", error));

  // Which projects this daemon owns, so the sidebar can tell whose each row is.
  const resyncProjects = async () => {
    try {
      const { projects } = await client.paseo.projects.list();
      const keys = projects.map(sidebarKey).filter((key): key is string => key !== null);
      registerProjects(daemon, keys);
      // Remote keys carry no path, so their workspaces are matched through the project's root.
      registerProjectRoots(
        projects.flatMap((p) => {
          const key = sidebarKey(p);
          return key && p.projectRootPath ? [[key, p.projectRootPath.toLowerCase()] as [string, string]] : [];
        }),
      );
    } catch (error) {
      console.warn("[paseo-clusters] Could not read the project list", error);
    }
  };

  // Where agents have ever run, archived included: a project with history and no workspace left
  // is one whose workspaces were all archived, unlike a new one that has none yet.
  const resyncHistory = async () => {
    try {
      const paths: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const result = await client.paseo.agents.list({
          filter: { includeArchived: true },
          page: cursor ? { limit: 200, cursor } : { limit: 200 },
        });
        for (const entry of result.entries) if (entry.agent.cwd) paths.push(entry.agent.cwd);
        if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
        cursor = result.pageInfo.nextCursor;
      }
      registerProjectHistory(paths);
    } catch (error) {
      console.warn("[paseo-clusters] Could not read the agent history", error);
    }
  };

  void resyncAgents();
  void resyncProjects();
  void resyncHistory();
  const historyTimer = setInterval(() => void resyncHistory(), 10 * 60_000);
  const timer = setInterval(() => {
    void resyncWorkspaces();
    void resyncAgents();
    void resyncProjects();
  }, RESYNC_MS);

  return () => {
    released = true;
    void release?.();
    clearInterval(timer);
    clearInterval(historyTimer);
    stopWorkspaces();
    stopAgents();
    releaseScreen();
    stopSidebar();
    disconnectDaemon(daemon);
  };
}
