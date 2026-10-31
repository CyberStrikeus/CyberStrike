import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { inspectManagedArtifactBytes } from "../../../dist/dotnet/ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "../../../dist/dotnet/ManagedMemberInspector.js";
import { importManagedReconstructionEvidence } from "../../../dist/application/managed/ManagedReconstructionService.js";
import { createEvidence } from "../../../dist/domain/evidence.js";
import { MANAGED_STATIC_PROVIDER } from "../../../dist/domain/investigationProviders.js";
import { createManagedManifestVerifier } from "./manifest.mjs";

const execFileAsync = promisify(execFile);

export const createManagedConformanceOracleSupport = (context) => {
  const verifier = createManagedManifestVerifier(context);
  const support = { ...context, ...verifier };
  return {
    runManagedAppManifestSelfTest: () => runManagedAppManifestSelfTest(support),
    runOptionalManagedAppManifest: () => runOptionalManagedAppManifest(support),
    runOptionalIlspyOracle: () => runOptionalIlspyOracle(support),
  };
};

async function runManagedAppManifestSelfTest(context) {
  const sample = await context.fixture("manifest-self-test.exe", {
    methodName: "PinnedSemanticSlice",
    ilBody: context.defaultIlBody,
  });
  const artifact = inspectManagedArtifactBytes(
    sample.bytes,
    sample.target,
    context.inspectionLimits,
  );
  const members = inspectManagedMembersBytes(
    sample.bytes,
    sample.target,
    context.memberLimits,
  );
  const method = members.methods[0];
  assert.ok(method);
  const summary = await context.verifyManagedAppManifest(
    {
      label: "source-owned manifest verifier self-test",
      target: {
        path: sample.path,
        sha256: sample.target.sha256,
        mvid: artifact.module?.mvid,
        assembly_name: artifact.assembly?.name,
        runtime_family: artifact.classification.runtime_family,
        managed_architecture: artifact.classification.managed_architecture,
      },
      methods: [
        {
          label: "pinned-semantic-slice",
          token: method.token,
          signature_sha256: method.signature.raw_sha256,
          il_size: method.body.il_size,
          il_sha256: method.body.il_sha256,
          normalized_il_sha256: method.body.normalized_il_sha256,
        },
      ],
      application_graph: {
        expected_node_kinds: [
          "artifact",
          "managed-assembly",
          "managed-module",
          "managed-type",
          "managed-method",
        ],
        feature_traces: [
          {
            label: "trace pinned method by name",
            method_token: method.token,
            seed: "PinnedSemanticSlice",
            match: "exact",
            min_matched_seeds: 1,
          },
        ],
      },
    },
    join(context.workspace, "source-owned-managed-app-manifest.json"),
  );
  return {
    verified: true,
    assertions: summary.assertions,
    methods: summary.methods.length,
    applicationGraph: summary.application_graph ?? null,
    target: summary.target,
  };
}

async function runOptionalManagedAppManifest(context) {
  const manifestPath = process.env.REA_MANAGED_APP_MANIFEST_PATH;
  if (manifestPath === undefined) return null;
  if (manifestPath.trim().length === 0)
    throw new Error("REA_MANAGED_APP_MANIFEST_PATH is set but empty");
  const resolvedManifestPath = resolve(process.cwd(), manifestPath);
  const text = await readFile(resolvedManifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `managed app manifest ${resolvedManifestPath} is not valid JSON: ${message}`,
    );
  }
  return {
    configured: true,
    ...(await context.verifyManagedAppManifest(manifest, resolvedManifestPath)),
  };
}

async function runOptionalIlspyOracle(context) {
  const ilspyPath = process.env.REA_ILSPY_CMD_PATH;
  if (ilspyPath === undefined) return null;
  ensureIlspy(
    ilspyPath.trim().length > 0,
    "REA_ILSPY_CMD_PATH is set but empty",
  );
  ensureIlspy(
    isAbsolute(ilspyPath),
    "REA_ILSPY_CMD_PATH must be an absolute path",
  );
  await ensureExecutable(ilspyPath);
  const versionOutput = await runIlspy(ilspyPath, ["--version"], 64 * 1024);
  const version = ilspyVersion(versionOutput);
  const executableSha256 = context.sha256(await readFile(ilspyPath));
  const sample = await context.fixture("ilspy-oracle.exe", {
    methodName: "PinnedSemanticSlice",
  });
  const artifact = inspectManagedArtifactBytes(
    sample.bytes,
    sample.target,
    context.inspectionLimits,
  );
  const members = inspectManagedMembersBytes(
    sample.bytes,
    sample.target,
    context.memberLimits,
  );
  const method = members.methods[0];
  ensureIlspy(method !== undefined, "source-owned fixture has no method");
  const listOutput = await runIlspy(
    ilspyPath,
    ["--disable-updatecheck", "-l", "c", sample.path],
    256 * 1024,
  );
  ensureIlspy(
    listOutput.includes("Class Fixture.Program"),
    "ilspycmd class listing did not include Fixture.Program",
  );
  const csharp = await runIlspy(
    ilspyPath,
    ["--disable-updatecheck", "--type", "Fixture.Program", sample.path],
    256 * 1024,
  );
  ensureIlspy(
    csharp.includes("PinnedSemanticSlice"),
    "ilspycmd C# output did not include the pinned method name",
  );
  ensureIlspy(
    csharp.length <= 65_536,
    "ilspycmd C# output exceeded the managed reconstruction import bound",
  );
  const reconstructionImport = importIlspyReconstruction({
    context,
    sample,
    method,
    members,
    version,
    executableSha256,
    csharp,
  });
  const imported = reconstructionImport.value.normalized_result;
  return {
    env: "REA_ILSPY_CMD_PATH",
    configured: true,
    version,
    executable_sha256: executableSha256,
    fixture: {
      file_name: basename(sample.path),
      sha256: sample.target.sha256,
      mvid: artifact.module?.mvid ?? null,
      assembly_name: artifact.assembly?.name ?? null,
      method: {
        token: method.token,
        declaring_type: method.declaring_type,
        name: method.name,
        signature_sha256: method.signature.raw_sha256,
        il_size: method.body.il_size,
        normalized_il_sha256: method.body.normalized_il_sha256,
      },
    },
    output: {
      class_listing_sha256: context.sha256(Buffer.from(listOutput)),
      decompiled_csharp_sha256: context.sha256(Buffer.from(csharp)),
      decompiled_csharp_bytes: Buffer.byteLength(csharp),
      imported_evidence_id: reconstructionImport.value.evidence_id,
      reconstruction_id: imported.reconstruction_id,
      canonical_observation:
        imported.methods[0]?.validation.canonical_observation ?? null,
      confidence_floor:
        imported.methods[0]?.validation.confidence_floor ?? null,
    },
  };
}

function importIlspyReconstruction({
  context,
  sample,
  method,
  members,
  version,
  executableSha256,
  csharp,
}) {
  const memberEvidence = createEvidence(
    sample.target,
    MANAGED_STATIC_PROVIDER,
    {
      operation: "inspect_managed_members",
      parameters: context.memberLimits,
      result: members,
      rawResult: null,
      limitations: members.limitations,
      locations: [{ kind: "artifact-path", path: sample.target.path }],
    },
  );
  const reconstructionImport = importManagedReconstructionEvidence({
    static_members: memberEvidence,
    decompiler: {
      name: "ilspycmd",
      version,
      family: "ilspy",
      executable_sha256: executableSha256,
      options: ["--disable-updatecheck", "--type", "Fixture.Program"],
    },
    methods: [
      {
        token: method.token,
        signature_sha256: method.signature.raw_sha256,
        normalized_il_sha256: method.body.normalized_il_sha256,
        reconstruction: {
          kind: "decompiled-csharp",
          language: "csharp",
          text: csharp,
        },
      },
    ],
    notes: [
      "source-owned real ilspycmd oracle; output is imported as reconstruction inference",
    ],
  });
  ensureIlspy(reconstructionImport.ok, "managed reconstruction import failed");
  const imported = reconstructionImport.value.normalized_result;
  ensureIlspy(
    imported.summary.decompiled_csharp_methods === 1,
    "managed reconstruction import did not record one decompiled C# method",
  );
  return reconstructionImport;
}

async function ensureExecutable(path) {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`managed ILSpy oracle failed: ${path} is not executable`);
  }
}

async function runIlspy(path, args, maxBuffer) {
  try {
    const { stdout } = await execFileAsync(path, args, {
      timeout: 30_000,
      maxBuffer,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`managed ILSpy oracle failed: ${message}`);
  }
}

function ilspyVersion(output) {
  const version = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("ilspycmd:"));
  ensureIlspy(
    version !== undefined,
    "ilspycmd --version did not identify ilspycmd",
  );
  return version;
}

function ensureIlspy(condition, message) {
  if (!condition) throw new Error(`managed ILSpy oracle failed: ${message}`);
}
