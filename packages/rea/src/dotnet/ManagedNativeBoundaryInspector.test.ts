import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { inspectManagedNativeBoundariesBytes } from "./ManagedNativeBoundaryInspector.js";
import {
  buildManagedPeFixture,
  buildNativePeFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";

describe("managed native boundaries", () => {
  it("inspects managed/native PInvoke declarations without verifying native exports", () => {
    const bytes = buildManagedPeFixture({
      pinvoke: {
        moduleName: "user32.dll",
        importName: "MessageBoxW",
        mappingFlags: 0x0345,
      },
      readyToRun: true,
    });
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.cli_native).toMatchObject({
      il_only: true,
      ready_to_run_signature: true,
      managed_native_header_rva: 0x2700,
      managed_native_header_size: 4,
    });
    expect(result.module_refs).toEqual([
      {
        token: "0x1a000001",
        row_offset: expect.any(Number),
        name: "user32.dll",
      },
    ]);
    expect(result.pinvoke_imports).toEqual([
      expect.objectContaining({
        token: "0x1c000001",
        member_token: "0x06000001",
        member_kind: "method",
        member_name: "Main",
        import_name: "MessageBoxW",
        import_scope_token: "0x1a000001",
        import_scope_name: "user32.dll",
        no_mangle: true,
        char_set: "unicode",
        call_convention: "stdcall",
        supports_last_error: true,
        verification: "managed-declaration-only",
      }),
    ]);
    expect(result.native_implementations).toEqual([
      expect.objectContaining({
        token: "0x06000001",
        name: "Main",
        pinvoke_declared: true,
        boundary_kind: "pinvoke",
        body_interpretation: "native-or-runtime",
      }),
    ]);
    expect(result.summary).toMatchObject({
      module_ref_count: 1,
      pinvoke_import_count: 1,
      native_implementation_count: 1,
      ready_to_run: true,
      mixed_mode_or_native_header: true,
    });
    expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
    expect(result.limitations).toContain(
      "P/Invoke rows prove managed import declarations only; this inspection does not verify that a native library, export, thunk, or provider-qualified function exists.",
    );
  });

  it.each([
    {
      name: "C++/CLI with a native method body",
      options: {
        cliFlags: 0,
        methods: [
          { name: "NativeMethod", body: Buffer.from([0xc3]), implFlags: 1 },
        ],
      },
      mixed: true,
    },
    {
      name: "ILONLY clear with unreadable metadata",
      options: { cliFlags: 0, corruptMetadataSignature: true },
      mixed: true,
    },
    { name: "pure IL", options: {}, mixed: false },
    { name: "ReadyToRun", options: { readyToRun: true }, mixed: true },
  ])("agrees with artifact classification for $name", ({ options, mixed }) => {
    const bytes = buildManagedPeFixture(options);
    const target = managedPeFixtureTarget(bytes);
    const artifact = inspectManagedArtifactBytes(bytes, target);
    const boundaries = inspectManagedNativeBoundariesBytes(bytes, target);

    expect(boundaries.summary.mixed_mode_or_native_header).toBe(mixed);
    if (artifact.classification.runtime_family === "mixed-clr-native")
      expect(boundaries.summary.mixed_mode_or_native_header).toBe(true);
  });
});

describe("managed native boundary coded indexes", () => {
  it("retains P/Invoke imports with an invalid MemberForwarded index as partial evidence", () => {
    const bytes = buildManagedPeFixture({
      pinvoke: { memberForwardedRaw: 5 },
    });
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.pinvoke_imports).toMatchObject([
      {
        member_token: null,
        member_kind: "unknown",
        member_name: null,
        import_name: "MessageBoxW",
      },
    ]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          scope: "metadata.ImplMap:0x1c000001",
          detail: expect.stringContaining(
            "coded index 0x5 is invalid: coded index selects row 2 in table 6, which has 1 rows",
          ),
        }),
      ],
    });
    expect(result.coverage.issues[0]?.offset).toBe(
      (result.pinvoke_imports[0]?.row_offset ?? 0) + 2,
    );
  });

  it("reports null for the required MemberForwarded index", () => {
    const bytes = buildManagedPeFixture({
      pinvoke: { memberForwardedRaw: 0 },
    });
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.pinvoke_imports).toMatchObject([
      { member_token: null, member_kind: "unknown" },
    ]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          detail:
            "ImplMap MemberForwarded coded index 0x0 is null, but the column must reference a Field or MethodDef row",
        }),
      ],
    });
  });
});

it.each([0, 2])(
  "retains imports and reports invalid ModuleRef row %i as partial",
  (scopeRow) => {
    const bytes = buildManagedPeFixture({ pinvoke: {} });
    const original = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const row = original.pinvoke_imports[0]?.row_offset;
    if (row === undefined) throw new Error("Fixture must contain an ImplMap");
    bytes.writeUInt16LE(scopeRow, row + 6);
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.pinvoke_imports).toMatchObject([
      {
        import_name: "MessageBoxW",
        import_scope_token: null,
        import_scope_name: null,
      },
    ]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          scope: "metadata.ImplMap:0x1c000001",
          offset: row + 6,
          detail: expect.stringContaining("ImportScope"),
        }),
      ],
    });
  },
);

it("reports field imports as declarations without inventing method implementations", () => {
  const bytes = buildManagedPeFixture({ pinvoke: { memberForwardedRaw: 2 } });
  const result = inspectManagedNativeBoundariesBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.pinvoke_imports).toMatchObject([
    {
      member_kind: "field",
      member_token: "0x04000001",
      member_name: "counter",
    },
  ]);
  expect(
    result.native_implementations.every((item) =>
      item.token.startsWith("0x06"),
    ),
  ).toBe(true);
});

describe("managed native boundary inspection", () => {
  it("returns complete member inventories inline and reports unavailable metadata", () => {
    const bytes = buildManagedPeFixture();
    const paged = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(paged.methods).toHaveLength(1);

    const nativeBytes = buildNativePeFixture();
    const native = inspectManagedMembersBytes(
      nativeBytes,
      managedPeFixtureTarget(nativeBytes),
    );
    expect(native.metadata.status).toBe("absent");
    expect(native.coverage.state).toBe("unavailable");

    const malformedBytes = buildManagedPeFixture({
      corruptMetadataSignature: true,
    });
    const malformed = inspectManagedMembersBytes(
      malformedBytes,
      managedPeFixtureTarget(malformedBytes),
    );
    expect(malformed.metadata.status).toBe("malformed");
    expect(malformed.coverage.issues).toEqual([
      expect.objectContaining({ code: "invalid-metadata-root" }),
    ]);
  });

  it("reports unavailable boundaries for native and malformed PE files", () => {
    const nativeBytes = buildNativePeFixture();
    const native = inspectManagedNativeBoundariesBytes(
      nativeBytes,
      managedPeFixtureTarget(nativeBytes),
    );
    expect(native).toMatchObject({
      metadata: { status: "absent" },
      pinvoke_imports: [],
      coverage: { state: "unavailable", issues: [] },
    });

    const malformedBytes = buildManagedPeFixture({
      corruptMetadataSignature: true,
      readyToRun: true,
    });
    const malformed = inspectManagedNativeBoundariesBytes(
      malformedBytes,
      managedPeFixtureTarget(malformedBytes),
    );
    expect(malformed).toMatchObject({
      metadata: { status: "malformed" },
      cli_native: {
        il_only: true,
        ready_to_run_signature: true,
        managed_native_header_rva: 0x2700,
        managed_native_header_size: 4,
      },
      summary: { ready_to_run: true, mixed_mode_or_native_header: true },
      coverage: {
        state: "unavailable",
        issues: [expect.objectContaining({ code: "invalid-metadata-root" })],
      },
    });
    expect(malformed.limitations).not.toContainEqual(
      expect.stringContaining("CLI header was not admitted"),
    );
  });

  it("reports unknown CLI header facts when the CLI header is unreadable", () => {
    const bytes = buildManagedPeFixture();
    bytes.writeUInt32LE(0x7fff_0000, 0x84 + 20 + 96 + 14 * 8);
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result).toMatchObject({
      metadata: { status: "malformed" },
      cli_native: null,
      summary: { ready_to_run: null, mixed_mode_or_native_header: null },
      coverage: { state: "unavailable", issues: [expect.anything()] },
    });
  });
});

describe("independent managed metadata facets", () => {
  it("preserves identity, members, and imports when embedded resources are malformed", () => {
    const bytes = buildManagedPeFixture({
      mvid: Buffer.from("3aebc60edc4a544b1f458b4ed40b33b1", "hex"),
      pinvoke: {},
      readyToRun: true,
    });
    bytes.writeUInt32LE(0x7fff_0000, 0x0200 + 24);
    const target = managedPeFixtureTarget(bytes);
    const artifact = inspectManagedArtifactBytes(bytes, target);
    const members = inspectManagedMembersBytes(bytes, target);
    const native = inspectManagedNativeBoundariesBytes(bytes, target);

    for (const result of [artifact, members, native]) {
      expect(result.module?.mvid).toBe("0ec6eb3a-4adc-4b54-1f45-8b4ed40b33b1");
      expect(result.metadata.status).toBe("partial");
      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: expect.arrayContaining([
          expect.objectContaining({
            scope: "cli.resources",
            code: "invalid-directory",
          }),
        ]),
      });
    }
    expect({
      artifact: native.artifact,
      module: native.module,
      metadata: native.metadata,
      identity_scope: native.identity_scope,
    }).toEqual({
      artifact: members.artifact,
      module: members.module,
      metadata: members.metadata,
      identity_scope: members.identity_scope,
    });
    expect(members.methods[0]?.name).toBe("Main");
    expect(native.pinvoke_imports[0]?.import_name).toBe("MessageBoxW");
    expect(native.cli_native?.ready_to_run_signature).toBe(true);
  });

  it("preserves native declarations when a module name cannot be decoded", () => {
    const bytes = buildManagedPeFixture({ pinvoke: {} });
    const original = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const row = original.module_refs[0]?.row_offset;
    if (row === undefined) throw new Error("Fixture must contain a ModuleRef");
    bytes.writeUInt16LE(0xffff, row);
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.module_refs).toEqual([]);
    expect(result.pinvoke_imports).toMatchObject([
      {
        import_name: "MessageBoxW",
        import_scope_token: "0x1a000001",
        import_scope_name: null,
      },
    ]);
    expect(result.native_implementations[0]?.name).toBe("Main");
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "invalid-heap-index" }),
      ]),
    });
  });
});

describe("managed PE fixture layout", () => {
  it("keeps ReadyToRun metadata separate from expanded metadata and resources", () => {
    const resourceData = Buffer.alloc(64 * 1024, 0x5a);
    const bytes = buildManagedPeFixture({
      readyToRun: true,
      references: Array.from(
        { length: 2_200 },
        (_, index) => `Reference.${String(index).padStart(4, "0")}`,
      ),
      resourceData,
    });
    const target = managedPeFixtureTarget(bytes);
    const artifact = inspectManagedArtifactBytes(bytes, target);
    const boundaries = inspectManagedNativeBoundariesBytes(bytes, target);

    expect(artifact.coverage).toMatchObject({ state: "complete", issues: [] });
    expect(artifact.references).toHaveLength(2_200);
    expect(artifact.resources[0]).toMatchObject({
      data_length: resourceData.length,
      data_sha256: createHash("sha256").update(resourceData).digest("hex"),
    });
    expect(boundaries.cli_native).toMatchObject({
      ready_to_run_signature: true,
      managed_native_header_size: 4,
    });
    expect(boundaries.cli_native?.managed_native_header_rva).toBeGreaterThan(
      0x2700,
    );
  });
});

const inspectImplementationFixture = ({
  implFlags,
  methodFlags = 0x0016,
  zeroRva = false,
  implMap = false,
}: {
  implFlags: number;
  methodFlags?: number;
  zeroRva?: boolean;
  implMap?: boolean;
}) => {
  const bytes = buildManagedPeFixture({
    methodFlags,
    ...(implMap ? { pinvoke: {} } : {}),
  });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const { rva, size } = pe.cli.metadata;
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(rva, size, "cli.metadata"),
    size,
  );
  const row = metadataRowOffset(layout, 6, 1);
  bytes.writeUInt16LE(implFlags, row + 4);
  if (zeroRva) bytes.writeUInt32LE(0, row);
  const target = managedPeFixtureTarget(bytes);
  return {
    members: inspectManagedMembersBytes(bytes, target),
    boundaries: inspectManagedNativeBoundariesBytes(bytes, target),
  };
};

it.each([
  { bits: 0, codeType: "il", managedKind: "managed", boundary: null },
  {
    bits: 1,
    codeType: "native",
    managedKind: "managed",
    boundary: "native-body",
  },
  {
    bits: 2,
    codeType: "optil",
    managedKind: "managed",
    boundary: "mixed-or-unknown",
  },
  {
    bits: 3,
    codeType: "runtime",
    managedKind: "managed",
    boundary: "runtime-provided",
  },
  {
    bits: 4,
    codeType: "il",
    managedKind: "unmanaged",
    boundary: "unmanaged-method",
  },
  {
    bits: 5,
    codeType: "native",
    managedKind: "unmanaged",
    boundary: "native-body",
  },
  {
    bits: 6,
    codeType: "optil",
    managedKind: "unmanaged",
    boundary: "unmanaged-method",
  },
  {
    bits: 7,
    codeType: "runtime",
    managedKind: "unmanaged",
    boundary: "runtime-provided",
  },
])(
  "publishes implementation facts consistently with body admission for low flags $bits",
  ({ bits, codeType, managedKind, boundary }) => {
    // NoInlining, Synchronized and PreserveSig do not change code type or managed kind.
    for (const highBits of [0, 0x00a8]) {
      const implFlags = bits | highBits;
      const { members, boundaries } = inspectImplementationFixture({
        implFlags,
      });
      expect(members.methods[0]?.body.status).toBe(
        boundary === null ? "present" : "partial",
      );
      if (boundary === null) {
        expect(boundaries.native_implementations).toEqual([]);
        expect(members.methods[0]?.body.il_sha256).toEqual(expect.any(String));
      } else {
        expect(boundaries.native_implementations).toMatchObject([
          {
            token: members.methods[0]?.token,
            impl_flags: implFlags,
            code_type: codeType,
            managed_kind: managedKind,
            pinvoke_declared: false,
            boundary_kind: boundary,
            body_interpretation: "native-or-runtime",
          },
        ]);
        expect(members.methods[0]?.body.il_sha256).toBeNull();
        expect(members.methods[0]?.body.issue).toMatch(/CIL/u);
      }
    }
  },
);

it.each([
  {
    name: "PInvoke flag on managed IL",
    implFlags: 0,
    methodFlags: 0x2016,
    zeroRva: false,
    implMap: false,
    status: "partial",
    codeType: "il",
    managedKind: "managed",
  },
  {
    name: "PInvoke flag on unmanaged OPTIL",
    implFlags: 6,
    methodFlags: 0x2016,
    zeroRva: false,
    implMap: false,
    status: "partial",
    codeType: "optil",
    managedKind: "unmanaged",
  },
  {
    name: "absent RVA before PInvoke/runtime classification",
    implFlags: 7,
    methodFlags: 0x2016,
    zeroRva: true,
    implMap: false,
    status: "absent",
    codeType: "runtime",
    managedKind: "unmanaged",
  },
  {
    name: "ImplMap without the PInvoke flag",
    implFlags: 0,
    methodFlags: 0x0016,
    zeroRva: false,
    implMap: true,
    status: "present",
    codeType: "il",
    managedKind: "managed",
  },
])(
  "retains distinct native declaration and body policies: $name",
  (scenario) => {
    const { members, boundaries } = inspectImplementationFixture(scenario);
    expect(boundaries.native_implementations).toMatchObject([
      {
        token: members.methods[0]?.token,
        flags: scenario.methodFlags,
        code_type: scenario.codeType,
        managed_kind: scenario.managedKind,
        pinvoke_declared: true,
        boundary_kind: "pinvoke",
        body_interpretation: scenario.zeroRva
          ? "not-file-backed"
          : "native-or-runtime",
      },
    ]);
    expect(boundaries.pinvoke_imports).toHaveLength(scenario.implMap ? 1 : 0);
    expect(members.methods[0]?.body.status).toBe(scenario.status);
    if (scenario.zeroRva)
      expect(members.methods[0]?.body).toMatchObject({
        rva: 0,
        issue: null,
        il_sha256: null,
      });
    if (scenario.status === "present")
      expect(members.methods[0]?.body.il_sha256).toEqual(expect.any(String));
  },
);

it.each(
  [2, 4].flatMap((stringWidth) =>
    [2, 4].flatMap((blobWidth) =>
      [false, true].map((badName) => ({ stringWidth, blobWidth, badName })),
    ),
  ),
)(
  "keeps Field heap admission consumer-specific with string=$stringWidth/blob=$blobWidth/badName=$badName",
  ({ stringWidth, blobWidth, badName }) => {
    const bytes = buildManagedPeFixture({
      pinvoke: { memberForwardedRaw: 2 },
      methodFlags: 0x0016,
      ...(stringWidth === 4 ? { assemblyName: "A".repeat(65536) } : {}),
      ...(blobWidth === 4
        ? { standaloneSignatures: [Buffer.alloc(65536)] }
        : {}),
    });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("Expected CLI fixture");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "cli.metadata"),
      size,
    );
    expect(layout.stringIndexSize).toBe(stringWidth);
    expect(layout.blobIndexSize).toBe(blobWidth);
    const row = metadataRowOffset(layout, 4, 1);
    if (badName)
      bytes.writeUIntLE(
        stringWidth === 2 ? 0xffff : 0xffffffff,
        row + 2,
        stringWidth,
      );
    bytes.writeUIntLE(
      blobWidth === 2 ? 0xffff : 0xffffffff,
      row + 2 + stringWidth,
      blobWidth,
    );
    const target = managedPeFixtureTarget(bytes);
    const members = inspectManagedMembersBytes(bytes, target);
    const native = inspectManagedNativeBoundariesBytes(bytes, target);
    expect(members.fields).toEqual([]);
    expect(
      members.coverage.issues.filter(
        ({ scope }) =>
          scope === "metadata.#Strings" || scope === "metadata.#Blob",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: badName ? "metadata.#Strings" : "metadata.#Blob",
      }),
    ]);
    expect(native.pinvoke_imports).toMatchObject([
      {
        member_kind: "field",
        member_token: "0x04000001",
        member_name: badName ? null : "counter",
      },
    ]);
    expect(
      native.coverage.issues.filter(
        ({ scope }) =>
          scope === "metadata.#Strings" || scope === "metadata.#Blob",
      ),
    ).toEqual(
      badName
        ? [
            expect.objectContaining({
              code: "invalid-heap-index",
              scope: "metadata.#Strings",
            }),
          ]
        : [],
    );
    if (!badName)
      expect(members.field_accesses).toContainEqual(
        expect.objectContaining({
          field_token: "0x04000001",
          field_name: "counter",
        }),
      );
  },
);

it.each([8, 9])(
  "keeps reserved CustomAttributeType tag %i distinct from a valid constructor",
  (constructor) => {
    const value = Buffer.from([1, 0, 0, 0, 0]);
    const bytes = buildManagedPeFixture({
      customAttributeTypeRaw: constructor,
      customAttributeValue: value,
    });
    const result = inspectManagedArtifactBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.attributes).toMatchObject([
      {
        parent_token: "0x20000001",
        constructor_token: null,
        type_name: null,
        value_length: value.length,
        value_sha256: createHash("sha256").update(value).digest("hex"),
      },
    ]);
    expect(result.coverage.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-row",
        scope: "metadata.CustomAttribute:0x0c000001",
        detail: expect.stringContaining(
          `coded index tag ${constructor - 8} is not defined`,
        ),
      }),
    );
  },
);

it.each([
  { options: { methodRowCount: 8191 }, table: 6, count: 8191, width: 2 },
  { options: { methodRowCount: 8192 }, table: 6, count: 8192, width: 4 },
  { options: { memberRefRowCount: 8191 }, table: 10, count: 8191, width: 2 },
  { options: { memberRefRowCount: 8192 }, table: 10, count: 8192, width: 4 },
  { options: { moduleRowCount: 8192 }, table: 0, count: 8192, width: 2 },
])(
  "sizes CustomAttributeType from real target-table $table count $count",
  ({ options, table, count, width }) => {
    const bytes = buildManagedPeFixture(options);
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("Expected CLI fixture");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "cli.metadata"),
      size,
    );
    expect(layout.table(table)?.rowCount).toBe(count);
    expect(layout.codedIndexSize("CustomAttributeType")).toBe(width);
  },
);

it("retains an ImplMap method identity independently of its unreadable name", () => {
  const bytes = buildManagedPeFixture({ pinvoke: {} });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const { rva, size } = pe.cli.metadata;
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(rva, size, "cli.metadata"),
    size,
  );
  const row = metadataRowOffset(layout, 6, 1);
  bytes.writeUIntLE(
    layout.stringIndexSize === 2 ? 0xffff : 0xffffffff,
    row + 8,
    layout.stringIndexSize,
  );
  const result = inspectManagedNativeBoundariesBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.pinvoke_imports).toMatchObject([
    {
      member_token: "0x06000001",
      member_kind: "method",
      member_name: null,
      import_name: "MessageBoxW",
      import_scope_name: "user32.dll",
    },
  ]);
  expect(result.coverage).toMatchObject({
    state: "partial",
    issues: [
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: "metadata.#Strings",
      }),
    ],
  });
});
