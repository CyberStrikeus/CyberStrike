import { matchesGlob } from "node:path";

// Candidate ownership only: these leaf adapters and their producer tests can be
// compared with full-suite outcomes. This table never changes test execution.
// Shared application/domain code and dynamic CLI/MCP consumers are not leaf owners.
const OWNERS = {
  adb: ["src/adb/**", "tests/boundary/providers/adb/**"],
  apktool: ["src/apktool/**"],
  dotnet: ["src/dotnet/**"],
  evm: ["src/evm/**", "tests/boundary/evm/**"],
  firmware: ["src/firmware/**", "tests/boundary/firmware/**"],
  flutter: ["src/flutter/**"],
  ghidra: ["src/ghidra/**", "tests/boundary/providers/ghidra/**"],
  hopper: ["src/hopper/**", "tests/boundary/providers/hopper/**"],
  ida: ["src/ida/**", "tests/boundary/providers/ida/**"],
  jeb: ["src/jeb/**"],
  pcap: ["src/pcap/**", "tests/boundary/pcap/**"],
  sqlite: ["src/sqlite/**", "tests/boundary/sqlite/**"],
  wasm: ["src/wasm/**"],
};
const ownersOf = (path) =>
  Object.entries(OWNERS)
    .filter(([, patterns]) => patterns.some((glob) => matchesGlob(path, glob)))
    .map(([owner]) => owner);
const validPath = (path) =>
  typeof path === "string" &&
  /^(src|tests)\//.test(path) &&
  !/[\\\0\r\n]/.test(path) &&
  !path.split("/").some((part) => ["", ".", ".."].includes(part));
const full = (reason, changedPaths = []) => ({
  version: 1,
  mode: "full",
  owners: [],
  changedTests: [],
  changedPaths,
  reason,
});

/** Plan an observational PR subset from the classifier's existing Git diff. */
export function planTestSelection(files, event, tier) {
  if (event !== "pull_request" || tier !== "fast")
    return full("Only ordinary PRs are candidates", files);
  if (!files.length) return full("No changed paths available");
  const owners = new Set();
  const changedTests = [];
  for (const path of files) {
    if (!validPath(path))
      return full(`Shared or unknown input: ${path}`, files);
    const matches = ownersOf(path);
    if (!matches.length) return full(`Shared or unknown input: ${path}`, files);
    for (const owner of matches) owners.add(owner);
    if (path.endsWith(".test.ts")) changedTests.push(path);
  }
  return {
    version: 1,
    mode: "candidate",
    owners: [...owners].sort(),
    changedTests: [...new Set(changedTests)].sort(),
    changedPaths: files,
    reason:
      "Observe affected leaf owners; retain integration and unowned tests",
  };
}

/** Compare a proposal with the full run; missing observations never prove parity. */
export function compareTestSelection(plan, inventory, results) {
  if (
    plan?.version !== 1 ||
    !["full", "candidate"].includes(plan.mode) ||
    !Array.isArray(plan.owners) ||
    plan.owners.some((owner) => !Object.hasOwn(OWNERS, owner)) ||
    !Array.isArray(plan.changedTests) ||
    !Array.isArray(plan.changedPaths) ||
    plan.changedPaths.some((path) => typeof path !== "string") ||
    plan.changedTests.some(
      (path) => !validPath(path) || !path.endsWith(".test.ts"),
    ) ||
    typeof plan.reason !== "string" ||
    (plan.mode === "candidate" && !plan.owners.length) ||
    (plan.mode === "full" && (plan.owners.length || plan.changedTests.length))
  )
    throw new Error("Invalid observational test selection plan");
  const expected = new Set(inventory);
  if (!expected.size || expected.size !== inventory.length)
    throw new Error("Test selection requires a nonempty unique inventory");
  const ownersByFile = new Map(
    plan.mode === "candidate"
      ? inventory.map((path) => [path, ownersOf(path)])
      : [],
  );
  // Removed/renamed tests have no current executable identity. Keep all tests.
  const removed = plan.changedTests.filter((path) => !expected.has(path));
  const missingOwners = plan.owners.filter(
    (owner) =>
      ![...ownersByFile.values()].some((owners) => owners.includes(owner)),
  );
  const effective = removed.length
    ? full(
        `Changed tests absent from current inventory: ${removed.join(", ")}`,
        plan.changedPaths,
      )
    : missingOwners.length
      ? full(
          `Owners without executable tests: ${missingOwners.join(", ")}`,
          plan.changedPaths,
        )
      : plan;
  const selected = [];
  const omitted = [];
  for (const path of inventory.toSorted()) {
    const owners = ownersByFile.get(path) ?? [];
    const keep =
      effective.mode === "full" ||
      !owners.length ||
      effective.changedTests.includes(path) ||
      owners.some((owner) => effective.owners.includes(owner));
    (keep ? selected : omitted).push(path);
  }
  const actual = new Set(results.map((file) => file.name));
  const missing = inventory.filter((path) => !actual.has(path));
  const unexpected = [...actual].filter((path) => !expected.has(path));
  const duplicateFiles = results.length - actual.size;
  const unobserved = results
    .filter((file) => !["passed", "failed"].includes(file.state))
    .map((file) => file.name);
  const omittedSet = new Set(omitted);
  const missedFailures = results
    .filter((file) => omittedSet.has(file.name) && file.state === "failed")
    .map((file) => file.name);
  return {
    version: 1,
    observational: true,
    plan: effective,
    selected,
    omitted,
    missing,
    unexpected,
    duplicateFiles,
    unobserved,
    missedFailures,
    complete:
      !missing.length &&
      !unexpected.length &&
      !duplicateFiles &&
      !unobserved.length,
    // Phase totals are scheduling weights, not an estimate of wall-time savings.
    omittedDurationMs: results
      .filter((file) => omittedSet.has(file.name))
      .reduce((sum, file) => sum + file.durationMs, 0),
  };
}
