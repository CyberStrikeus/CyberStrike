#!/usr/bin/env node
import { windowsGhidraFixtureOptions } from "./lib/ghidra-windows-fixture-options.mjs";

import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfig } from "../dist/config/parseConfig.js";
import { resolveGhidraAnalysisProfile } from "../dist/ghidra/GhidraAnalysisProfile.js";
import { GhidraClient } from "../dist/ghidra/GhidraClient.js";
import {
  GHIDRA_FUNCTION_OPERATIONS,
  parseGhidraFunctionInput,
  parseGhidraFunctionResult,
} from "../dist/ghidra/GhidraFunctionValues.js";
import {
  GHIDRA_INVENTORY_OPERATIONS,
  parseGhidraInventoryInput,
  parseGhidraInventoryResult,
} from "../dist/ghidra/GhidraInventoryValues.js";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { SUPPORTED_GHIDRA_VERSION } from "../dist/ghidra/GhidraReleasePolicy.js";
import { GhidraHeadlessLauncher } from "../dist/ghidra/GhidraLauncher.js";
import { GHIDRA_PROVIDER_IDENTITY } from "../dist/ghidra/GhidraProviderCapabilities.js";
import {
  WINDOWS_P0_NATIVE_PE_ARCHITECTURES,
  windowsP0Capabilities,
} from "../dist/ghidra/GhidraProviderCapabilities.js";
import {
  GHIDRA_MUTATING_OPERATIONS,
  GHIDRA_SESSION_CAPABILITIES,
} from "../dist/ghidra/GhidraSessionValues.js";
import { parseBinaryTarget } from "../dist/application/BinaryTargetResolver.js";
import { completeVerifierRun, createVerifierRun } from "./lib/verifier-run.mjs";
import { resolveGhidraVerifierTimeouts } from "./lib/ghidra-verifier-timeouts.mjs";
import { verifyGhidraCompactReferences } from "./lib/real-ghidra-compact-references.mjs";
import { verifyGhidraBorlandSeh } from "./lib/real-ghidra-borland-seh.mjs";
import { verifyGhidraFileOffsets } from "./lib/real-ghidra-file-offsets.mjs";
import { verifyWindowsGhidraByteSearch } from "./lib/ghidra-windows-byte-search.mjs";

const verifierRun = createVerifierRun();
const SESSION_CAPABILITIES = GHIDRA_SESSION_CAPABILITIES.filter(
  (name) => !GHIDRA_MUTATING_OPERATIONS.has(name),
);

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "The real Windows Ghidra verifier requires a Windows x64 host",
  );
if (
  windowsP0Capabilities().some(
    ({ available, effects }) => available && effects.mutatesArtifact,
  )
)
  throw new Error("Windows Ghidra must not advertise database mutation");
const installDir = process.env.GHIDRA_INSTALL_DIR;
const { clientOptions } = resolveGhidraVerifierTimeouts(process.env);
if (installDir === undefined || !isAbsolute(installDir))
  throw new Error(
    "Set GHIDRA_INSTALL_DIR to the absolute root of Ghidra 12.1.4.",
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
  installation.analyzeHeadlessPath === null ||
  installation.providerVersion !== SUPPORTED_GHIDRA_VERSION
)
  throw new Error(
    `Windows Ghidra installation is unavailable: ${JSON.stringify(installation)}`,
  );

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = windowsGhidraFixtureOptions(process.argv.slice(2));
const architecture = fixture.architecture;
const dllFixture = fixture.dll;
const role = dllFixture ? "shared-library" : "application";
const targetPath = resolve(root, "build", "fixtures", fixture.filename);
const target = await parseBinaryTarget(targetPath);
if (
  !target.ok ||
  target.value.format !== "pe" ||
  target.value.architecture !== architecture ||
  target.value.executableRole !== role ||
  target.value.managed !== false
)
  throw new Error(
    `Controlled Windows fixture failed admission: ${JSON.stringify(target)}`,
  );
const configuration = parseConfig(process.env);
if (!configuration.ok) throw configuration.error;
const profile = await resolveGhidraAnalysisProfile(
  target.value,
  GHIDRA_PROVIDER_IDENTITY,
  installation,
  undefined,
  undefined,
  configuration.value.ghidraDisabledAnalyzers,
);
if (!profile.ok || profile.value.profile === null)
  throw new Error("Windows Ghidra profile could not be committed");
if (profile.value.profile.parameters.executable_role !== role)
  throw new Error("Windows Ghidra profile lost the observed PE role");

const client = new GhidraClient({
  platform: installation.platform,
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
    platform: "win32",
    ...(configuration.value.ghidraDisabledAnalyzers === undefined
      ? {}
      : { disabledAnalyzers: configuration.value.ghidraDisabledAnalyzers }),
  }),
  targetPath: target.value.path,
  targetSha256: target.value.sha256,
  transport: "authenticated-loopback-tcp",
  providerVersion: SUPPORTED_GHIDRA_VERSION,
  profileDigest: profile.value.profile.digest,
  ...clientOptions,
});

let coordinates;
let report;
let primaryFailure;
const observed = new Set();
try {
  const started = await client.start();
  if (!started.ok) throw started.error;
  assertSession(
    started.value,
    target.value.sha256,
    profile.value.profile.digest,
  );
  const languageId = fixture.languageId;
  if (started.value.target.language_id !== languageId)
    throw new Error("Windows fixture imported with the wrong Ghidra language");
  coordinates = client.diagnostics();
  assertRuntimeCoordinates(coordinates, target.value.sha256);

  const documents = await inventory("list_documents", {});
  const names = await inventory("list_names", {});
  const procedures = await inventory("list_procedures", {});
  const segments = await inventory("list_segments", {});
  const strings = await inventory("list_strings", {});
  if (
    !Array.isArray(documents) ||
    documents.length !== 1 ||
    !Array.isArray(procedures) ||
    procedures.length === 0 ||
    !Array.isArray(segments) ||
    segments.length === 0 ||
    !Array.isArray(names) ||
    !Array.isArray(strings)
  )
    throw new Error("Windows Ghidra inventory proof was incomplete");
  const overview = await inventory("read_binary_inventory_summary", {});
  if (
    overview.document !== documents[0] ||
    overview.procedure_count !== procedures.length ||
    overview.string_count !== strings.length ||
    overview.segment_count !== segments.length
  )
    throw new Error(
      "Windows Ghidra overview aggregates disagree with inventories",
    );
  const procedure = procedures.find(
    (item) => item.procedure?.external === false,
  );
  if (procedure === undefined)
    throw new Error("Windows Ghidra fixture exposed no local procedure");
  const calleeAddress = BigInt(fixture.calleeAddress);
  const callee = procedures.find(
    (item) => BigInt(item.address) === calleeAddress,
  );
  if (callee === undefined)
    throw new Error("Windows fixture exposed no controlled callee");
  const pseudoCode = await functionOperation("procedure_pseudo_code", {
    procedure: callee.value,
  });
  if (typeof pseudoCode !== "string" || !/\b(?:42|0x2a)\b/iu.test(pseudoCode))
    throw new Error(
      "Windows fixture decompilation lost its known return value",
    );
  if (dllFixture) {
    const callerAddress = fixture.callerAddress;
    const callees = await functionOperation("procedure_callees", {
      procedure: callerAddress,
    });
    if (!callees.includes(callee.address))
      throw new Error("DLL export caller lost its controlled call reference");
    const callerCode = await functionOperation("procedure_pseudo_code", {
      procedure: callerAddress,
    });
    if (typeof callerCode !== "string" || !/\+\s*1\b/u.test(callerCode))
      throw new Error("DLL export caller lost its addition of one");
  }

  await inventory("inspect_native_load_image", {});
  const memory = await inventory("read_bytes", {
    address: procedure.address,
    length: 16,
  });
  const mapping = await inventory("address_to_file_offset", {
    address: procedure.address,
  });
  const sourceBytes = await readFile(targetPath);
  if (
    memory.complete !== true ||
    memory.returned_bytes !== 16 ||
    memory.bytes_hex !==
      sourceBytes
        .subarray(mapping.file_offset, mapping.file_offset + 16)
        .toString("hex")
  )
    throw new Error(
      "Windows loaded bytes disagree with the observed source-file mapping",
    );

  await inventory("address_name", { address: procedure.address });
  const resolvedAddress = await inventory("procedure_address", {
    procedure: procedure.value,
  });
  if (resolvedAddress !== procedure.address)
    throw new Error("Windows procedure name/address resolution drifted");
  await inventory("resolve_containing_procedure", {
    address: procedure.address,
  });
  await inventory("search_procedures", { pattern: procedure.value });
  await inventory("search_strings", { pattern: "rea" });
  const byteSearch = await verifyWindowsGhidraByteSearch({
    invoke: inventory,
    sourceBytes,
    imageBase: fixture.imageBase,
  });

  for (const operation of [
    "procedure_assembly",
    "procedure_callees",
    "procedure_callers",
    "procedure_info",
    "procedure_pseudo_code",
    "read_function_instructions",
    "procedure_references",
  ])
    await functionOperation(operation, { procedure: procedure.value });
  await functionOperation("xrefs", { address: procedure.address });
  await functionOperation("inspect_native_data_type", { type: "/undefined8" });
  await functionOperation("inspect_native_instruction", {
    address: procedure.address,
  });
  await functionOperation("resolve_native_call_targets", {
    address: procedure.address,
  });
  await functionOperation("analyze_function", {
    procedure: procedure.value,
  });

  const expected = [
    ...GHIDRA_INVENTORY_OPERATIONS,
    ...GHIDRA_FUNCTION_OPERATIONS,
  ].filter((name) => !GHIDRA_MUTATING_OPERATIONS.has(name));
  const expectedOperations = new Set(expected);
  const missingOperations = expected.filter((name) => !observed.has(name));
  const unexpectedOperations = [...observed].filter(
    (name) => !expectedOperations.has(name),
  );
  if (
    missingOperations.length > 0 ||
    unexpectedOperations.length > 0 ||
    observed.size !== expectedOperations.size
  )
    throw new Error(
      `Windows Ghidra operation proof was incomplete: ${JSON.stringify({ missing: missingOperations, unexpected: unexpectedOperations })}`,
    );

  // The reference controls occupy the EXE fixture's additional function.
  // DLL fixtures retain their independent exported-caller/return controls.
  // ARM/ARM64 fixtures verify function entry, decompiler readback and the
  // exported caller/callee relationship; the x86/x64 compact-reference
  // value-flow battery has no ARM/ARM64 instruction encoding in this fixture.
  const compactReferences =
    dllFixture || architecture === "arm" || architecture === "arm64"
      ? null
      : await verifyGhidraCompactReferences(
          functionOperation,
          architecture === "x86",
        );
  const borlandSeh =
    architecture === "x86" && !dllFixture
      ? await verifyGhidraBorlandSeh(functionObservationOperation, true)
      : null;
  report = {
    ok: true,
    provider: { id: "ghidra", version: SUPPORTED_GHIDRA_VERSION },
    language_id: started.value.target.language_id,
    target: {
      format: target.value.format,
      architecture: target.value.architecture,
      executable_role: target.value.executableRole,
      managed: target.value.managed,
      sha256: target.value.sha256,
    },
    transport: "authenticated-loopback-tcp",
    operations: [...observed].sort((left, right) => left.localeCompare(right)),
    byte_search: byteSearch,
    cleanup: "complete",
    compact_references: compactReferences,
    borland_seh: borlandSeh,
    native_controls: {
      job_object: true,
      protected_dacl: true,
      handle_admission: true,
    },
    supported_target_architectures: [...WINDOWS_P0_NATIVE_PE_ARCHITECTURES],
    limitations: [
      "approved-non-sensitive-fixtures-only",
      "windows-x64-local-ntfs-only",
      "native-pe-applications-and-dlls-only",
      "no-gui-or-mutation-authority",
    ],
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
  if (coordinates !== undefined) await assertCleanup(coordinates);
}
if (report === undefined)
  throw new Error("Windows Ghidra report was not produced");
try {
  report.file_offsets = await verifyGhidraFileOffsets(
    targetPath,
    resolve(root, "scripts", "rea.mjs"),
    fixture.calleeAddress,
  );
} catch (cause) {
  // Preserve completed real-provider facts if a separate adapter proof fails.
  process.stdout.write(
    `${JSON.stringify({
      ...report,
      ok: false,
      primary_verification: "complete",
      file_offsets: { status: "incomplete", failure_code: cause.code ?? null },
    })}\n`,
  );
  throw cause;
}
process.stdout.write(
  `${JSON.stringify({ verifier_run: await completeVerifierRun(verifierRun), ...report })}\n`,
);

async function inventory(operation, parameters) {
  const input = parseGhidraInventoryInput(operation, parameters);
  if (!input.ok) throw input.error;
  const called = await client.callTool(operation, input.value);
  if (!called.ok) throw called.error;
  const result = parseGhidraInventoryResult(operation, called.value);
  if (!result.ok) throw result.error;
  observed.add(operation);
  return result.value.value;
}

async function functionOperation(operation, parameters) {
  const observation = await functionObservationOperation(operation, parameters);
  return observation.value;
}

async function functionObservationOperation(operation, parameters) {
  const input = parseGhidraFunctionInput(operation, parameters);
  if (!input.ok) throw input.error;
  const called = await client.callTool(operation, input.value);
  if (!called.ok) throw called.error;
  const result = parseGhidraFunctionResult(operation, called.value);
  if (!result.ok) throw result.error;
  observed.add(operation);
  return result.value;
}

function assertSession(session, targetSha256, profileDigest) {
  if (
    session.provider.id !== "ghidra" ||
    session.provider.version !== SUPPORTED_GHIDRA_VERSION ||
    session.profile_digest !== profileDigest ||
    session.target.sha256 !== targetSha256 ||
    session.read_only !== true ||
    session.analysis_complete !== true ||
    session.analysis_timed_out !== false ||
    session.capabilities.length !== SESSION_CAPABILITIES.length ||
    new Set(session.capabilities).size !== SESSION_CAPABILITIES.length ||
    SESSION_CAPABILITIES.some((name) => !session.capabilities.includes(name))
  )
    throw new Error(
      `Windows Ghidra session commitment drifted: ${JSON.stringify(session)}`,
    );
}

function assertRuntimeCoordinates(runtime, targetSha256) {
  if (
    runtime.transport !== "authenticated-loopback-tcp" ||
    runtime.target_sha256 !== targetSha256 ||
    typeof runtime.runtime_root !== "string" ||
    typeof runtime.endpoint_path !== "string" ||
    typeof runtime.project_root !== "string" ||
    typeof runtime.process_id !== "number" ||
    typeof runtime.target_admission !== "object" ||
    runtime.target_admission === null
  )
    throw new Error(
      `Windows Ghidra runtime coordinates are incomplete: ${JSON.stringify(runtime)}`,
    );
}

async function assertCleanup(runtime) {
  for (const name of ["runtime_root", "endpoint_path", "project_root"]) {
    const path = runtime[name];
    if (typeof path === "string" && (await exists(path)))
      throw new Error(`Windows Ghidra cleanup left ${name}: ${path}`);
  }
  if (
    typeof runtime.process_id === "number" &&
    processExists(runtime.process_id)
  )
    throw new Error(
      `Windows Ghidra cleanup left process ${String(runtime.process_id)}`,
    );
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !(
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "ESRCH"
    );
  }
}
