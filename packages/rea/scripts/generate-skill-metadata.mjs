import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureGeneratedFile } from "./lib/generated-file.mjs";
import { importVerifierSource } from "./lib/verifier-source-loader.mjs";

const { addSkillManifestToolCount } = await importVerifierSource(
  new URL("../src/domain/skillManifest.ts", import.meta.url).href,
  import.meta.url,
);

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown skill metadata option: ${argument}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, ".agents/skills/reverse-engineer-anything");
const outputRoot = join(root, "skills/reverse-engineer-anything");
const check = arguments_.has("--check");
const current = (
  await readFile(join(sourceRoot, "SKILL.md"), "utf8")
).replaceAll("\r\n", "\n");
const cacheBust = String(Date.now());
const { FULL_CATALOG_IDENTITY } = await import(
  `${pathToFileURL(join(root, "dist/catalogIdentity.js")).href}?${cacheBust}`
);
const { PRODUCT_IDENTITY } = await import(
  `${pathToFileURL(join(root, "dist/identity.js")).href}?${cacheBust}`
);
// A shipped skill must run the version it ships with, not whatever `@latest` resolves to.
const latestSpecifier = PRODUCT_IDENTITY.packageSpecifier;
const pinnedSpecifier = PRODUCT_IDENTITY.registrationPackageSpecifier;
const generated = addSkillManifestToolCount(
  current,
  FULL_CATALOG_IDENTITY.counts.mcp_tools,
);
if (!generated.ok) throw generated.error;
const source = generated.value.replaceAll(latestSpecifier, pinnedSpecifier);
const paths = await filePaths(sourceRoot);
// Rebuild this owned output directory so removed references cannot survive a build.
if (!check) await rm(outputRoot, { recursive: true, force: true });
for (const relativePath of paths) {
  const path = join(outputRoot, relativePath);
  if (!check) await mkdir(dirname(path), { recursive: true });
  await ensureGeneratedFile({
    path,
    source:
      relativePath === "SKILL.md"
        ? source
        : (await readFile(join(sourceRoot, relativePath), "utf8")).replaceAll(
            "\r\n",
            "\n",
          ),
    check,
    generateCommand: "npm run docs:generate",
  });
}
if (
  check &&
  JSON.stringify(await filePaths(outputRoot)) !== JSON.stringify(paths)
)
  throw new Error(
    "Generated skill file inventory drifted; run npm run docs:generate",
  );

async function filePaths(directory, prefix = "") {
  const paths = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      paths.push(
        ...(await filePaths(join(directory, entry.name), relativePath)),
      );
    else if (entry.isFile()) paths.push(relativePath);
    else
      throw new Error(
        `Skill bundle requires regular files or directories: ${relativePath}`,
      );
  }
  return paths;
}
