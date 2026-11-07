#!/usr/bin/env node
// Compile the packaged Ghidra bridge sources against an existing Ghidra
// installation's jars. Ghidra's script provider compiles the whole bridge
// directory when a session starts, so one unresolved symbol disables every
// operation and surfaces only after import and auto-analysis. This check
// reports the same javac diagnostics without launching Ghidra or selecting,
// importing or executing a target.
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The pinned Node toolchain strips types from these dependency-free owners;
// this preflight therefore uses runtime facts without needing npm ci or a build.
import { GHIDRA_BRIDGE_SOURCES } from "../src/ghidra/GhidraBridgeSources.ts";
import { parseGhidraJavaProperties } from "../src/ghidra/GhidraJavaProperties.ts";
import {
  SUPPORTED_GHIDRA_VERSION,
  SUPPORTED_GHIDRA_JAVA_MAJOR,
  ghidraReleaseAccepted,
  ghidraReleaseLine,
} from "../src/ghidra/GhidraReleasePolicy.ts";

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 &&
    !["--check-sdk-pin", "--verified-sdk"].includes(args[0]))
)
  fail(
    "Usage: verify-ghidra-bridge-sources.mjs [--check-sdk-pin|--verified-sdk]",
  );
if (args[0] === "--check-sdk-pin") {
  let url;
  try {
    url = new URL(process.env.GHIDRA_RELEASE_URL);
  } catch {
    fail("GHIDRA_RELEASE_URL must name the checksum-pinned official release");
  }
  const prefix = `/NationalSecurityAgency/ghidra/releases/download/Ghidra_${SUPPORTED_GHIDRA_VERSION}_build/ghidra_${SUPPORTED_GHIDRA_VERSION}_PUBLIC_`;
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix) ||
    !url.pathname.endsWith(".zip") ||
    !/^[a-f0-9]{64}$/iu.test(process.env.GHIDRA_RELEASE_SHA256 ?? "")
  )
    fail(
      `SDK URL and SHA256 must match verified Ghidra ${SUPPORTED_GHIDRA_VERSION}`,
    );
  console.log(`GHIDRA_JAVA_MAJOR=${SUPPORTED_GHIDRA_JAVA_MAJOR}`);
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = join(root, "bridge/ghidra");
const install = process.env.GHIDRA_INSTALL_DIR;
if (!install)
  fail(
    `Set GHIDRA_INSTALL_DIR to an existing Ghidra ${ghidraReleaseLine()} installation (verified with ${SUPPORTED_GHIDRA_VERSION}). REA does not install Ghidra.`,
  );
const properties = await readFile(
  join(install, "Ghidra/application.properties"),
  "latin1",
).catch((cause) =>
  fail(
    `GHIDRA_INSTALL_DIR has no readable Ghidra/application.properties: ${cause.message}`,
  ),
);
const parsedProperties = parseGhidraJavaProperties(properties);
if (!parsedProperties.ok) fail(parsedProperties.error);
const version = parsedProperties.value.get("application.version");
if (!ghidraReleaseAccepted(version))
  fail(
    `Bridge sources require Ghidra ${ghidraReleaseLine()} (verified with ${SUPPORTED_GHIDRA_VERSION}). Observed application.version=${version === undefined ? "missing" : JSON.stringify(version)}.`,
  );
if (args[0] === "--verified-sdk" && version !== SUPPORTED_GHIDRA_VERSION)
  fail(
    `CI SDK must be verified Ghidra ${SUPPORTED_GHIDRA_VERSION}; observed ${JSON.stringify(version)}`,
  );
const sourceNames = (await readdir(bridge, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".java"))
  .map((entry) => entry.name);
for (const name of Object.values(GHIDRA_BRIDGE_SOURCES))
  if (!sourceNames.includes(name))
    fail(`Required Ghidra bridge source is missing: bridge/ghidra/${name}`);
const requiredNames = new Set(Object.values(GHIDRA_BRIDGE_SOURCES));
const unregistered = sourceNames.filter((name) => !requiredNames.has(name));
if (unregistered.length)
  fail(
    `Ghidra bridge sources absent from the manifest: ${unregistered.join(", ")}`,
  );
const sources = sourceNames
  .map((name) => relative(root, join(bridge, name)))
  .sort();

const javac = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", "javac")
  : "javac";
const banner = run(javac, ["-version"]);
if (banner.error || banner.status !== 0)
  fail(`javac is unavailable: ${banner.error?.message ?? output(banner)}`);
const major = Number(/^javac (\d+)/mu.exec(output(banner))?.[1]);
if (!Number.isInteger(major) || major < SUPPORTED_GHIDRA_JAVA_MAJOR)
  fail(
    `Ghidra ${ghidraReleaseLine()} compiles bridge scripts with Java ${SUPPORTED_GHIDRA_JAVA_MAJOR} or newer. Observed: ${output(banner) || "no version"}. REA does not install or upgrade Java.`,
  );

const jars = (
  await readdir(join(install, "Ghidra"), {
    recursive: true,
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".jar"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
if (jars.length === 0) fail(`No jars found under ${join(install, "Ghidra")}.`);

const scratch = await mkdtemp(join(tmpdir(), "rea-ghidra-bridge-"));
try {
  // An argument file keeps the jar class path below Windows' command length.
  const argumentFile = join(scratch, "javac.args");
  await writeFile(
    argumentFile,
    [
      "-proc:none",
      "-encoding",
      "UTF-8",
      "--release",
      String(SUPPORTED_GHIDRA_JAVA_MAJOR),
      "-cp",
      jars.join(process.platform === "win32" ? ";" : ":"),
      "-d",
      join(scratch, "classes"),
      ...sources,
    ]
      .map((s) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
      .join("\n"),
  );
  // Sources are repository-relative, so diagnostics name bridge/ghidra/<file>:<line>.
  const result = run(javac, ["-J-Xmx1g", `@${argumentFile}`]);
  if (result.error || result.status !== 0) {
    // Set the status instead of exiting so the scratch directory is removed.
    process.stderr.write(
      `${output(result) || result.error?.message || "javac failed"}\nGhidra ${version} could not compile the packaged bridge sources; the provider would fail at session start.\n`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        ghidra_version: version,
        javac: output(banner),
        class_path_jars: jars.length,
        sources,
      }),
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
