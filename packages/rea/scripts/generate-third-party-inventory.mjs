import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureGeneratedFile } from "./lib/generated-file.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown inventory option: ${argument}`);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const entries = Object.entries(lock.packages)
  .filter(([path]) => path !== "")
  .map(([path, record]) => ({
    path,
    name: record.name ?? path.slice(path.lastIndexOf("node_modules/") + 13),
    version: record.version,
    license: record.license ?? "UNDECLARED",
    resolved: record.resolved,
    integrity: record.integrity,
    dev: record.dev === true,
    optional: record.optional === true,
  }))
  .sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
for (const entry of entries)
  for (const field of ["name", "version", "resolved", "integrity"])
    if (typeof entry[field] !== "string" || entry[field].length === 0)
      throw new Error(`Missing locked ${field}: ${entry.path}`);
const runtime = entries.filter(({ dev }) => !dev);
const runtimeFingerprint = createHash("sha256")
  .update(JSON.stringify(runtime))
  .digest("hex");
const source = [
  "REA npm dependency inventory",
  "Prepared from the root package-lock.json; refresh this inventory when locked dependencies change.",
  "License identifiers are upstream lockfile declarations, not a legal assessment.",
  "Runtime includes transitive and optional platform packages; development includes build, test and website tooling.",
  `Locked package entries: ${entries.length}; runtime: ${runtime.length}.`,
  "Full runtime copyright/license/NOTICE texts: npm-runtime-notices.txt.",
  "",
  ...entries.flatMap((entry) => [
    `${entry.name}@${entry.version} | ${entry.dev ? "development" : "runtime"}${entry.optional ? ", optional" : ""} | ${entry.license}`,
    `  Lockfile path: ${entry.path}`,
    `  Package: https://www.npmjs.com/package/${entry.name}/v/${entry.version}`,
    `  Archive: ${entry.resolved}`,
    `  Integrity: ${entry.integrity}`,
  ]),
  "",
].join("\n");
await ensureGeneratedFile({
  path: join(root, "licenses/npm-dependencies.txt"),
  source,
  check: arguments_.has("--check"),
  generateCommand: "npm run licenses:generate",
});

if (arguments_.has("--check")) {
  const notices = await readFile(
    join(root, "licenses/npm-runtime-notices.txt"),
    "utf8",
  );
  const headings = [...notices.matchAll(/^===== (.+) =====$/gmu)];
  const sections = new Map();
  for (const [index, heading] of headings.entries()) {
    if (sections.has(heading[1]))
      throw new Error(`Duplicate runtime notice: ${heading[1]}`);
    sections.set(
      heading[1],
      notices.slice(
        heading.index + heading[0].length + 1,
        headings[index + 1]?.index,
      ),
    );
  }
  for (const entry of runtime) {
    const identity = `${entry.name}@${entry.version}`;
    const section = sections.get(identity);
    if (section === undefined)
      throw new Error(`Missing runtime notice: ${identity}`);
    const metadata = [
      `Declared license: ${entry.license}`,
      `Archive: ${entry.resolved}`,
      `Integrity: ${entry.integrity}`,
      "",
    ].join("\n");
    if (!section.startsWith(metadata))
      throw new Error(`Runtime notice metadata differs for ${identity}`);
  }
  if (
    !notices
      .slice(0, headings[0]?.index)
      .includes(
        `Runtime dependency fingerprint (SHA-256): ${runtimeFingerprint}\n`,
      )
  )
    throw new Error(
      `Runtime notice fingerprint differs; refresh verified notices for ${runtimeFingerprint}`,
    );
  const references = JSON.parse(
    await readFile(join(root, "licenses/upstream-sources.json"), "utf8"),
  );
  for (const reference of references) {
    const bytes = await readFile(join(root, reference.file));
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256)
      throw new Error(`Preserved notice digest differs: ${reference.file}`);
  }
}
console.log(
  JSON.stringify({
    locked_packages: entries.length,
    runtime_packages: runtime.length,
    runtime_dependency_fingerprint: runtimeFingerprint,
  }),
);
