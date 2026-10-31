import { lstat, realpath, stat } from "node:fs/promises";
import { parse, relative, resolve, sep } from "node:path";

import { createVitest, parseCLI } from "vitest/node";

// CLI file filters are substring matches. Select discovered specifications by
// identity instead, retaining each project's include/exclude and runner settings.
const { filter, options } = parseCLI(["vitest", ...process.argv.slice(2)]);
const vitest = await createVitest({ ...options, watch: false });
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let shutdownSignal;
let closePromise;
const close = () => (closePromise ??= vitest.close());
for (const signal of Object.keys(signalExitCodes))
  process.on(signal, () => {
    if (shutdownSignal !== undefined) return;
    shutdownSignal = signal;
    void close().catch((cause) => {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    });
  });
try {
  if (shutdownSignal === undefined) await vitest.standalone();
  if (shutdownSignal === undefined) {
    const discovered = new Map();
    for (const specification of await vitest.globTestSpecifications()) {
      const path = resolve(specification.moduleId);
      const specifications = discovered.get(path) ?? [];
      specifications.push(specification);
      discovered.set(path, specifications);
    }
    const selected = new Set();
    const missing = [];
    let discoveredByIdentity;
    for (const path of filter) {
      const absolute = resolve(path);
      let matches = discovered.get(absolute) ?? [];
      if (matches.length === 0) {
        try {
          await lstat(absolute);
        } catch (cause) {
          if (cause?.code === "ENOENT" || cause?.code === "ENOTDIR") {
            missing.push(path);
            continue;
          }
          throw cause;
        }
        const [canonical, selectedIdentity] = await Promise.all([
          realpath(absolute),
          stat(absolute, { bigint: true }),
        ]);
        if (discoveredByIdentity === undefined) {
          discoveredByIdentity = new Map();
          for (const [candidate, specifications] of discovered) {
            try {
              const entry = await stat(candidate, { bigint: true });
              const identity = `${entry.dev}:${entry.ino}`;
              const entries = discoveredByIdentity.get(identity) ?? [];
              entries.push([candidate, specifications]);
              discoveredByIdentity.set(identity, entries);
            } catch (cause) {
              if (cause?.code === "ENOENT" || cause?.code === "ENOTDIR")
                continue;
              throw cause;
            }
          }
        }
        const identity = `${selectedIdentity.dev}:${selectedIdentity.ino}`;
        for (const [candidate, specifications] of discoveredByIdentity.get(
          identity,
        ) ?? []) {
          try {
            await lstat(candidate);
          } catch (cause) {
            if (cause?.code === "ENOENT" || cause?.code === "ENOTDIR") continue;
            throw cause;
          }
          if (
            !(await hasMismatchedSymlinkComponent(absolute, candidate)) &&
            (await realpath(candidate)) === canonical
          )
            matches = [...matches, ...specifications];
        }
      }
      if (matches.length === 0) missing.push(path);
      for (const specification of matches) selected.add(specification);
    }
    if (missing.length > 0 || selected.size === 0)
      throw new Error(
        `Selected test files were not discovered: ${missing.join(", ")}`,
      );
    if (shutdownSignal === undefined)
      await vitest.runTestSpecifications([...selected]);
  }
} finally {
  await close();
}
if (shutdownSignal !== undefined)
  process.exitCode = signalExitCodes[shutdownSignal];

async function hasMismatchedSymlinkComponent(selected, candidate) {
  const selectedAbsolute = resolve(selected);
  const candidateAbsolute = resolve(candidate);
  const root = parse(selectedAbsolute).root;
  if (root !== parse(candidateAbsolute).root) return true;
  const selectedParts = relative(root, selectedAbsolute).split(sep);
  const candidateParts = relative(root, candidateAbsolute).split(sep);
  if (selectedParts.length !== candidateParts.length) return true;
  let selectedPath = root;
  let candidatePath = root;
  for (let index = 0; index < selectedParts.length; index += 1) {
    const selectedPart = selectedParts[index];
    const candidatePart = candidateParts[index];
    if (selectedPart === undefined || candidatePart === undefined) return true;
    selectedPath = selectedPath
      ? resolve(selectedPath, selectedPart)
      : selectedPart;
    candidatePath = candidatePath
      ? resolve(candidatePath, candidatePart)
      : candidatePart;
    if (selectedPart !== candidatePart) {
      const [selectedEntry, candidateEntry] = await Promise.all([
        lstat(selectedPath),
        lstat(candidatePath),
      ]);
      // Matching inode/realpath does not make an excluded symlink a discovered path.
      if (selectedEntry.isSymbolicLink() || candidateEntry.isSymbolicLink())
        return true;
    }
  }
  return false;
}
