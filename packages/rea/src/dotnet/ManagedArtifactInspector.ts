import {
  admitManagedProjection,
  managedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  managedArtifactInspectionSchema,
  type ManagedArtifactInspection,
  type ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";
import {
  managedCli32BitRequirement,
  managedCliIsMixedClrNative,
  readManagedPeLayout,
  type ManagedCliHeader,
  type ManagedPeLayout,
} from "./ManagedPeReader.js";
import {
  managedTableRowCounts,
  readManagedMetadataInventory,
  type ManagedMetadataInventory,
  readManagedResourceDirectory,
} from "./ManagedMetadataInventory.js";
import {
  readManagedMetadataLayout,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import { readTypeMemberListFacts } from "./ManagedTypeMemberLists.js";
import {
  ManagedReaderFailure,
  managedMetadataFailureStatus,
  type ManagedMetadataHeaderFacts,
} from "./ManagedReaderFailure.js";

const flagNames = (flags: number): string[] => {
  const names: string[] = [];
  for (const [mask, name] of [
    [0x0000_0001, "il-only"],
    [0x0000_0002, "32-bit-required"],
    [0x0000_0004, "il-library"],
    [0x0000_0008, "strong-name-signed"],
    [0x0000_0010, "native-entry-point"],
    [0x0001_0000, "track-debug-data"],
    [0x0002_0000, "32-bit-preferred"],
  ] as const)
    if ((flags & mask) !== 0) names.push(name);
  return names;
};

const cliProjection = (
  cli: ManagedCliHeader,
): NonNullable<ManagedArtifactInspection["pe"]["cli"]> => ({
  header_offset: cli.headerOffset,
  header_size: cli.headerSize,
  runtime_version: `${String(cli.runtimeMajor)}.${String(cli.runtimeMinor)}`,
  flags: cli.flags,
  flag_names: flagNames(cli.flags),
  entry_point:
    cli.entryPoint === 0
      ? { kind: "none", value: null }
      : (cli.flags & 0x10) !== 0
        ? {
            kind: "native-rva",
            value: `0x${cli.entryPoint.toString(16)}`,
          }
        : {
            kind: "metadata-token",
            value: `0x${cli.entryPoint.toString(16).padStart(8, "0")}`,
          },
  metadata_rva: cli.metadata.rva,
  metadata_size: cli.metadata.size,
  resources_rva: cli.resources.rva,
  resources_size: cli.resources.size,
  strong_name_rva: cli.strongName.rva,
  strong_name_size: cli.strongName.size,
  managed_native_header_rva: cli.managedNativeHeader.rva,
  managed_native_header_size: cli.managedNativeHeader.size,
  ready_to_run_signature: cli.readyToRunSignature,
});

const peProjection = (
  layout: ManagedPeLayout,
): ManagedArtifactInspection["pe"] => ({
  machine: layout.machine,
  machine_hex: `0x${layout.machine.toString(16).padStart(4, "0")}`,
  architecture: layout.architecture,
  optional_header: layout.optionalHeader,
  section_count: layout.sectionCount,
  characteristics: layout.characteristics,
  cli: layout.cli === null ? null : cliProjection(layout.cli),
});

const base = (
  target: BinaryTarget,
  bytes: Buffer,
  layout: ManagedPeLayout,
) => ({
  artifact: {
    path: target.path,
    sha256: target.sha256,
    byte_length: bytes.length,
    format: "pe" as const,
  },
  pe: peProjection(layout),
});

const unavailableResult = (
  target: BinaryTarget,
  bytes: Buffer,
  layout: ManagedPeLayout,
): ManagedArtifactInspection => {
  const malformed = layout.cliDirectoryState !== "absent";
  const issues = layout.cliIssue === null ? [] : [layout.cliIssue];
  const limitations = malformed
    ? [
        "The PE declares a CLI directory, but its CLI header could not be admitted.",
      ]
    : [
        "The PE has no CLI data directory; managed metadata and CIL are unavailable.",
      ];
  return managedArtifactInspectionSchema.parse(
    admitManagedProjection({
      ...base(target, bytes, layout),
      classification: {
        status: malformed ? "malformed" : "not-managed",
        container: "pe",
        runtime_family: "unknown",
        implementation: malformed ? "unknown" : "not-managed",
        managed_architecture: "unknown",
        evidence: [
          {
            code: malformed
              ? "cli-directory-malformed"
              : "cli-directory-absent",
            detail: limitations[0],
            file_offset: layout.cliIssue?.offset ?? null,
          },
        ],
      },
      metadata: {
        status: malformed ? "malformed" : "absent",
        version: null,
        stream_names: [],
        table_row_counts: {},
      },
      module: null,
      assembly: null,
      target_frameworks: [],
      references: [],
      resources: [],
      attributes: [],
      coverage: {
        state: malformed ? "partial" : "unavailable",
        issues,
      },
      limitations,
    }),
  );
};

interface RuntimeClassificationInput {
  readonly layout: ManagedPeLayout;
  readonly metadata: ManagedMetadataLayout;
  readonly inventory: ManagedMetadataInventory;
}

const runtimeFamilyFromCliHeader = (
  cli: ManagedCliHeader | null,
): ManagedArtifactInspection["classification"]["runtime_family"] =>
  cli?.readyToRunSignature === true
    ? "modern-dotnet"
    : cli !== null && managedCliIsMixedClrNative(cli)
      ? "mixed-clr-native"
      : "unknown";

const runtimeFamilyFor = (
  cli: ManagedCliHeader,
  inventory: ManagedMetadataInventory,
  metadata: ManagedMetadataLayout,
  layout: ManagedPeLayout,
): Pick<
  ManagedArtifactInspection["classification"],
  "runtime_family" | "evidence"
> => {
  const evidence: ManagedArtifactInspection["classification"]["evidence"] = [
    {
      code: "cli-header-observed",
      detail: "A file-backed PE CLI header and metadata root were admitted.",
      file_offset: cli.headerOffset,
    },
  ];
  const frameworks = inventory.targetFrameworks;
  const hasUnity = inventory.referenceNames.some(
    (name) => name === "UnityEngine" || name.startsWith("UnityEngine."),
  );
  const hasFrameworkTarget = frameworks.some((value) =>
    value.startsWith(".NETFramework,"),
  );
  const hasModernTarget = frameworks.some((value) =>
    value.startsWith(".NETCoreApp,"),
  );
  const hasStandardTarget = frameworks.some((value) =>
    value.startsWith(".NETStandard,"),
  );
  if (cli.readyToRunSignature)
    evidence.push({
      code: "ready-to-run-signature-observed",
      detail: "The managed native header has the ReadyToRun signature.",
      file_offset: layout.rvaToOffset(
        cli.managedNativeHeader.rva,
        4,
        "cli.managed-native-header",
      ),
    });
  if (hasUnity)
    evidence.push({
      code: "unity-reference-observed",
      detail:
        "The admitted AssemblyRef table contains a UnityEngine reference.",
      file_offset: metadata.table(35)?.offset ?? null,
    });
  if (hasFrameworkTarget)
    evidence.push({
      code: "target-framework-observed",
      detail:
        "An assembly-level TargetFrameworkAttribute names .NET Framework.",
      file_offset: metadata.table(12)?.offset ?? null,
    });
  if (hasModernTarget)
    evidence.push({
      code: "target-framework-observed",
      detail: "An assembly-level TargetFrameworkAttribute names modern .NET.",
      file_offset: metadata.table(12)?.offset ?? null,
    });
  if (hasStandardTarget)
    evidence.push({
      code: "target-framework-observed",
      detail:
        "An assembly-level TargetFrameworkAttribute names .NET Standard, an API specification that does not identify a runtime family.",
      file_offset: metadata.table(12)?.offset ?? null,
    });
  let runtimeFamily: ManagedArtifactInspection["classification"]["runtime_family"] =
    "unknown";
  if (cli.readyToRunSignature) {
    runtimeFamily = "modern-dotnet";
  } else if (runtimeFamilyFromCliHeader(cli) === "mixed-clr-native") {
    runtimeFamily = "mixed-clr-native";
    evidence.push({
      code: "cli-il-only-clear",
      detail:
        "COMIMAGE_FLAGS_ILONLY is clear, so managed and native analysis must remain composed.",
      file_offset: cli.headerOffset + 16,
    });
  } else if (hasUnity) {
    runtimeFamily = "unity-mono";
  } else if (hasFrameworkTarget) {
    runtimeFamily = "dotnet-framework";
  } else if (hasModernTarget) {
    runtimeFamily = "modern-dotnet";
  }
  return { runtime_family: runtimeFamily, evidence };
};

const implementationFor = (
  cli: ManagedCliHeader,
  metadata: ManagedMetadataLayout,
): ManagedArtifactInspection["classification"]["implementation"] => {
  if (cli.readyToRunSignature) return "cil-and-ready-to-run";
  if ((cli.flags & 1) === 0) return "cpp-cli-mixed";
  return (metadata.rowCounts[6] ?? 0) === 0 ? "metadata-only" : "cil";
};

const managedArchitectureFor = (
  layout: ManagedPeLayout,
  cli: ManagedCliHeader,
): ManagedArtifactInspection["classification"]["managed_architecture"] => {
  if (layout.architecture !== "x86" || (cli.flags & 1) === 0)
    return layout.architecture;
  const requirement = managedCli32BitRequirement(cli.flags);
  if (requirement === "required") return "x86";
  return requirement === "preferred" ? "anycpu-prefer-32" : "anycpu";
};

const runtimeClassification = ({
  layout,
  metadata,
  inventory,
}: RuntimeClassificationInput): Pick<
  ManagedArtifactInspection["classification"],
  "runtime_family" | "implementation" | "managed_architecture" | "evidence"
> => {
  const cli = layout.cli;
  if (cli === null) throw new TypeError("Managed classification requires CLI");
  const { runtime_family: runtimeFamily, evidence } = runtimeFamilyFor(
    cli,
    inventory,
    metadata,
    layout,
  );
  const implementation = implementationFor(cli, metadata);
  const managedArchitecture = managedArchitectureFor(layout, cli);
  evidence.push({
    code: "managed-architecture-derived",
    detail: `Managed architecture ${managedArchitecture} is derived from PE machine and CLI flags.`,
    file_offset: cli.headerOffset + 16,
  });
  return {
    runtime_family: runtimeFamily,
    implementation,
    managed_architecture: managedArchitecture,
    evidence,
  };
};

interface PartialMetadataContext {
  readonly target: BinaryTarget;
  readonly bytes: Buffer;
  readonly layout: ManagedPeLayout;
  readonly issue: ManagedParseIssue;
  readonly metadataHeader?: ManagedMetadataHeaderFacts | null;
}

const partialMetadataResult = ({
  target,
  bytes,
  layout,
  issue,
  metadataHeader,
}: PartialMetadataContext): ManagedArtifactInspection => ({
  ...base(target, bytes, layout),
  classification: {
    status:
      managedMetadataFailureStatus(issue) === "partial"
        ? "managed"
        : "malformed",
    container: "pe",
    runtime_family: runtimeFamilyFromCliHeader(layout.cli),
    implementation: "unknown",
    managed_architecture: "unknown",
    evidence: [
      {
        code: "metadata-not-admitted",
        detail: issue.detail,
        file_offset: issue.offset,
      },
    ],
  },
  metadata: {
    status: managedMetadataFailureStatus(issue),
    version: metadataHeader?.version ?? null,
    stream_names: [...(metadataHeader?.streamNames ?? [])],
    table_row_counts: {},
  },
  module: null,
  assembly: null,
  target_frameworks: [],
  references: [],
  resources: [],
  attributes: [],
  coverage: { state: "partial", issues: [issue] },
  limitations: [
    issue.code === "unsupported-metadata"
      ? issue.detail
      : issue.code === "resource-limit"
        ? "CLI metadata inspection stopped at its representation budget; omitted facts are unknown."
        : "CLI metadata could not be read because the PE/CLI structure is malformed or unsupported.",
  ],
});

/** Inspect PE/CLI identity directly from local bytes without CLR loading. */
export const inspectManagedArtifactBytes = (
  bytes: Buffer,
  target: BinaryTarget,
): ManagedArtifactInspection => {
  const layout = readManagedPeLayout(bytes);
  if (layout.cli === null) return unavailableResult(target, bytes, layout);
  const cli = layout.cli;
  let metadata: ManagedMetadataLayout;
  try {
    const metadataOffset = layout.rvaToOffset(
      cli.metadata.rva,
      cli.metadata.size,
      "cli.metadata",
    );
    metadata = readManagedMetadataLayout(
      bytes,
      metadataOffset,
      cli.metadata.size,
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ManagedReaderFailure)) throw cause;
    return managedArtifactInspectionSchema.parse(
      admitManagedProjection(
        partialMetadataResult({
          target,
          bytes,
          layout,
          issue: cause.issue,
          metadataHeader: cause.metadataHeader,
        }),
      ),
    );
  }
  const resourceIssues: ManagedParseIssue[] = [];
  const resourceDirectory = readManagedResourceDirectory(
    layout,
    resourceIssues,
  );
  try {
    const memberLists = readTypeMemberListFacts(bytes, metadata);
    const inventory = readManagedMetadataInventory(
      bytes,
      metadata,
      resourceDirectory,
      memberLists,
    );
    const issues = [...resourceIssues, ...inventory.issues];
    const limitations = [
      ...(issues.length === 0
        ? []
        : [
            "At least one metadata or resource item could not be read; coverage is partial.",
          ]),
      "Static inspection did not load the assembly, resolve dependencies through a CLR, decompile C#, or execute target code.",
    ];
    return managedArtifactInspectionSchema.parse(
      admitManagedProjection(
        {
          ...base(target, bytes, layout),
          classification: {
            status: "managed",
            container: "pe",
            ...runtimeClassification({ layout, metadata, inventory }),
          },
          metadata: {
            status: issues.length === 0 ? "complete" : "partial",
            version: metadata.version,
            stream_names: metadata.streamNames,
            table_row_counts: managedTableRowCounts(metadata),
          },
          module: inventory.module,
          assembly: inventory.assembly,
          target_frameworks: inventory.targetFrameworks,
          references: inventory.references,
          resources: inventory.resources,
          attributes: inventory.attributes,
          coverage: {
            state: issues.length === 0 ? "complete" : "partial",
            issues,
          },
          limitations,
        },
        managedDecodeBudget(metadata),
      ),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof ManagedReaderFailure)) throw cause;
    return managedArtifactInspectionSchema.parse(
      admitManagedProjection(
        partialMetadataResult({
          target,
          bytes,
          layout,
          issue: cause.issue,
          metadataHeader: cause.metadataHeader,
        }),
      ),
    );
  }
};
