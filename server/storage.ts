import type { RpcInput } from "@getpaseo/plugin";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { writeState } from "../shared/storage";
import { stateSchema } from "../shared/storage";

/** Shared by every client of this daemon, so clusters follow the machine, not the app. */
const FILE = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugins", "paseo-clusters.json");

export async function readClusters() {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return { state: parsed.success ? parsed.data : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[paseo-clusters] No se pudo leer el estado guardado", error);
    }
    return { state: null };
  }
}

export async function writeClusters({ state }: RpcInput<typeof writeState>) {
  await mkdir(dirname(FILE), { recursive: true });
  const temporary = `${FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, FILE);
  return { revision: state.revision };
}
