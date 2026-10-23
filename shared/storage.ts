import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Pictures are resized on upload; this only keeps a stray one from bloating the shared file. */
export const MAX_IMAGE_LENGTH = 200_000;

export const clusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  /** An uploaded picture as a small data URL; shown instead of the icon. */
  image: z.string().max(MAX_IMAGE_LENGTH).optional(),
  projects: z.array(z.string()),
});

/** Only what every client shares; the selected view stays local to each app. */
export const stateSchema = z.object({
  clusters: z.array(clusterSchema),
  /**
   * Where each project sits in Recents, as a sortable mark. The sidebar mixes projects from every
   * connected daemon, so each daemon keeps the marks of its own and the client merges them.
   */
  recentRank: z.record(z.string(), z.number()).optional(),
  /** The same order as a list, for clients older than 0.3.0. */
  recentOrder: z.array(z.string()).optional(),
  /** How long a project stays in Recents, in hours (1–48). */
  recentHours: z.number().int().min(1).max(48).optional(),
  /** Projects hidden from Recents, and when; they return once used after that. */
  recentHidden: z.record(z.string(), z.number()).optional(),
  /** Bumped on every write so clients can tell whose copy is newer. */
  revision: z.number().default(0),
});

export const readState = defineRpc({
  name: "clusters.read",
  input: z.object({}),
  /**
   * `serverId` is the daemon's own identity. The app does not hand client contributions its server
   * id, so clients ask the daemon for it and keep each daemon's clusters apart under it.
   */
  output: z.object({
    serverId: z.string(),
    state: stateSchema.nullable(),
    /** Sent from 0.4.1 on; absent means an older plugin. */
    pluginVersion: z.string().optional(),
    paseoVersion: z.string().nullable().optional(),
    /** The app's id for this daemon's host. Sent from 0.5.0 on, so one screen can name every node. */
    hostId: z.string().nullable().optional(),
    /** The machine's name, the label a host gets by default. Sent from 0.5.1 on. */
    hostName: z.string().optional(),
  }),
});

export const writeState = defineRpc({
  name: "clusters.write",
  input: z.object({ state: stateSchema }),
  output: z.object({ revision: z.number() }),
});
