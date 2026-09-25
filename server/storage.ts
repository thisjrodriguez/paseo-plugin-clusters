import type { RpcInput } from "@getpaseo/plugin";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { writeState } from "../shared/storage";
import { stateSchema } from "../shared/storage";

/** Shared by every client of this daemon, so clusters follow the machine, not the app. */
const HOME = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
const FILE = join(HOME, "plugins", "paseo-clusters.json");

/**
 * This daemon's identity: stable across restarts, different for every daemon, and derived rather
 * than stored so nothing new is written. Clients key their local copy of the clusters by it, which
 * is what keeps one daemon's clusters out of another's.
 */
const SERVER_ID = createHash("sha256").update(`${hostname()}\u0000${resolve(HOME)}`).digest("hex").slice(0, 16);

export async function readClusters() {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return { serverId: SERVER_ID, state: parsed.success ? parsed.data : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[paseo-clusters] No se pudo leer el estado guardado", error);
    }
    return { serverId: SERVER_ID, state: null };
  }
}

export async function writeClusters({ state }: RpcInput<typeof writeState>) {
  await mkdir(dirname(FILE), { recursive: true });
  const temporary = `${FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, FILE);
  return { revision: state.revision };
}
