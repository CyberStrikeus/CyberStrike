import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REMEDIATION = "Run `npm ci`, then retry.";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const directDependencies = (rootPackage) => ({
  ...rootPackage.dependencies,
  ...rootPackage.devDependencies,
});

const installedPackageKey = (name) => `node_modules/${name}`;

/** Compare root direct dependencies with npm's hidden installed lockfile. */
export const dependencyInstallProblems = (rootLock, installedLock) => {
  const rootPackage = rootLock.packages?.[""];
  if (rootPackage === undefined)
    return ["package-lock.json does not contain a root package entry"];
  const installedPackages = installedLock.packages ?? {};
  return Object.keys(directDependencies(rootPackage))
    .sort()
    .flatMap((name) => {
      const key = installedPackageKey(name);
      const expected = rootLock.packages?.[key]?.version;
      const actual = installedPackages[key]?.version;
      if (expected === undefined)
        return [`${name}: missing resolved version in package-lock.json`];
      if (actual === undefined)
        return [`${name}: missing from the installed dependency lockfile`];
      return actual === expected
        ? []
        : [`${name}: installed ${actual}, expected ${expected}`];
    });
};

const main = async () => {
  const root = process.cwd();
  try {
    const [rootLock, installedLock] = await Promise.all([
      readJson(resolve(root, "package-lock.json")),
      readJson(resolve(root, "node_modules/.package-lock.json")),
    ]);
    const problems = dependencyInstallProblems(rootLock, installedLock);
    if (problems.length === 0) return;
    process.stderr.write(
      `Direct dependency installation is stale:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n${REMEDIATION}\n`,
    );
    process.exitCode = 1;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unreadable lockfile";
    process.stderr.write(
      `Could not verify the installed direct dependencies: ${reason}\n${REMEDIATION}\n`,
    );
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
