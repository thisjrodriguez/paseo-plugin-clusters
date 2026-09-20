import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readClusters, writeClusters } from "./server/storage";
import { readState, writeState } from "./shared/storage";

export default function contribute(server: PluginServerContext) {
  server.handle(readState, readClusters);
  server.handle(writeState, writeClusters);
  return () => {};
}
