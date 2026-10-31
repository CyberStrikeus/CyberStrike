import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

const remove = fs.promises.rm;
let observed = false;
fs.promises.rm = async function (path, ...args) {
  const name = basename(String(path));
  if (
    observed ||
    !name.startsWith("rea-process-") ||
    name.startsWith("rea-process-token-")
  )
    return remove.call(this, path, ...args);
  observed = true;
  if (process.env.REA_TEST_CANCEL_DURING_CLEANUP === "1")
    process.kill(process.pid, "SIGINT");
  // Give the CLI signal handler a turn while real resource cleanup is pending.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await remove.call(this, path, ...args);
  await fs.promises.writeFile(
    process.env.REA_TEST_CLEANUP_MARKER,
    JSON.stringify({ path: String(path), removed: true }),
  );
};
syncBuiltinESMExports();
