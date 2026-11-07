import { readManagedPeLayout } from "../../../../src/dotnet/ManagedPeReader.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "../../../../src/dotnet/ManagedMetadataLayout.js";
import { describe, expect, it } from "vitest";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "../../../../src/dotnet/ManagedPe.fixture.js";
import { inspectManagedNativeBoundariesBytes } from "../../../../src/dotnet/ManagedNativeBoundaryInspector.js";

import { executeManagedNativeBoundaries } from "../../../../src/application/managed/ManagedNativeVerificationService.js";
import { MANAGED_NATIVE_VERIFICATION_EXAMPLE } from "../../../../src/contracts/managed/managedWorkflowExamples.js";
import { createEvidence } from "../../../../src/domain/evidence.js";
import {
  managedNativeVerificationInputSchema,
  managedNativeVerificationResultSchema,
} from "../../../../src/domain/managed/managedNativeVerificationSchemas.js";
import { managedNativeBoundaryInspectionSchema } from "../../../../src/domain/managed/managedArtifact.js";
import { inspectMachoSchema } from "../../../../src/domain/native/nativeInspection.js";
import { functionDossierSchema } from "../../../../src/domain/native/functionDossier.js";

import { verifyManagedNativeVerificationSource } from "../../../../src/domain/managed/managedNativeVerification.js";
import { readManagedNativeVerificationSource } from "../../../../src/domain/managed/managedNativeVerificationSource.js";

const readFixtureSource = (input: unknown) => {
  const source = readManagedNativeVerificationSource(input);
  if (!source.ok)
    throw new Error("Expected valid managed/native fixture Evidence", {
      cause: source.error,
    });
  return source.value;
};

const exampleInput = () =>
  managedNativeVerificationInputSchema.parse(
    MANAGED_NATIVE_VERIFICATION_EXAMPLE,
  );

const nativeEvidenceWithExports = (
  names: readonly string[],
  path?: string,
  subjectless = false,
) => {
  const input = exampleInput();
  const native = input.native_observations[0];
  if (native === undefined || native.subject === null)
    throw new Error("missing native example");
  const macho = inspectMachoSchema.parse(native.normalized_result);
  return createEvidence(
    subjectless
      ? undefined
      : {
          path: path ?? native.subject.local_path,
          sha256: native.subject.digest.sha256,
          format: native.subject.format,
          ...(native.subject.architecture === null
            ? {}
            : { architecture: native.subject.architecture }),
        },
    native.provider,
    {
      operation: native.operation,
      parameters: native.parameters,
      result: {
        ...macho,
        exports: {
          ...macho.exports,
          items: names.map((name, index) => ({
            name,
            address: `0x${(0x1000 + index).toString(16)}`,
            weak: false,
            reexport: false,
            source: "nm",
          })),
          total: names.length,
        },
      },
      rawResult: native.raw_result,
      confidence: native.confidence,
      authority: native.authority,
      environment: native.environment,
      limitations: native.limitations,
      locations: native.locations,
      evidenceLinks: native.evidence_links,
    },
  );
};

const nativeFunctionEvidence = (
  modulePath: string,
  format: "elf" | "mach-o" | "pe" | "file",
  name = "open_native",
  sha256 = "8".repeat(64),
) => {
  const native = exampleInput().native_observations[0];
  if (native === undefined) throw new Error("missing native provider");
  const dossier = functionDossierSchema.parse({
    procedure: {
      address: "0x1000",
      name,
      classification: {
        external: false,
        thunk: false,
        thunk_target: null,
        provenance: "synthetic-provider",
      },
      body: { available: false, reason: "Synthetic fixture" },
      signature: null,
      locals: [],
    },
    pseudocode: "",
    assembly: [],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    basic_blocks: [],
    native_api: null,
    native_value_flow: null,
    limitations: [],
  });
  return createEvidence({ path: modulePath, sha256, format }, native.provider, {
    operation: "analyze_function",
    parameters: {},
    result: dossier,
    rawResult: null,
  });
};

const inputWithImportScope = (scope: string | null) => {
  const input = exampleInput();
  const managed = input.managed_boundaries;
  const normalized = managedNativeBoundaryInspectionSchema.parse(
    managed.normalized_result,
  );
  return {
    ...input,
    managed_boundaries: createEvidence(undefined, managed.provider, {
      operation: managed.operation,
      parameters: managed.parameters,
      result: {
        ...normalized,
        pinvoke_imports: normalized.pinvoke_imports.map((item) => ({
          ...item,
          import_scope_name: scope,
        })),
      },
      rawResult: null,
    }),
  };
};

it("separates CLR runtime-provided methods from unresolved file-backed native bodies", () => {
  const bytes = buildManagedPeFixture({ targetFramework: null });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Missing fixture CLI");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "fixture"),
    pe.cli.metadata.size,
  );
  bytes.writeUInt16LE(3, metadataRowOffset(layout, 6, 1) + 4);
  const target = managedPeFixtureTarget(bytes);
  const inspection = inspectManagedNativeBoundariesBytes(bytes, target);
  expect(inspection.native_implementations[0]?.boundary_kind).toBe(
    "runtime-provided",
  );
  const original = exampleInput().managed_boundaries;
  const managed = createEvidence(target, original.provider, {
    operation: "inspect_managed_native_boundaries",
    parameters: {},
    result: inspection,
  });
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      managed_boundaries: managed,
      native_observations: [
        nativeFunctionEvidence("/fixtures/nativehelper.dll", "pe"),
      ],
    }),
  );
  expect(result.summary.native_body_unresolved).toBe(0);
  expect(result.native_implementations).toMatchObject({
    unresolved: 0,
    runtime_provided: 1,
  });
});

it.each([
  { flags: 0x200, symbol: "ExampleA", format: "pe", status: "inferred" },
  { flags: 0x202, symbol: "ExampleA", format: "pe", status: "inferred" },
  { flags: 0x206, symbol: "ExampleW", format: "pe", status: "inferred" },
  { flags: 0x204, symbol: "ExampleW", format: "pe", status: "inferred" },
  { flags: 0x205, symbol: "ExampleW", format: "pe", status: "unresolved" },
  { flags: 0x206, symbol: "Example", format: "pe", status: "verified" },
  { flags: 0x200, symbol: "ExampleA", format: "elf", status: "unresolved" },
  { flags: 0x206, symbol: "ExampleW", format: "elf", status: "unresolved" },
  { flags: 0x202, symbol: "ExampleA", format: "elf", status: "unresolved" },
  { flags: 0x204, symbol: "ExampleW", format: "elf", status: "unresolved" },
  { flags: 0x204, symbol: "Example", format: "elf", status: "verified" },
  { flags: 0x202, symbol: "ExampleA", format: "mach-o", status: "unresolved" },
  { flags: 0x204, symbol: "ExampleW", format: "mach-o", status: "unresolved" },
  { flags: 0x202, symbol: "Example", format: "mach-o", status: "verified" },
  { flags: 0x300, symbol: "_Example", format: "elf", status: "unresolved" },
  {
    flags: 0x300,
    symbol: "_Example@0",
    format: "mach-o",
    status: "unresolved",
  },
  { flags: 0x300, symbol: "_Example@0", format: "pe", status: "inferred" },
  { flags: 0x200, symbol: "ExampleA", format: "file", status: "unresolved" },
  { flags: 0x206, symbol: "ExampleW", format: "file", status: "unresolved" },
  {
    flags: 0x200,
    symbol: "A",
    format: "pe",
    status: "unresolved",
    importName: "",
  },
] as const)(
  "preserves parsed P/Invoke candidate semantics for $flags $symbol $format",
  ({ flags, symbol, format, status, ...override }) => {
    const bytes = buildManagedPeFixture({
      targetFramework: null,
      pinvoke: {
        mappingFlags: flags,
        importName: "importName" in override ? override.importName : "Example",
        moduleName: "nativehelper.dll",
      },
    });
    const target = managedPeFixtureTarget(bytes);
    const inspection = inspectManagedNativeBoundariesBytes(bytes, target);
    const original = exampleInput().managed_boundaries;
    const managed = createEvidence(target, original.provider, {
      operation: "inspect_managed_native_boundaries",
      parameters: {},
      result: inspection,
    });
    const result = verifyManagedNativeVerificationSource(
      readFixtureSource({
        managed_boundaries: managed,
        native_observations: [
          nativeFunctionEvidence("/fixtures/nativehelper.dll", format, symbol),
        ],
      }),
    );
    expect(result.pinvoke_imports[0]).toMatchObject({
      status,
      managed: {
        import_name: inspection.pinvoke_imports[0]?.import_name,
        char_set: inspection.pinvoke_imports[0]?.char_set,
        no_mangle: inspection.pinvoke_imports[0]?.no_mangle,
        call_convention: inspection.pinvoke_imports[0]?.call_convention,
      },
    });
    expect(
      result.pinvoke_imports[0]?.candidates.map(({ name }) => name),
    ).toEqual(status === "unresolved" ? [] : [symbol]);
  },
);

it("keeps Windows name candidates tied to their native Evidence format", () => {
  const bytes = buildManagedPeFixture({
    pinvoke: {
      mappingFlags: 0x204,
      importName: "Example",
      moduleName: "nativehelper.dll",
    },
  });
  const target = managedPeFixtureTarget(bytes);
  const inspection = inspectManagedNativeBoundariesBytes(bytes, target);
  const managed = createEvidence(
    target,
    exampleInput().managed_boundaries.provider,
    {
      operation: "inspect_managed_native_boundaries",
      parameters: {},
      result: inspection,
    },
  );
  const elf = nativeFunctionEvidence(
    "/fixtures/nativehelper.dll",
    "elf",
    "ExampleW",
  );
  const pe = nativeFunctionEvidence(
    "/fixtures/nativehelper.dll",
    "pe",
    "ExampleW",
  );
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      managed_boundaries: managed,
      native_observations: [elf, pe],
    }),
  );
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "inferred",
    basis: "decorated-name-candidate",
    candidates: [{ evidence_id: pe.evidence_id, name: "ExampleW" }],
    evidence_links: [managed.evidence_id, pe.evidence_id],
  });
  expect(result.evidence_links).toEqual([
    managed.evidence_id,
    elf.evidence_id,
    pe.evidence_id,
  ]);
  expect(inspection.pinvoke_imports[0]).toMatchObject({
    mapping_flags: 0x204,
    char_set: "unicode",
  });
});

describe("managed/native boundary Evidence identity", () => {
  it("rejects managed boundary Evidence whose subject digest differs from its artifact", () => {
    const input = exampleInput();
    const managed = input.managed_boundaries;
    const result = managedNativeBoundaryInspectionSchema.parse(
      managed.normalized_result,
    );
    const otherDigest = "b".repeat(64);
    const mismatched = createEvidence(
      {
        path: result.artifact.path,
        sha256: result.artifact.sha256,
        format: "pe",
      },
      managed.provider,
      {
        operation: managed.operation,
        parameters: managed.parameters,
        result: {
          ...result,
          artifact: { ...result.artifact, sha256: otherDigest },
          identity_scope: {
            ...result.identity_scope,
            requires_artifact_sha256: otherDigest,
          },
        },
        rawResult: managed.raw_result,
        confidence: managed.confidence,
        authority: managed.authority,
        environment: managed.environment,
        limitations: managed.limitations,
        locations: managed.locations,
        evidenceLinks: managed.evidence_links,
      },
    );

    const rejected = readManagedNativeVerificationSource({
      ...input,
      managed_boundaries: mismatched,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        _tag: "EvidenceIntegrityError",
        message: `Managed Evidence inspect_managed_native_boundaries (${mismatched.evidence_id}) subject SHA-256 ${result.artifact.sha256} does not match normalized artifact SHA-256 ${otherDigest}`,
      },
    });
    expect(
      verifyManagedNativeVerificationSource(readFixtureSource(input)).summary
        .verified,
    ).toBe(1);
  });
});

it("verifies a P/Invoke declaration against native export Evidence", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource(exampleInput()),
  );

  expect(result).toMatchObject({
    managed_boundary: {
      artifact_sha256: "6".repeat(64),
      mvid: "00112233-4455-4677-8899-aabbccddeeff",
      pinvoke_imports_total: 1,
    },
    summary: { verified: 1 },
    pinvoke_imports: [
      {
        managed: {
          import_name: "open_native",
          import_scope_name: "nativehelper.dll",
        },
        status: "verified",
        basis: "exact-export-name",
        confidence: "observed",
        matched_native: { name: "open_native" },
      },
    ],
  });
});

it("treats a Mach-O ABI-prefixed export as an exact declared import", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...exampleInput(),
      native_observations: [nativeEvidenceWithExports(["_open_native"])],
    }),
  );

  expect(result.summary).toMatchObject({ verified: 1, inferred: 0 });
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "verified",
    basis: "exact-export-name",
    matched_native: { name: "_open_native" },
  });
});

it("reports module mismatch as a contradiction within supplied Evidence", () => {
  const input = exampleInput();
  const native = input.native_observations[0];
  if (native === undefined || native.subject === null)
    throw new Error("missing native example");
  const mismatched = createEvidence(
    {
      path: "/examples/other.dll",
      sha256: native.subject.digest.sha256,
      format: "pe",
      ...(native.subject.architecture === null
        ? {}
        : { architecture: native.subject.architecture }),
    },
    native.provider,
    {
      operation: native.operation,
      parameters: native.parameters,
      result: native.normalized_result,
      rawResult: native.raw_result,
      confidence: native.confidence,
      authority: native.authority,
      environment: native.environment,
      limitations: native.limitations,
      locations: native.locations,
      evidenceLinks: native.evidence_links,
    },
  );

  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...input,
      native_observations: [mismatched],
    }),
  );

  expect(result.summary).toMatchObject({
    verified: 0,
    contradicted: 1,
  });
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "contradicted",
    basis: "module-mismatch",
  });
});

it("matches ELF module names case-sensitively and leaves unknown platform equivalence unresolved", () => {
  const linuxInput = inputWithImportScope("caseprobe");
  const elfExact = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...linuxInput,
      native_observations: [
        nativeFunctionEvidence("/examples/libcaseprobe.so", "elf"),
      ],
    }),
  );
  expect(elfExact.pinvoke_imports[0]).toMatchObject({
    status: "verified",
    basis: "exact-function-name",
    matched_native: { module_path: "/examples/libcaseprobe.so" },
  });

  const elfCaseMismatch = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...linuxInput,
      native_observations: [
        nativeFunctionEvidence("/examples/libCaseProbe.so", "elf"),
      ],
    }),
  );
  expect(elfCaseMismatch.pinvoke_imports[0]).toMatchObject({
    status: "contradicted",
    basis: "module-mismatch",
    matched_native: { module_path: "/examples/libCaseProbe.so" },
  });
  const workflow = executeManagedNativeBoundaries({
    ...linuxInput,
    native_observations: [
      nativeFunctionEvidence("/examples/libCaseProbe.so", "elf"),
    ],
  });
  expect(workflow.ok).toBe(true);
  if (!workflow.ok) throw workflow.error;
  expect(workflow.value.evidence.normalized_result).toMatchObject({
    summary: { contradicted: 1, verified: 0 },
    pinvoke_imports: [
      expect.objectContaining({
        basis: "module-mismatch",
        confidence: "unknown",
      }),
    ],
  });

  const uncertainPlatform = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("foo"),
      native_observations: [
        nativeEvidenceWithExports(["open_native"], "/examples/libFoo.dylib"),
      ],
    }),
  );
  expect(uncertainPlatform.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    basis: "module-identity-unknown",
    matched_native: { module_path: "/examples/libFoo.dylib" },
  });
});

it("keeps literal module names distinct and accepts the shared-library lib alias", () => {
  const literalName = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("library"),
      native_observations: [
        nativeEvidenceWithExports(["open_native"], "/examples/rary.dylib"),
      ],
    }),
  );
  expect(literalName.pinvoke_imports[0]).toMatchObject({
    status: "contradicted",
    basis: "module-mismatch",
    matched_native: { module_path: "/examples/rary.dylib" },
  });

  const sharedLibraryAlias = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("foo"),
      native_observations: [
        nativeEvidenceWithExports(["open_native"], "/examples/libfoo.dylib"),
      ],
    }),
  );
  expect(sharedLibraryAlias.pinvoke_imports[0]).toMatchObject({
    status: "verified",
    basis: "exact-export-name",
    matched_native: { module_path: "/examples/libfoo.dylib" },
  });
});

it("keeps explicit PE module suffixes distinct and permits the Windows DLL variation", () => {
  const verify = (scope: string, modulePath: string) =>
    verifyManagedNativeVerificationSource(
      readFixtureSource({
        ...inputWithImportScope(scope),
        native_observations: [nativeFunctionEvidence(modulePath, "pe")],
      }),
    ).pinvoke_imports[0];

  expect(
    verify("nativehelper.dll", "/examples/nativehelper.dll"),
  ).toMatchObject({
    status: "verified",
    basis: "exact-function-name",
  });
  for (const suffix of ["exe", "node"]) {
    expect(
      verify("nativehelper.dll", `/examples/nativehelper.${suffix}`),
    ).toMatchObject({
      status: "contradicted",
      basis: "module-mismatch",
    });
  }
  expect(verify("nativehelper", "/examples/nativehelper.dll")).toMatchObject({
    status: "verified",
    basis: "exact-function-name",
  });
  expect(
    verify("C:\\examples\\nativehelper.dll", "C:\\examples\\nativehelper.dll"),
  ).toMatchObject({ status: "verified" });
  expect(
    verify("C:\\examples\\nativehelper.dll", "C:\\other\\nativehelper.dll"),
  ).toMatchObject({ status: "contradicted", basis: "module-mismatch" });
});

it("keeps empty identities unknown and compares suffix-only identities as data", () => {
  for (const scope of [null, "", "   "]) {
    const result = verifyManagedNativeVerificationSource(
      readFixtureSource({
        ...inputWithImportScope(scope),
        native_observations: [nativeEvidenceWithExports(["open_native"])],
      }),
    );
    expect(result.pinvoke_imports[0]).toMatchObject({
      status: "unresolved",
      basis: "module-identity-unknown",
      matched_native: { name: "open_native" },
      candidates: [{ name: "open_native" }],
    });
    expect(result.pinvoke_imports[0]?.limitations).toContain(
      "A native name candidate exists, but a required module identity is unavailable; module correspondence is unknown.",
    );
  }

  for (const path of [
    "/examples/lib.dylib",
    "/examples/lib.so",
    "/examples/foo.dll",
  ]) {
    const extensionOnly = verifyManagedNativeVerificationSource(
      readFixtureSource({
        ...inputWithImportScope(".dll"),
        native_observations: [nativeEvidenceWithExports(["open_native"], path)],
      }),
    );
    expect(extensionOnly.pinvoke_imports[0]).toMatchObject({
      status: "contradicted",
      basis: "module-mismatch",
      candidates: [{ name: "open_native", module_path: path }],
    });
  }

  const subjectless = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativehelper.dll"),
      native_observations: [
        nativeEvidenceWithExports(["open_native"], undefined, true),
      ],
    }),
  );
  expect(subjectless.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    basis: "module-identity-unknown",
    matched_native: {
      name: "open_native",
      module_name: null,
      module_path: null,
    },
    candidates: [{ name: "open_native" }],
  });
});

it("retains a decorated module match when another decorated candidate has unknown identity", () => {
  const input = inputWithImportScope("nativehelper.dll");
  const parent = input.managed_boundaries;
  const normalized = managedNativeBoundaryInspectionSchema.parse(
    parent.normalized_result,
  );
  const managed = createEvidence(undefined, parent.provider, {
    operation: parent.operation,
    parameters: parent.parameters,
    result: {
      ...normalized,
      pinvoke_imports: normalized.pinvoke_imports.map((item) => ({
        ...item,
        char_set: "unicode",
        no_mangle: false,
      })),
    },
    rawResult: null,
  });
  const known = nativeFunctionEvidence(
    "/examples/nativehelper.dll",
    "pe",
    "open_nativeW",
  );
  const subjectless = (name: string) => {
    const source = nativeFunctionEvidence("/examples/unknown.dll", "pe", name);
    return createEvidence(undefined, source.provider, {
      operation: source.operation,
      parameters: source.parameters,
      result: source.normalized_result,
      rawResult: null,
    });
  };
  for (const name of ["open_nativeW", "open_native"]) {
    const unknown = subjectless(name);
    for (const observations of [
      [known, unknown],
      [unknown, known],
    ]) {
      const result = executeManagedNativeBoundaries({
        managed_boundaries: managed,
        native_observations: observations,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      const output = managedNativeVerificationResultSchema.parse(
        result.value.evidence.normalized_result,
      );
      expect(output.pinvoke_imports[0]).toMatchObject(
        name === "open_nativeW"
          ? {
              status: "inferred",
              basis: "decorated-name-candidate",
              matched_native: { evidence_id: known.evidence_id },
            }
          : {
              status: "unresolved",
              basis: "module-identity-unknown",
              matched_native: { evidence_id: unknown.evidence_id },
            },
      );
      expect(output.pinvoke_imports[0]?.candidates).toHaveLength(2);
      expect(output.evidence_links).toEqual(
        expect.arrayContaining([known.evidence_id, unknown.evidence_id]),
      );
      expect(result.value.sourceEvidence).toEqual([managed, ...observations]);
    }
  }
});

it("matches versioned ELF SONAME variations without dropping their version", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativedep.so.6"),
      native_observations: [
        nativeFunctionEvidence("/examples/libnativedep.so.6", "elf"),
      ],
    }),
  );
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "verified",
    matched_native: { module_path: "/examples/libnativedep.so.6" },
  });

  const relativePath = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("relative/nativedep.so.6"),
      native_observations: [
        nativeFunctionEvidence("/examples/relative/nativedep.so.6", "elf"),
      ],
    }),
  );
  expect(relativePath.pinvoke_imports[0]).toMatchObject({ status: "verified" });

  const basenameOnly = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("relative/nativedep.so.6"),
      native_observations: [
        nativeFunctionEvidence("/examples/other/nativedep.so.6", "elf"),
      ],
    }),
  );
  expect(basenameOnly.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    basis: "module-identity-unknown",
  });
});

it("keeps POSIX backslashes literal in absolute module paths", () => {
  const path = "/examples/native\\helper.so";
  const exact = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope(path),
      native_observations: [nativeFunctionEvidence(path, "elf")],
    }),
  );
  expect(exact.pinvoke_imports[0]).toMatchObject({ status: "verified" });

  const slashEquivalent = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope(path),
      native_observations: [
        nativeFunctionEvidence("/examples/native/helper.so", "elf"),
      ],
    }),
  );
  expect(slashEquivalent.pinvoke_imports[0]).toMatchObject({
    status: "contradicted",
    basis: "module-mismatch",
  });
});

it.each([
  { scope: "/examples/nativehelper.so", path: "/", format: "elf" as const },
  { scope: "nativehelper.dll", path: "C:\\", format: "pe" as const },
])(
  "retains unknown identity for an empty module filename ($format)",
  ({ scope, path, format }) => {
    const unknown = nativeFunctionEvidence(path, format);
    const mismatch = nativeFunctionEvidence(
      "/examples/unrelated",
      format,
      "open_native",
      "9".repeat(64),
    );
    for (const observations of [
      [unknown],
      [mismatch, unknown],
      [unknown, mismatch],
    ]) {
      const result = verifyManagedNativeVerificationSource(
        readFixtureSource({
          ...inputWithImportScope(scope),
          native_observations: observations,
        }),
      );
      expect(result.pinvoke_imports[0]).toMatchObject({
        status: "unresolved",
        basis: "module-identity-unknown",
        matched_native: { evidence_id: unknown.evidence_id },
      });
    }
  },
);

it("retains a trailing POSIX backslash as module identity", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativehelper\\"),
      native_observations: [
        nativeFunctionEvidence("/examples/nativehelper\\", "elf"),
      ],
    }),
  );
  expect(result.pinvoke_imports[0]).toMatchObject({ status: "verified" });
});

it("applies Unix suffix variations even when the name already has the suffix", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativehelper.dylib"),
      native_observations: [
        nativeFunctionEvidence("/examples/nativehelper.dylib.dylib", "mach-o"),
      ],
    }),
  );
  expect(result.pinvoke_imports[0]).toMatchObject({ status: "verified" });
});

it("does not append the Windows DLL suffix after a trailing period", () => {
  const exact = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativehelper."),
      native_observations: [
        nativeFunctionEvidence("/examples/nativehelper.", "pe"),
      ],
    }),
  );
  expect(exact.pinvoke_imports[0]).toMatchObject({ status: "verified" });

  const appended = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...inputWithImportScope("nativehelper."),
      native_observations: [
        nativeFunctionEvidence("/examples/nativehelper.dll", "pe"),
      ],
    }),
  );
  expect(appended.pinvoke_imports[0]).toMatchObject({
    status: "contradicted",
    basis: "module-mismatch",
  });
});

it("treats supported native Evidence with no symbols as unresolved", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...exampleInput(),
      native_observations: [nativeEvidenceWithExports([])],
    }),
  );

  expect(result.native_observations).toMatchObject({
    accepted: 1,
    unsupported: 0,
    symbols: 0,
  });
  expect(result.summary).toMatchObject({
    verified: 0,
    unresolved: 1,
  });
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    basis: "no-native-candidate",
  });
});

it("does not verify a symbol whose spelling differs only by case", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...exampleInput(),
      native_observations: [nativeEvidenceWithExports(["OPEN_NATIVE"])],
    }),
  );

  expect(result.summary).toMatchObject({ verified: 0, unresolved: 1 });
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    matched_native: null,
    candidates: [],
  });
});

it("retains every observed native candidate", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...exampleInput(),
      native_observations: [
        nativeEvidenceWithExports(["open_native", "_open_native"]),
      ],
    }),
  );

  expect(result.coverage).toMatchObject({
    status: "complete-within-inputs",
  });
  expect(result.pinvoke_imports[0]?.candidates).toHaveLength(2);
});

it("wraps verification in derived workflow Evidence", () => {
  const evidence = executeManagedNativeBoundaries(exampleInput());

  if (!evidence.ok) throw evidence.error;
  expect(evidence.value.evidence).toMatchObject({
    operation: "verify_managed_native_boundaries",
    provider: { id: "rea-dotnet-workflows" },
    confidence: "inferred",
    authority: "analyst-inference",
    normalized_result: {
      summary: { verified: 1 },
    },
  });
  expect(evidence.value.evidence.evidence_links).toHaveLength(2);
});

describe("managed/native verification result algebra", () => {
  it("rejects states without their required native match", () => {
    const result = verifyManagedNativeVerificationSource(
      readFixtureSource(exampleInput()),
    );
    const verification = result.pinvoke_imports[0];
    expect(verification).toBeDefined();
    if (verification === undefined) return;

    expect(
      managedNativeVerificationResultSchema.safeParse({
        ...result,
        pinvoke_imports: [
          {
            ...verification,
            matched_native: null,
            candidates: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      managedNativeVerificationResultSchema.safeParse({
        ...result,
        pinvoke_imports: [
          {
            ...verification,
            status: "unresolved",
            basis: "no-native-candidate",
            confidence: "unknown",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      managedNativeVerificationResultSchema.safeParse({
        ...result,
        coverage: {
          status: "complete-within-inputs",
          omitted_native_observations: 0,
          omitted_candidates: 1,
        },
      }).success,
    ).toBe(false);
  });
});

it("does not erase a C identifier underscore beyond the Mach-O ABI prefix", () => {
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...exampleInput(),
      native_observations: [nativeEvidenceWithExports(["__open_native"])],
    }),
  );
  expect(result.summary).toMatchObject({ inferred: 0, unresolved: 1 });
  expect(result.pinvoke_imports[0]).toMatchObject({
    status: "unresolved",
    candidates: [],
    matched_native: null,
  });
});

it("does not treat a raw Mach-O ABI name as an exact underscored C identifier", () => {
  const input = exampleInput();
  const managed = input.managed_boundaries;
  const normalized = managedNativeBoundaryInspectionSchema.parse(
    managed.normalized_result,
  );
  const imports = normalized.pinvoke_imports;
  const result = verifyManagedNativeVerificationSource(
    readFixtureSource({
      ...input,
      managed_boundaries: createEvidence(undefined, managed.provider, {
        operation: managed.operation,
        parameters: managed.parameters,
        result: {
          ...normalized,
          pinvoke_imports: imports.map((item) => ({
            ...item,
            import_name: "_open_native",
            no_mangle: true,
          })),
        },
        rawResult: null,
      }),
      native_observations: [nativeEvidenceWithExports(["_open_native"])],
    }),
  );
  expect(result.summary).toMatchObject({
    verified: 0,
    inferred: 0,
    unresolved: 1,
  });
  expect(result.pinvoke_imports[0]?.candidates).toEqual([]);
});
