# Changelog

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
