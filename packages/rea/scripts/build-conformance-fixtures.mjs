import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  generateLargeFixture,
  HOPPER_C_ORACLE,
  LARGE_FIXTURE_COUNT,
  sha256,
  sourceDigest,
} from "./lib/conformance-fixtures.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const sourceRoot = join(root, "tests/conformance");
const outputRoot = resolve(
  process.env.REA_CONFORMANCE_BUILD ?? join(root, "build/conformance"),
);
const hostPlatform = platform();
if (hostPlatform !== "darwin" && hostPlatform !== "linux")
  throw new Error("Conformance fixtures support macOS and Linux hosts");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const architecture = arch();
const toolchain =
  hostPlatform === "darwin"
    ? await macToolchain(architecture)
    : await linuxToolchain();
const symbolPrefix = hostPlatform === "darwin" ? "_" : "";
const fixtures = [];

await buildPortableFixtures();
if (hostPlatform === "darwin") await buildDarwinFixtures();

const manifest = {
  platform: hostPlatform,
  architecture,
  generatedAt: new Date(0).toISOString(),
  fixtures,
};
await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ outputRoot, fixtureCount: fixtures.length, platform: hostPlatform, architecture })}\n`,
);

async function buildPortableFixtures() {
  await build({
    name: "c",
    sources: ["c/fixture.c"],
    arguments: [
      ...toolchain.common,
      join(sourceRoot, "c/fixture.c"),
      "-o",
      join(outputRoot, "c"),
    ],
    expectations: {
      symbols: ["rea_entry", "rea_branch", "rea_leaf", "rea_c_global"].map(
        (name) => `${symbolPrefix}${name}`,
      ),
      strings: ["REA_C_ENTRY", "REA_C_LEAF"],
      hopperOracle: HOPPER_C_ORACLE,
    },
  });
  for (const version of ["v1", "v2"]) {
    const second = version === "v2";
    await build({
      name: `version-${version}`,
      sources: [`versions/${version}.c`],
      arguments: [
        ...toolchain.common,
        join(sourceRoot, `versions/${version}.c`),
        "-o",
        join(outputRoot, `version-${version}`),
      ],
      expectations: {
        symbols: [
          `${symbolPrefix}rea_version_entry`,
          `${symbolPrefix}rea_version_leaf`,
          ...(second ? [`${symbolPrefix}rea_added`] : []),
        ],
        strings: [second ? "REA_VERSION_TWO" : "REA_VERSION_ONE"],
      },
    });
  }
  const largeSource = generateLargeFixture();
  const largePath = join(outputRoot, "large.c");
  await writeFile(largePath, largeSource);
  await build({
    name: "large",
    sources: [{ path: "generated/large.c", content: largeSource }],
    arguments: [
      ...toolchain.common,
      largePath,
      "-o",
      join(outputRoot, "large"),
    ],
    expectations: {
      symbolPrefix: `${symbolPrefix}rea_inventory_`,
      symbolCount: LARGE_FIXTURE_COUNT,
      stringPrefix: "REA_INVENTORY_",
      stringCount: LARGE_FIXTURE_COUNT,
    },
  });
}

async function buildDarwinFixtures() {
  const sdkPath = toolchain.sdkPath;
  if (sdkPath === undefined) throw new Error("macOS SDK path is unavailable");
  await build({
    name: "objc",
    sources: ["objc/fixture.m"],
    arguments: [
      ...toolchain.common,
      "-fobjc-arc",
      join(sourceRoot, "objc/fixture.m"),
      "-framework",
      "Foundation",
      "-o",
      join(outputRoot, "objc"),
    ],
    expectations: {
      symbols: ["_OBJC_CLASS_$_REAWidget"],
      strings: ["REAWidget", "REAWidgetDelegate", "performAction:error:"],
    },
  });
  await build({
    name: "napi",
    sources: ["napi/fixture.c"],
    arguments: [
      ...toolchain.common,
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      join(sourceRoot, "napi/fixture.c"),
      "-o",
      join(outputRoot, "fixture.node"),
    ],
    expectations: {
      symbols: ["_napi_register_module_v1"],
      strings: ["reaProbeOne", "reaProbeTwo", "reaProbeThree"],
    },
  });
  try {
    const swiftc = (await exec("xcrun", ["--find", "swiftc"])).stdout.trim();
    const swiftVersion = firstLine((await exec(swiftc, ["--version"])).stdout);
    await build({
      name: "swift",
      sources: ["swift/fixture.swift"],
      arguments: [
        "-sdk",
        sdkPath,
        "-Onone",
        "-g",
        join(sourceRoot, "swift/fixture.swift"),
        "-o",
        join(outputRoot, "swift"),
      ],
      expectations: {
        strings: [
          "REA_SWIFT_EXECUTE",
          "REAService",
          "REARecord",
          "REAState",
          "REAProtocol",
        ],
      },
      compiler: swiftc,
      compilerVersion: swiftVersion,
    });
  } catch (cause) {
    process.stderr.write(
      `Skipping optional Swift fixture: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
  }
}

async function build(input) {
  const compiler = input.compiler ?? toolchain.compiler;
  const compilerVersion = input.compilerVersion ?? toolchain.version;
  const normalized = await Promise.all(
    input.sources.map(async (source) => {
      if (typeof source !== "string") return source;
      return {
        path: source,
        content: await readFile(join(sourceRoot, source), "utf8"),
      };
    }),
  );
  await exec(compiler, input.arguments, { maxBuffer: 20 * 1024 * 1024 });
  const artifactPath = input.arguments.at(-1);
  if (typeof artifactPath !== "string")
    throw new Error(`Missing output for ${input.name}`);
  const artifact = await readFile(artifactPath);
  fixtures.push({
    name: input.name,
    artifact: relative(outputRoot, artifactPath),
    artifactSha256: sha256(artifact),
    sourceSha256: sourceDigest(normalized),
    sources: normalized.map(({ path, content }) => ({
      path,
      sha256: sha256(content),
    })),
    compiler: {
      path: compiler,
      version: compilerVersion,
      arguments: input.arguments,
    },
    expectations: input.expectations,
  });
}

async function macToolchain(architecture) {
  const compiler = (await exec("xcrun", ["--find", "clang"])).stdout.trim();
  const sdkPath = (await exec("xcrun", ["--show-sdk-path"])).stdout.trim();
  const clangArchitecture = architecture === "x64" ? "x86_64" : architecture;
  return {
    compiler,
    version: firstLine((await exec(compiler, ["--version"])).stdout),
    sdkPath,
    common: [
      "-arch",
      clangArchitecture,
      "-isysroot",
      sdkPath,
      "-O0",
      "-g",
      "-fno-inline",
    ],
  };
}

async function linuxToolchain() {
  const requested = process.env.CC ?? "cc";
  const compiler = requested.includes("/")
    ? resolve(requested)
    : (await exec("which", [requested])).stdout.trim();
  if (compiler.length === 0)
    throw new Error(`C compiler not found: ${requested}`);
  return {
    compiler,
    version: firstLine((await exec(compiler, ["--version"])).stdout),
    common: [
      "-O0",
      "-g",
      "-fno-inline",
      "-fno-omit-frame-pointer",
      "-fno-pie",
      "-no-pie",
    ],
  };
}

function firstLine(value) {
  return value.split("\n")[0] ?? "unknown";
}
