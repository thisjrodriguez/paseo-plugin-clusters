# Changelog

## 0.5.7

- A new project with no workspace yet shows again. 0.5.5 hid every project without a live
  workspace; now only those that had agents and have no workspace left are hidden.

## 0.5.6

- Clusters of different nodes can be interleaved in the bar. Dragging a circle stores a shared
  place on every cluster, so all your apps show the same order. Nodes still on 0.5.5 or older
  ignore it and keep listing theirs together.

## 0.5.5

- Projects whose workspaces are all archived are left out of the Clusters screen and of the
  sidebar when a cluster is selected. Paseo keeps such projects in its list, so they used to show.

## 0.5.4

- Creating a cluster with more than one node connected asks which node stores it.

## 0.5.3

- Clusters are no longer merged by name. Every cluster is shown on its own, in the sidebar bar and
  in the Clusters screen, with its node named when more than one is connected.
- A project of any node can go into any cluster. It is stored on the cluster's node and leaves
  every other cluster.
- Renaming or deleting a cluster changes that cluster only; its namesakes on other nodes stay.

## 0.5.2

- The Clusters screen shows one tab per cluster on each node: two nodes with a "Personal" each
  show two tabs, each tagged with its node. Editing or deleting a tab changes that node's cluster
  only. The sidebar circles still show namesakes as one.
- The node tag is gone from the sidebar; it stays in the Clusters screen.

## 0.5.1

- With more than one node connected, every project in the sidebar carries a small tag with the
  name of the Paseo it lives on, and so does every project in the Clusters screen.
- Daemons report their machine's name, used when the app has not named the host yet.

## 0.5.0

- A cluster can show an uploaded photo instead of its icon, in the sidebar and the Clusters screen.
- The Clusters screen is registered once for the whole app, so Paseo no longer adds a host picker to switch between daemons; the screen already lists all of them.
- Each daemon reports the app's id for its host, so the screen names every node without visiting it first.
- The language picker is gone: the plugin follows the client's language.

## 0.4.3

- Node versions are a small table: node, Paseo, plugin. A version behind the newest among your
  nodes shows in red, with a tooltip saying what to update.

## 0.4.2

- 0.4.1 on npm was built from a commit that imported package.json, which Paseo refuses to build,
  so installs from npm failed and kept the previous version. Same features, now buildable.

## 0.4.1

- The Clusters screen lists every node with its Paseo and plugin versions, and warns when they
  differ or a node runs a plugin older than 0.4.1, with the command to update.
- Each cluster names the nodes it is on, and each project the node it lives on.

## 0.4.0

- Clusters span every connected daemon. The bar and the Clusters screen list the clusters of all
  of them, and clusters with the same name are shown as one, with the projects of each.
- Filing a project writes it to the daemon that serves it, under a cluster of that name, created
  there if needed; it is dropped from any other daemon's clusters. Nothing else is copied between
  daemons.
- Renaming, recolouring, deleting and reordering a cluster apply on every daemon that has it.
- The selected circle is kept per app instead of per daemon; it starts on Recents after updating.

## 0.3.5

- A "No cluster" tab in the Clusters screen lists the projects no cluster holds yet.
- A freshly opened app could wipe a daemon's clusters. It started from an empty copy at revision 0
  and wrote it before its first read. Clients now write nothing until the daemon has answered, and
  the daemon refuses writes older than what it stores.
- Projects under paths with capitals, as every macOS home has, now find the daemon they belong to.

## 0.3.4

- Recents no longer hides projects that are in no cluster. Once a single project had been filed
  into a cluster, every unfiled project on that daemon dropped out of Recents and was pruned from
  its saved order. Recents now shows everything active within the window; only projects hidden by
  hand stay out.

## 0.3.3

- No more fighting over the bar while daemons are still being updated. A copy from 0.3.3 on stands
  down if one too old to agree on who draws is already drawing, instead of drawing on top of it.
  The sidebar keeps the older copy's behaviour until every daemon is updated and the app reloads,
  but nothing is stranded on screen in the meantime.
- A tooltip left behind by another copy is hidden when the bar mounts.

## 0.3.2

- A tooltip could stay on screen for good. Redrawing the circles replaces the one under the
  pointer, so its mouseleave never arrives and nothing ever hid the tooltip. The bar now hides it
  before redrawing.
- Only one copy of the plugin draws the bar, whatever version it is. 0.3.1 let copies of different
  versions run side by side, and two of them drawing the same bar fought over it, which is what
  stranded the tooltips and doubled the drag handlers. Copies from 0.3.2 on agree on who draws;
  the rest wait for a reload.

## 0.3.1

- Copies of different versions could not share a page. While daemons are updated one at a time,
  the app runs one copy of the plugin per daemon, and they all defer to whichever loaded first.
  A newer copy asking an older one for something it does not have threw, and that daemon's
  clusters never appeared. Each version now takes its own slot and runs on its own until every
  daemon is on the same one.

## 0.3.0

- Recents only listed projects of one daemon. The sidebar mixes projects from every connected
  daemon, but since 0.2.0 the bar read the state of a single one, and its "must belong to a
  cluster" rule was checked against that daemon's clusters — so with a local daemon plus a remote
  one, only the local projects came through.
- Recents now spans every connected daemon. Each project is traced back to the daemon that
  reported it (by path for local projects, by key for the rest), and is judged by that daemon's
  hidden list and clusters. The window is one for the whole bar: the one set on the daemon the bar
  is anchored to.
- Each project's place in Recents is written to its own daemon and nowhere else. The order is
  stored as a sortable mark per project (`recentRank`) instead of a list, because two daemons'
  lists cannot be interleaved but their marks can. An order saved by an older client is read as
  marks, and the list is still written alongside for clients older than this one.
- A project that appears while a cluster is selected now only joins that cluster if it belongs to
  the same daemon.

## 0.2.2

- Recents listed projects that had not been used in days. It took "the record changed" for "the
  user used this": the last-use time came from the agent's `updatedAt` and the workspace's
  `statusEnteredAt`, and the daemon rewrites every agent record when it restarts and re-derives
  workspace status from scratch. One restart stamped every project with the current time, so they
  all landed in Recents no matter how short the window.
- Use is now the user's own mark: the last message sent to a session, or when the session was
  created. Recents also seeds itself from the agent list on start and on every resync, instead of
  waiting for changes to arrive.

## 0.2.1

- Recents showed only part of a project's sessions: any session last used outside the window was
  hidden, even though its project was on the list. The window decides which projects are recent,
  not which of their sessions are shown, so a project on the list now keeps all of them.

## 0.2.0

**Security fix: clusters leaked between accounts.** Up to 0.1.3 the app kept a single cluster state
for every connected daemon, cached under one key, and a pull that found a daemon with no clusters
sent it the client's own. Connecting to somebody else's Paseo therefore wrote your clusters into
their `~/.paseo/plugins/paseo-clusters.json`, and the sidebar showed yours instead of theirs. Your
cluster names and the paths of the projects in them reached daemons that were not yours.

- Clusters are now per daemon. Each one is cached under `paseo-clusters:v1:<serverId>`, where
  `serverId` is the daemon's own identity, reported by the daemon on every read.
- A daemon that comes back empty stays empty. The client never seeds a daemon with its state; it
  writes only what you change while looking at that daemon.
- Nothing is migrated between daemons: clusters already stored stay on the daemon that held them.
  After updating, a daemon that never had clusters of its own starts empty.
- The sidebar bar shows the clusters of the daemon being viewed; opening a daemon's Clusters screen
  points the bar at it, and "+" opens that daemon's screen.

If you connected to a daemon that is not yours while running 0.1.3 or earlier, check its
`~/.paseo/plugins/paseo-clusters.json` and delete what does not belong there.

## 0.1.3

- Hide a project from Recents until it is used again.

## 0.1.2

- Adjustable time in Recents (1–48 h, default 24 h).

## 0.1.1

- One sidebar and one cluster store shared across connected daemons.
- English and Spanish strings with a language picker.

## 0.1.0

- Project clusters for the Paseo sidebar.
