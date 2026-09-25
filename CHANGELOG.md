# Changelog

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
