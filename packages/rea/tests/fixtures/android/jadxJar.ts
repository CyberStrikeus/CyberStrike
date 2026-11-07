import { writeOrderedZip } from "../artifactEntryOrder.js";

/** ZIP classpath inventory for synthetic protocol tests; not executable bytecode. */
export const writeJadxJarInventory = (
  path: string,
  extraEntries: readonly string[] = [],
): Promise<void> =>
  writeOrderedZip(path, [
    "com/atxx/jhmcp/JadxSession.class",
    "com/atxx/jhmcp/SessionHolder.class",
    "jadx/api/JadxDecompiler.class",
    "com/google/gson/Gson.class",
    "io/modelcontextprotocol/kotlin/sdk/server/Server.class",
    ...extraEntries,
  ]);
