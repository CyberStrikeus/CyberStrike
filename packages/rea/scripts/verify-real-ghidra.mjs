#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { resolveGhidraAnalysisProfile } from "../dist/ghidra/GhidraAnalysisProfile.js";
import { GhidraClient } from "../dist/ghidra/GhidraClient.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { SUPPORTED_GHIDRA_VERSION } from "../dist/ghidra/GhidraReleasePolicy.js";
import { GhidraHeadlessLauncher } from "../dist/ghidra/GhidraLauncher.js";
import { GHIDRA_PROVIDER_IDENTITY } from "../dist/ghidra/GhidraProviderCapabilities.js";

import {
  assertCleanup,
  assertCrossFixture,
  assertDebugFixture,
  assertMalformedFixture,
  assertRuntimeCoordinates,
  assertSession,
  assertStrippedFixture,
  summary,
} from "./verify-real-ghidra-assertions.mjs";
import {
  allItems,
  call,
  verifyInventoryOperations,
} from "./verify-real-ghidra-inventory.mjs";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import { hasTypedSwitchEvidence } from "./verify-real-ghidra-switch-assertions.mjs";

import {
  verifyDenseDefaultReturn,
  verifyJumpTableDenseSwitch,
  verifyNativeTypeLayout,
  verifyRelativeSwitch,
  verifyRelativeSignedSwitch,
  verifyNativeValueTrace,
} from "./verify-real-ghidra-function.mjs";
const exec = promisify(execFile);
const verifierRun = createVerifierRun();
let report;
const installDir = process.env.GHIDRA_INSTALL_DIR;
if (installDir === undefined || !isAbsolute(installDir))
  throw new Error(
    "Set GHIDRA_INSTALL_DIR to the absolute root of an extracted Ghidra 12.1.4 release.",
  );
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir,
  ...(process.env.JAVA_HOME === undefined
    ? {}
    : { javaHome: process.env.JAVA_HOME }),
});
if (
  installation.status !== "available" ||
  installation.analyzeHeadlessPath === null
)
  throw new Error(
    `Ghidra installation is unavailable: ${JSON.stringify(installation)}`,
  );
if (installation.providerVersion !== SUPPORTED_GHIDRA_VERSION)
  throw new Error("Ghidra provider version commitment drifted");

const crossFormat = process.argv.includes("--cross-format");
const aarch64JumpTableOnly = process.argv.includes("--aarch64-jump-table");
const expectedNativeTarget = nativeFixtureTarget(
  process.platform,
  process.arch,
);
const fixtureRoot = await mkdtemp(join(tmpdir(), "rea-ghidra-fixtures-"));
const sourcePath = fileURLToPath(
  new URL("../tests/conformance/ghidra/inventory.c", import.meta.url),
);
const crossFormatSourcePath = fileURLToPath(
  new URL("../tests/conformance/ghidra/cross-format.c", import.meta.url),
);
const debugPath = join(fixtureRoot, "rea-ghidra-inventory-debug");
const layoutPath = join(fixtureRoot, "rea-ghidra-layout.o");
const strippedPath = join(fixtureRoot, "rea-ghidra-inventory-stripped");
const jumpTablePath = join(fixtureRoot, "rea-ghidra-inventory-jump");
const arm64ElfPath = join(fixtureRoot, "rea-ghidra-cross-arm64");
const peObjectPath = join(fixtureRoot, "rea-ghidra-cross-x86_64.obj");
const pePath = join(fixtureRoot, "rea-ghidra-cross-x86_64.exe");
const peImportLibraryPath = join(fixtureRoot, "rea-ghidra-cross-x86_64.lib");
const machObjectPath = join(fixtureRoot, "rea-ghidra-cross-x86_64.o");
const malformedPath = join(fixtureRoot, "rea-ghidra-malformed");
const compiler = process.env.REA_CC ?? "cc";
const clang = process.env.REA_CLANG ?? "clang";
const lld = process.env.REA_LLD ?? "ld.lld";
const lldLink = process.env.REA_LLD_LINK ?? "lld-link";
const lane = crossFormat
  ? "cross-format"
  : aarch64JumpTableOnly
    ? "AArch64 jump-table"
    : "host-format";
const toolchain = new Map([[compiler, "host fixture compiler"]]);
if (crossFormat || aarch64JumpTableOnly)
  toolchain.set(clang, "cross-format clang compiler");
if (crossFormat) {
  toolchain.set(lld, "LLVM LLD linker");
  toolchain.set(lldLink, "Windows PE linker");
}
const crossTarget = crossFormat
  ? "aarch64-linux-gnu, x86_64-pc-windows-msvc, x86_64-apple-darwin"
  : aarch64JumpTableOnly
    ? "aarch64-linux-gnu"
    : `${expectedNativeTarget.format}/${expectedNativeTarget.architecture}`;
for (const [command, role] of toolchain) {
  try {
    await exec(command, [command === lldLink ? "/?" : "--version"]);
  } catch (cause) {
    throw new Error(
      `Ghidra ${lane} verification cannot run for target ${crossTarget}: required ${role} '${command}' is unavailable or failed its preflight.`,
      { cause },
    );
  }
}
try {
  const common = ["-O0", "-g", "-fno-inline"];
  if (expectedNativeTarget.format === "elf") common.push("-fno-pie", "-no-pie");
  await exec(compiler, [...common, sourcePath, "-o", debugPath]);
  await exec(compiler, [
    "-O0",
    "-g",
    "-gdwarf-4",
    "-c",
    sourcePath,
    "-o",
    layoutPath,
  ]);
  const strippedFlags = [...common, "-s"];
  if (expectedNativeTarget.format === "mach-o")
    strippedFlags.push("-fvisibility=hidden");
  await exec(compiler, [...strippedFlags, sourcePath, "-o", strippedPath]);
  // The dense jump-table oracle needs the switch lowered to a table: GCC 16 and
  // later expand dense switches as compare chains at -O0, so the CLI oracle
  // runs against an optimized build while the debug fixture keeps its -O0
  // stack-local and DWARF shape.
  const jumpTableFlags = ["-O2", "-g", "-fno-inline"];
  if (expectedNativeTarget.format === "elf")
    jumpTableFlags.push("-fno-pie", "-no-pie");
  await exec(compiler, [...jumpTableFlags, sourcePath, "-o", jumpTablePath]);
  const crossTargets = [];
  if (aarch64JumpTableOnly) {
    const relativeSource = fileURLToPath(
      new URL("../tests/conformance/ghidra/relative-switch.S", import.meta.url),
    );
    for (const entrySize of [1, 2]) {
      for (const format of [
        "elf",
        ...(expectedNativeTarget.architecture === "arm64" ? ["mach-o"] : []),
      ]) {
        const targetPath = join(
          fixtureRoot,
          `relative-${entrySize}-${format}.o`,
        );
        await exec(clang, [
          ...(format === "elf" ? ["--target=aarch64-linux-gnu"] : []),
          `-DREA_ENTRY_BYTES=${entrySize}`,
          "-c",
          relativeSource,
          "-o",
          targetPath,
        ]);
        crossTargets.push([
          targetPath,
          `relative-${entrySize}`,
          { format, architecture: "arm64" },
        ]);
      }
    }
    const signedRelativeSource = fileURLToPath(
      new URL(
        "../tests/conformance/ghidra/relative-switch-signed.S",
        import.meta.url,
      ),
    );
    for (const selectorBias of [0, 2, 10]) {
      for (const format of [
        "elf",
        ...(expectedNativeTarget.architecture === "arm64" ? ["mach-o"] : []),
      ]) {
        const targetPath = join(
          fixtureRoot,
          `relative-signed-${selectorBias}-${format}.o`,
        );
        await exec(clang, [
          ...(format === "elf" ? ["--target=aarch64-linux-gnu"] : []),
          `-DREA_SELECTOR_BIAS=${selectorBias}`,
          "-c",
          signedRelativeSource,
          "-o",
          targetPath,
        ]);
        crossTargets.push([
          targetPath,
          `relative-signed-${selectorBias}`,
          { format, architecture: "arm64" },
        ]);
      }
    }

    await exec(clang, [
      "--target=aarch64-linux-gnu",
      "-O2",
      "-g",
      "-fno-inline",
      "-fno-pie",
      "-c",
      crossFormatSourcePath,
      "-o",
      arm64ElfPath,
    ]);
    crossTargets.push([
      arm64ElfPath,
      "aarch64-jump-table",
      { format: "elf", architecture: "arm64" },
    ]);
  } else if (crossFormat) {
    await exec(clang, [
      "--target=aarch64-linux-gnu",
      "-O2",
      "-g",
      "-fno-inline",
      "-fno-pie",
      "-nostdlib",
      "-static",
      "-fuse-ld=lld",
      crossFormatSourcePath,
      "-Wl,-e,rea_cross_start",
      "-o",
      arm64ElfPath,
    ]);
    await exec(clang, [
      "--target=x86_64-pc-windows-msvc",
      "-O0",
      "-gcodeview",
      "-fno-inline",
      "-c",
      crossFormatSourcePath,
      "-o",
      peObjectPath,
    ]);
    await exec(lldLink, [
      "/entry:rea_cross_start",
      "/subsystem:console",
      "/nodefaultlib",
      "/export:rea_cross_entry",
      `/implib:${peImportLibraryPath}`,
      `/out:${pePath}`,
      peObjectPath,
    ]);
    await exec(clang, [
      "--target=x86_64-apple-darwin",
      "-O0",
      "-g",
      "-fno-inline",
      "-c",
      crossFormatSourcePath,
      "-o",
      machObjectPath,
    ]);
    crossTargets.push(
      [
        arm64ElfPath,
        "cross-arm64-elf",
        { format: "elf", architecture: "arm64" },
      ],
      [pePath, "cross-x86_64-pe", { format: "pe", architecture: "x86_64" }],
      [
        machObjectPath,
        "cross-x86_64-mach-o",
        { format: "mach-o", architecture: "x86_64" },
      ],
    );
  }
  await writeFile(malformedPath, Buffer.from("not-a-binary\n", "utf8"));

  const debug = await verifyTarget(debugPath, "debug", expectedNativeTarget);
  assertDebugFixture(debug);
  const layout = await verifyTarget(
    layoutPath,
    "type-layout",
    expectedNativeTarget,
  );
  const stripped = await verifyTarget(
    strippedPath,
    "stripped",
    expectedNativeTarget,
  );
  assertStrippedFixture(stripped);
  const jumpTable = await verifyTarget(
    jumpTablePath,
    "jump-table",
    expectedNativeTarget,
  );
  const crossResults = [];
  for (const [targetPath, variant, expectedTarget] of crossTargets) {
    const result = await verifyTarget(targetPath, variant, expectedTarget);
    if (variant !== "aarch64-jump-table" && !variant.startsWith("relative-"))
      assertCrossFixture(result);
    crossResults.push(result);
  }
  await assertMalformedFixture(malformedPath);

  const customPath = process.env.GHIDRA_TARGET_PATH;
  const custom =
    customPath === undefined ? null : await verifyTarget(customPath, "custom");
  report = {
    ok: true,
    provider: { id: "ghidra", version: SUPPORTED_GHIDRA_VERSION },
    verification_lane: aarch64JumpTableOnly
      ? "aarch64-jump-table"
      : crossFormat
        ? "cross-format"
        : "host-native",
    fixture_sources:
      crossFormat || aarch64JumpTableOnly
        ? [sourcePath, crossFormatSourcePath]
        : [sourcePath],
    fixtures: [debug, stripped, layout, jumpTable, ...crossResults].map(
      summary,
    ),
    malformed_target: "rejected-before-provider-start",
    native_api_cli: aarch64JumpTableOnly
      ? (crossResults[0]?.native_api_cli ?? null)
      : jumpTable.native_api_cli,
    native_value_e2e: debug.native_values,
    custom_target: custom === null ? null : summary(custom),
    cleanup: "complete",
  };
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
process.stdout.write(
  `${JSON.stringify({ verifier_run: await completeVerifierRun(verifierRun), ...report })}\n`,
);

function nativeFixtureTarget(platform, architecture) {
  const supportedTargets = {
    "darwin-arm64": { format: "mach-o", architecture: "arm64" },
    "darwin-x64": { format: "mach-o", architecture: "x86_64" },
    "linux-x64": { format: "elf", architecture: "x86_64" },
    "linux-arm64": { format: "elf", architecture: "arm64" },
  };
  const target = supportedTargets[`${platform}-${architecture}`];
  if (target === undefined)
    throw new Error(
      `The Ghidra verifier does not support a host-native fixture on ${platform}/${architecture}; use a supported Linux or macOS x64/arm64 host.`,
    );
  return target;
}

async function verifyNativeApiCli(
  targetPath,
  procedures,
  { requireDenseJumpTable, denseSwitchSymbol, client },
) {
  const denseSwitch = procedures.find(({ value }) =>
    value.endsWith(denseSwitchSymbol),
  );
  if (denseSwitch === undefined)
    throw new Error("The Ghidra inventory omitted the dense switch fixture");
  const { stdout } = await exec(
    process.execPath,
    [
      "scripts/rea.mjs",
      "inspect-native-api",
      targetPath,
      denseSwitch.address,
      "--provider",
      "ghidra",
      "--json",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 72 * 1024 * 1024,
    },
  );
  const evidence = JSON.parse(stdout);
  const boundary = evidence.normalized_result?.boundary;
  const denseTable = boundary?.jump_tables?.find(
    ({ mappings }) => mappings.length > 32,
  );
  const denseCases = new Set(
    denseTable?.mappings.flatMap(({ case_value }) =>
      typeof case_value === "number" ? [case_value] : [],
    ) ?? [],
  );
  const expectedCases = Array.from({ length: 40 }, (_, index) => index);
  const mappingsAreExact = expectedCases.every((caseValue) =>
    denseTable?.mappings.some(
      (mapping) =>
        mapping.case_value === caseValue &&
        mapping.confidence === "high" &&
        (hasTypedSwitchEvidence(
          mapping.evidence,
          `Typed case value ${caseValue}`,
          mapping.target_address,
          denseTable.dispatch_address,
        ) ||
          mapping.evidence.some(
            ({ kind, source, detail }) =>
              kind === "jump-table" &&
              typeof detail === "string" &&
              detail.trim().length > 0 &&
              ((source === "ghidra-high-function" &&
                detail.includes(
                  `case value ${caseValue} with target ${mapping.target_address}`,
                )) ||
                (source === "ghidra-instruction-and-memory" &&
                  detail.startsWith(`Case value ${caseValue} indexes byte `) &&
                  detail.includes(`reaching ${mapping.target_address}.`))),
          )),
    ),
  );
  if (
    evidence.operation !== "inspect_native_api" ||
    evidence.provider?.id !== "rea-workflow" ||
    evidence.analysis_profile?.provider?.id !== "rea-workflow" ||
    boundary?.available !== true
  )
    throw new Error(
      `The shipped inspect-native-api CLI did not return an available boundary: ${stdout}`,
    );
  if (
    requireDenseJumpTable &&
    (denseTable === undefined ||
      denseCases.size !== expectedCases.length ||
      denseTable.mappings.length !== expectedCases.length ||
      denseTable.default_targets.length !== 1 ||
      denseTable.default_targets[0].confidence !== "high" ||
      !hasTypedSwitchEvidence(
        denseTable.default_targets[0].evidence,
        "Typed default label",
        denseTable.default_targets[0].target_address,
        denseTable.dispatch_address,
      ) ||
      denseTable.mappings.some(
        ({ target_address }) =>
          target_address === denseTable.default_targets[0].target_address,
      ) ||
      expectedCases.some((caseValue) => !denseCases.has(caseValue)) ||
      !mappingsAreExact ||
      evidence.normalized_result?.residual_unknowns?.length !== 0)
  )
    throw new Error(
      `The shipped inspect-native-api CLI did not preserve complete dense jump-table output: ${stdout}`,
    );
  const defaultOracle = requireDenseJumpTable
    ? await verifyDenseDefaultReturn(
        client,
        denseTable.default_targets[0].target_address,
      )
    : null;
  return {
    operation: evidence.operation,
    provider: evidence.provider,
    mappings_returned: denseTable?.mappings.length ?? null,
    default_oracle: defaultOracle,
    residual_unknowns: evidence.normalized_result.residual_unknowns.length,
  };
}

async function verifyTarget(targetPath, variant, expectedTarget = null) {
  const parsedTarget = await parseBinaryTarget(targetPath);
  if (!parsedTarget.ok) throw parsedTarget.error;
  if (
    expectedTarget !== null &&
    (parsedTarget.value.format !== expectedTarget.format ||
      parsedTarget.value.architecture !== expectedTarget.architecture)
  )
    throw new Error(
      `Fixture header classification drifted for ${variant}: ${JSON.stringify(parsedTarget.value)}`,
    );
  const profile = await resolveGhidraAnalysisProfile(
    parsedTarget.value,
    GHIDRA_PROVIDER_IDENTITY,
    installation,
  );
  if (!profile.ok || profile.value.profile === null)
    throw new Error("Ghidra analysis profile could not be committed");

  const client = new GhidraClient({
    launcher: new GhidraHeadlessLauncher({
      configurationDirectoryName: installation.configurationDirectoryName,
      environment: process.env,
      analyzeHeadlessPath: installation.analyzeHeadlessPath,
      ...(process.env.JAVA_HOME === undefined
        ? {}
        : { javaHome: process.env.JAVA_HOME }),
      bridgeScriptPath: fileURLToPath(
        new URL("../bridge/ghidra/ReaGhidraBridge.java", import.meta.url),
      ),
      platform: installation.platform,
    }),
    targetPath: parsedTarget.value.path,
    targetSha256: parsedTarget.value.sha256,
    providerVersion: SUPPORTED_GHIDRA_VERSION,
    profileDigest: profile.value.profile.digest,
  });

  let runtimeCoordinates;
  let primaryFailure;
  try {
    const started = await client.start();
    if (!started.ok) throw started.error;
    assertSession(
      started.value,
      profile.value.profile.digest,
      parsedTarget.value.sha256,
    );
    const pinged = await client.ping();
    if (!pinged.ok) throw pinged.error;
    assertSession(
      pinged.value,
      profile.value.profile.digest,
      parsedTarget.value.sha256,
    );
    runtimeCoordinates = client.diagnostics();
    assertRuntimeCoordinates(runtimeCoordinates);

    const documents = await call(client, "list_documents", {});
    const segments = await call(client, "list_segments", { document: null });
    const procedures = await allItems(client, "list_procedures", {
      document: null,
    });
    const names = await allItems(client, "list_names", {
      document: null,
      address: null,
    });
    const strings = await allItems(client, "list_strings", {
      document: null,
      address: null,
    });
    const crossArm64Elf =
      variant === "cross-arm64-elf" || variant === "aarch64-jump-table";
    const nativeApiCli =
      variant === "jump-table" || crossArm64Elf
        ? await verifyNativeApiCli(parsedTarget.value.path, procedures, {
            requireDenseJumpTable:
              crossArm64Elf ||
              (expectedNativeTarget.format === "elf" &&
                expectedNativeTarget.architecture === "x86_64"),
            denseSwitchSymbol: crossArm64Elf
              ? "rea_cross_dense_switch"
              : "rea_ghidra_inventory_dense_switch",
            client,
          })
        : null;
    const probes = variant.startsWith("relative-signed-")
      ? await verifyRelativeSignedSwitch(
          client,
          Number(variant.split("-").at(-1)),
        )
      : variant.startsWith("relative-")
        ? await verifyRelativeSwitch(
            client,
            procedures,
            Number(variant.slice(-1)),
          )
        : variant === "type-layout"
          ? await verifyNativeTypeLayout(client, names)
          : variant === "jump-table"
            ? await verifyJumpTableDenseSwitch(client, procedures)
            : variant === "custom" || variant === "aarch64-jump-table"
              ? null
              : await verifyInventoryOperations({
                  client,
                  variant,
                  procedures,
                  names,
                  strings,
                });
    const nativeValues =
      variant === "debug"
        ? await verifyNativeValueTrace(client, procedures, parsedTarget.value)
        : null;
    return {
      variant,
      target: parsedTarget.value,
      profile: profile.value.profile,
      session: pinged.value,
      documents,
      segments,
      procedures,
      names,
      strings,
      probes,
      native_api_cli: nativeApiCli,
      native_values: nativeValues,
    };
  } catch (cause) {
    primaryFailure = cause;
    throw cause;
  } finally {
    const closed = await client.close();
    if (!closed.ok)
      throw primaryFailure === undefined
        ? closed.error
        : new AggregateError(
            [primaryFailure, closed.error],
            "Ghidra verification and cleanup failed",
          );
    if (runtimeCoordinates !== undefined)
      await assertCleanup(runtimeCoordinates);
  }
}
