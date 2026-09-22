# paseo-plugin-clusters

*English · [Español](README.es.md)*

A [Paseo](https://paseo.sh) plugin that groups your projects into **clusters** and puts them as
circles above the workspace list, Discord-style.

## Installation

```bash
paseo plugin install github:thisjrodriguez/paseo-plugin-clusters
```

![Cluster circles above the Paseo workspace list](images/sidebar.png)

## What it does

- **Circles in the sidebar.** A row above "New workspace". Selecting a cluster filters the native
  list down to its projects.
- **Recents.** Projects used recently (24 hours by default, adjustable from 1 to 48 in the Clusters
  screen). A project enters at the top once, then keeps its place until you drag it elsewhere, and
  drops out once that time passes without use.
- **All.** The full list, exactly as Paseo shows it.
- **Status rings.** Dashed while a workspace in the cluster is running, green when one has finished
  and you have not opened it yet.
- **Drag and drop.** Drag a project onto a circle to move it into that cluster, or up and down to
  order it inside the cluster. The circles reorder by dragging too.
- **Management screen.** Create clusters with a name, an icon (letter, emoji or symbol) and any hex
  color; move projects between clusters; search; and an All tab listing unassigned projects.
- **One project, one cluster.** New projects join whichever cluster is selected.
- **Synced.** Clusters live on the daemon, so every client connected to that machine shares them.
  The selected circle stays per client.
- **English and Spanish**, following the client's language, with a picker in the cluster form.

## Limitations

- Paseo **0.8.0** or newer.
- **Desktop only.** The circles are injected into the app's web UI, so they do not appear on iOS or
  Android. On mobile the Clusters screen still lists your clusters and their workspaces.
- The plugin relies on the `data-testid` attributes of Paseo's sidebar. They are stable, but a Paseo
  update may change them; open an issue if something stops showing up.

## Development

```bash
npm install
npm run typecheck
paseo plugin install /path/to/paseo-plugin-clusters
paseo plugin reload paseo-clusters   # after every change
paseo plugin logs paseo-clusters
```

| File | Purpose |
| --- | --- |
| `index.client.tsx` | Registers the screen and menu, starts the bar and the sync |
| `client/web.ts` | Circle bar, native list filtering, drag handling and state |
| `client/clusters.tsx` | Cluster management screen |
| `client/cluster-form.tsx` | Create and edit form |
| `index.server.ts`, `server/storage.ts` | Stores clusters on the daemon |
| `shared/i18n.ts` | English and Spanish strings |

## License

MIT
