import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Observe session paths and target leases without treating their shared parent as a session. */
export async function snapshotHopperRuntime(
  parent,
  targetLeaseDirectory,
  ownedProcessIds,
) {
  const resources = new Set();
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const path = join(parent, entry.name);
    if (!entry.name.startsWith("rea-") || path === targetLeaseDirectory)
      continue;
    if (
      ownedProcessIds !== undefined &&
      (!entry.isDirectory() ||
        !(await belongsToOwnedProcess(path, ownedProcessIds)))
    )
      continue;
    resources.add(path);
  }
  const leaseRoot = await lstat(targetLeaseDirectory).catch(missingIsAbsent);
  if (leaseRoot === undefined) return resources;
  if (!leaseRoot.isDirectory() || leaseRoot.isSymbolicLink()) {
    resources.add(targetLeaseDirectory);
    return resources;
  }
  const leases = await readdir(targetLeaseDirectory).catch(missingIsAbsent);
  for (const name of leases ?? [])
    resources.add(join(targetLeaseDirectory, name));
  return resources;
}

const missingIsAbsent = (cause) => {
  if (cause?.code === "ENOENT") return undefined;
  throw cause;
};

const belongsToOwnedProcess = async (path, ownedProcessIds) => {
  const encoded = await readFile(join(path, "ownership.json"), "utf8").catch(
    missingIsAbsent,
  );
  if (encoded === undefined) return false;
  const ownership = JSON.parse(encoded);
  return (
    ownership !== null &&
    typeof ownership === "object" &&
    Number.isSafeInteger(ownership.parent_pid) &&
    ownedProcessIds.has(ownership.parent_pid)
  );
};
