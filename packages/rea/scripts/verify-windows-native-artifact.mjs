#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = new URL("src/domain/windowsNativeArtifact.ts", root);
let sourceExists = true;
try {
  await access(source);
} catch (cause) {
  if (cause?.code !== "ENOENT") throw cause;
  sourceExists = false;
}
const owner = sourceExists
  ? await (
      await import("./lib/verifier-source-loader.mjs")
    ).importVerifierSource(source.href, import.meta.url)
  : await import(new URL("dist/domain/windowsNativeArtifact.js", root).href);
const {
  WINDOWS_NATIVE_ARTIFACT,
  parseWindowsNativeManifest,
  validateWindowsNativeArtifact,
} = owner;
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const parsed = parseWindowsNativeManifest(
  JSON.parse(
    await readFile(new URL("native/windows/build/manifest.json", root), "utf8"),
  ),
  packageJson.version,
);
if (!parsed.ok) throw parsed.error;
const manifest = parsed.value;
const bytes = await readFile(
  new URL(`native/windows/build/${WINDOWS_NATIVE_ARTIFACT.artifact}`, root),
);
const valid = validateWindowsNativeArtifact(manifest, bytes);
if (!valid.ok) throw valid.error;
process.stdout.write(
  `${JSON.stringify({ ok: true, ...manifest, artifactBytes: bytes.length })}\n`,
);
