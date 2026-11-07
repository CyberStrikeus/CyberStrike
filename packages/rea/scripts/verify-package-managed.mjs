import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createEvidence } from "../dist/domain/evidence.js";
import { buildManagedPeFixture } from "./fixtures/managed/pe.mjs";
import { functionDossier } from "./fixtures/managed/function-dossier.mjs";

const buildManagedFixtures = async (workspace) => {
  const managedPath = join(workspace, "managed-fixture.exe");
  const managedRightPath = join(workspace, "managed-fixture-right.exe");
  await Promise.all([
    writeFile(
      managedPath,
      buildManagedPeFixture({
        methods: [
          { name: "Main", flags: 0x0016 },
          { name: "NativeMessageBox", flags: 0x2016, rva: 0 },
        ],
        pinvoke: {
          moduleName: "user32.dll",
          importName: "MessageBoxW",
          mappingFlags: 0x0345,
          memberRow: 2,
        },
      }),
    ),
    writeFile(
      managedRightPath,
      buildManagedPeFixture({
        mvid: Buffer.from([
          0xde, 0xad, 0xbe, 0xef, 0x44, 0x33, 0x66, 0x55, 0xaa, 0xbb, 0xcc,
          0xdd, 0xee, 0xff, 0x11, 0x22,
        ]),
      }),
    ),
  ]);
  return { managedPath, managedRightPath };
};

const verifyManagedArtifact = async ({
  commands,
  cli,
  managedPath,
  environment,
}) => {
  const managedArtifact = JSON.parse(
    await commands.run(
      cli,
      ["inspect-managed-artifact", managedPath, "--json"],
      environment,
    ),
  );
  if (
    managedArtifact.operation !== "inspect_managed_artifact" ||
    managedArtifact.provider?.id !== "rea-dotnet-static" ||
    managedArtifact.normalized_result?.classification?.status !== "managed"
  )
    throw new Error("packaged managed artifact CLI failed");
  return managedArtifact;
};

const verifyManagedMembers = async ({
  commands,
  cli,
  managedPath,
  environment,
}) => {
  const managedMembers = JSON.parse(
    await commands.run(
      cli,
      ["inspect-managed-members", managedPath, "--json"],
      environment,
    ),
  );
  if (
    managedMembers.operation !== "inspect_managed_members" ||
    managedMembers.normalized_result?.methods?.length !== 2
  )
    throw new Error("packaged managed member CLI failed");
  return managedMembers;
};

const verifyManagedReconstruction = async ({
  commands,
  cli,
  managedMembers,
  managedMethod,
  environment,
}) => {
  const managedReconstructionInput = {
    static_members: managedMembers,
    decompiler: {
      name: "ilspycmd",
      version: "9.1.0.7988",
      family: "ilspy",
      executable_sha256: null,
      options: ["--type", "Fixture.Program"],
    },
    methods: [
      {
        token: managedMethod.token,
        signature_sha256: managedMethod.signature.raw_sha256,
        normalized_il_sha256: managedMethod.body.normalized_il_sha256,
        reconstruction: {
          kind: "decompiled-csharp",
          language: "csharp",
          text: "internal static void Main() { }",
        },
      },
    ],
    notes: ["packaged synthetic reconstruction import"],
  };
  const managedReconstruction = JSON.parse(
    await commands.run(
      cli,
      [
        "import-managed-reconstruction",
        JSON.stringify(managedReconstructionInput),
        "--json",
      ],
      environment,
    ),
  );
  if (
    managedReconstruction.operation !== "import_managed_reconstruction" ||
    managedReconstruction.provider?.id !== "rea-dotnet-workflows" ||
    managedReconstruction.normalized_result?.executed !== false ||
    managedReconstruction.normalized_result?.methods?.[0]?.validation
      ?.canonical_observation !== false
  )
    throw new Error("packaged managed reconstruction import CLI failed");
};

const verifyManagedBoundaries = async ({
  commands,
  cli,
  managedPath,
  environment,
}) => {
  const managedBoundaries = JSON.parse(
    await commands.run(
      cli,
      ["inspect-managed-native-boundaries", managedPath, "--json"],
      environment,
    ),
  );
  if (
    managedBoundaries.operation !== "inspect_managed_native_boundaries" ||
    managedBoundaries.normalized_result?.pinvoke_imports?.length !== 1 ||
    managedBoundaries.normalized_result?.pinvoke_imports?.[0]?.verification !==
      "managed-declaration-only"
  )
    throw new Error("packaged managed native-boundary CLI failed");
  return managedBoundaries;
};

const verifyManagedApplicationGraph = async ({
  commands,
  cli,
  managedArtifact,
  managedMembers,
  managedBoundaries,
  environment,
}) => {
  const managedApplicationGraphInput = {
    managed_artifact: managedEvidence(
      managedArtifact,
      "inspect_managed_artifact",
    ),
    managed_members: managedEvidence(managedMembers, "inspect_managed_members"),
    managed_native_boundaries: managedEvidence(
      managedBoundaries,
      "inspect_managed_native_boundaries",
    ),
  };
  const managedApplicationGraph = JSON.parse(
    await commands.run(
      cli,
      [
        "project-managed-application-graph",
        JSON.stringify(managedApplicationGraphInput),
        "--json",
      ],
      environment,
    ),
  );
  if (
    managedApplicationGraph.operation !== "project_managed_application_graph" ||
    managedApplicationGraph.provider?.id !== "rea-dotnet-workflows" ||
    managedApplicationGraph.confidence !== "inferred" ||
    managedApplicationGraph.normalized_result?.summary?.pinvoke_imports !== 1 ||
    managedApplicationGraph.normalized_result?.graph?.schema !==
      "JavaScriptApplicationGraph" ||
    !managedApplicationGraph.normalized_result?.graph?.nodes?.some(
      ({ kind }) => kind === "managed-pinvoke-import",
    )
  )
    throw new Error(
      `packaged managed application-graph CLI failed: ${JSON.stringify(managedApplicationGraph).slice(0, 3000)}`,
    );
};

const managedEvidence = (output, operation) => {
  const result = output.normalized_result;
  return createEvidence(
    {
      path: result.artifact.path,
      sha256: result.artifact.sha256,
      format: "pe",
    },
    {
      id: "rea-dotnet-static",
      name: "REA managed static analysis provider",
      version: "1",
    },
    {
      operation,
      parameters: {},
      result,
      rawResult: null,
      limitations: result.limitations ?? [],
      locations: [],
    },
  );
};

const verifyManagedNativeVerification = async ({
  commands,
  cli,
  managedBoundaries,
  environment,
}) => {
  const managedNativeVerificationInput = {
    managed_boundaries: managedEvidence(
      managedBoundaries,
      "inspect_managed_native_boundaries",
    ),
    native_observations: [
      createEvidence(
        {
          path: "/system/user32.dll",
          sha256: "9".repeat(64),
          format: "pe",
          architecture: "x86",
        },
        {
          id: "ghidra",
          name: "Ghidra",
          version: "12.1.4",
        },
        {
          operation: "analyze_function",
          parameters: { procedure: "MessageBoxW" },
          result: functionDossier("MessageBoxW"),
          rawResult: null,
          limitations: [],
          locations: [{ kind: "address", address: "0x401000" }],
        },
      ),
    ],
  };
  const managedNativeVerification = JSON.parse(
    await commands.run(
      cli,
      [
        "verify-managed-native-boundaries",
        JSON.stringify(managedNativeVerificationInput),
        "--json",
      ],
      environment,
    ),
  );
  if (
    managedNativeVerification.operation !==
      "verify_managed_native_boundaries" ||
    managedNativeVerification.provider?.id !== "rea-dotnet-workflows" ||
    managedNativeVerification.normalized_result?.summary?.verified !== 1 ||
    managedNativeVerification.normalized_result?.algorithm
      ?.token_to_address_mapping !== "not-inferred"
  )
    throw new Error("packaged managed/native verification CLI failed");
};

const verifyManagedComparison = async ({
  commands,
  cli,
  managedPath,
  managedRightPath,
  environment,
}) => {
  const managedComparison = JSON.parse(
    await commands.run(
      cli,
      ["compare-managed-members", managedPath, managedRightPath, "--json"],
      environment,
    ),
  );
  if (
    managedComparison.operation !== "compare_managed_members" ||
    managedComparison.provider?.id !== "rea-dotnet-workflows" ||
    managedComparison.normalized_result?.algorithm?.name_matching !==
      "exact-signature-fallback"
  )
    throw new Error("packaged managed comparison CLI failed");
};

/** Exercise all packaged managed static and workflow CLIs. */
export async function verifyManaged({ commands, cli, workspace, environment }) {
  const { managedPath, managedRightPath } =
    await buildManagedFixtures(workspace);
  const managedArtifact = await verifyManagedArtifact({
    commands,
    cli,
    managedPath,
    environment,
  });
  const managedMembers = await verifyManagedMembers({
    commands,
    cli,
    managedPath,
    environment,
  });
  const managedMethod = managedMembers.normalized_result.methods[0];
  await verifyManagedReconstruction({
    commands,
    cli,
    managedMembers,
    managedMethod,
    environment,
  });
  const managedBoundaries = await verifyManagedBoundaries({
    commands,
    cli,
    managedPath,
    environment,
  });
  await verifyManagedApplicationGraph({
    commands,
    cli,
    managedArtifact,
    managedMembers,
    managedBoundaries,
    environment,
  });
  await verifyManagedNativeVerification({
    commands,
    cli,
    managedBoundaries,
    environment,
  });
  await verifyManagedComparison({
    commands,
    cli,
    managedPath,
    managedRightPath,
    environment,
  });
}
