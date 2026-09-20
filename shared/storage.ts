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
  /** Bumped on every write so clients can tell whose copy is newer. */
  revision: z.number().default(0),
});

export const readState = defineRpc({
  name: "clusters.read",
  input: z.object({}),
  output: z.object({ state: stateSchema.nullable() }),
});

export const writeState = defineRpc({
  name: "clusters.write",
  input: z.object({ state: stateSchema }),
  output: z.object({ revision: z.number() }),
});
