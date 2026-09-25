import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const clusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  projects: z.array(z.string()),
});

/** Only what every client shares; the selected view stays local to each app. */
export const stateSchema = z.object({
  clusters: z.array(clusterSchema),
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
  output: z.object({ serverId: z.string(), state: stateSchema.nullable() }),
});

export const writeState = defineRpc({
  name: "clusters.write",
  input: z.object({ state: stateSchema }),
  output: z.object({ revision: z.number() }),
});
