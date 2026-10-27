Groups your projects into clusters and shows them as a row of circles above the sidebar workspace list. Selecting a circle filters the native list down to that cluster's projects.

## How it works

The row sits above the "New workspace" button and is anchored to it, so it only appears while that button is visible in the sidebar. If you hid "New workspace", turn it back on to see the circles.

## Features

- **Recents.** Projects used recently, 24 hours by default and adjustable from 1 to 48 in the Clusters screen. A project enters at the top once, keeps its place until you drag it, and drops out when the window passes without a message to one of its sessions. You can hide a project from Recents until it is used again.
- **All.** The full list, as Paseo shows it.
- **Status rings.** Dashed while a workspace in the cluster is running, green when one has finished and you have not opened it yet.
- **Drag and drop.** Drag a project onto a circle to move it into that cluster, or within the list to order it. Circles reorder by dragging too.
- **Clusters screen.** Create clusters with a name, an icon (letter, emoji or symbol) and a hex color, move projects between clusters, and search.
- **Several daemons.** With several daemons connected, the bar and the Clusters screen show the clusters of all of them. Each cluster is stored on the daemon it was created on and can hold projects from any daemon.
- English and Spanish, following the client language.

## Data

Clusters and Recents ordering are stored as files on each daemon. The plugin sends nothing outside your Paseo hosts.

## Limitations

- Requires Paseo 0.8.0 or later.
- Desktop only for the circles: they are injected into the app's web interface, so they do not appear on iOS or Android. On mobile, the Clusters screen still lists your clusters and their workspaces.
- The bar relies on `data-testid` attributes of Paseo's sidebar. A Paseo update may change them.
