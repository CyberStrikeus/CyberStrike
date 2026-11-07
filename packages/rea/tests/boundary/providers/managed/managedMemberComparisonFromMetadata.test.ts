import { readManagedPeLayout } from "../../../../src/dotnet/ManagedPeReader.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "../../../../src/dotnet/ManagedMetadataLayout.js";
import {
  buildManagedNestedTypeFixture,
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "../../../../src/dotnet/ManagedPe.fixture.js";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  compareManagedMembers,
  managedMemberComparisonResultSchema,
} from "../../../../src/domain/managed/managedMemberComparison.js";
import { managedMemberInspectionSchema } from "../../../../src/domain/managed/managedArtifact.js";
import { inspectManagedMembersBytes } from "../../../../src/dotnet/ManagedMemberInspector.js";

import { buildManagedPeFixture as buildMultiMethodFixture } from "../../../../scripts/fixtures/managed/pe.mjs";
import {
  distinctSelectedNestedOwners,
  namespaceBearingNestedTypes,
} from "../../../fixtures/managedSelectedScope.js";

it("selects namespace-bearing nested declarations from parsed type facts and compares the observed scope", () => {
  const bytes = namespaceBearingNestedTypes();
  const selected = inspect(bytes, "/fixture/nested-selection.dll", ["Inner"]);
  expect(selected.result.selection?.unmatched_type_names).toEqual([]);
  expect(selected.result.types.map(({ token }) => token)).toEqual([
    "0x02000004",
    "0x02000005",
  ]);
  expect(selected.result.methods).toHaveLength(2);
  expect(selected.result.fields).toHaveLength(2);
  const comparison = compareManagedMembers(selected, selected);
  expect(
    comparison.methods.every(({ match }) => match.status === "matched"),
  ).toBe(true);
  expect(comparison.summary).toMatchObject({ added: 0, removed: 0 });
  expect(
    inspect(bytes, "/fixture/nested-qualified.dll", [
      "Fixture.Inner",
    ]).result.types.map(({ token }) => token),
  ).toEqual(["0x02000004"]);
  const topLevel = buildManagedNestedTypeFixture({ topLevelTypes: true });
  const topPe = readManagedPeLayout(topLevel);
  if (topPe.cli === null) throw new Error("Missing top-level fixture CLI");
  const topLayout = readManagedMetadataLayout(
    topLevel,
    topPe.rvaToOffset(
      topPe.cli.metadata.rva,
      topPe.cli.metadata.size,
      "fixture",
    ),
    topPe.cli.metadata.size,
  );
  const column = 4 + topLayout.stringIndexSize;
  topLevel.writeUInt16LE(
    topLevel.readUInt16LE(metadataRowOffset(topLayout, 2, 2) + column),
    metadataRowOffset(topLayout, 2, 4) + column,
  );
  expect(
    inspect(topLevel, "/fixture/top-level.dll", ["Inner"]).result.types,
  ).toEqual([]);
});

describe("managed comparison selected nominal membership", () => {
  it("retains known selected pairs in a partial inventory without needing display labels", () => {
    const source = inspect(
      distinctSelectedNestedOwners().left,
      "/fixture/known.dll",
      ["Fixture.Inner"],
    );
    const partial = structuredClone(source.result);
    partial.metadata.status = "partial";
    partial.coverage.state = "partial";
    partial.methods = partial.methods.map((method) => ({
      ...method,
      declaring_type: null,
    }));
    partial.fields = partial.fields.map((field) => ({
      ...field,
      declaring_type: null,
    }));
    const comparison = compareManagedMembers(source, {
      ...source,
      result: partial,
    });
    expect(comparison.coverage.status).toBe("partial");
    expect(comparison.summary).toEqual({
      added: 0,
      removed: 0,
      unknown: 0,
      changed: 0,
      unchanged: 2,
    });
    expect(
      [...comparison.methods, ...comparison.fields].every(
        ({ match, right }) =>
          match.status === "matched" && right?.declaring_type === null,
      ),
    ).toBe(true);
  });

  it.each(["current", "historical"])(
    "does not recover missing %s selected identity from display names",
    (kind) => {
      const source = inspect(
        distinctSelectedNestedOwners().left,
        "/fixture/selected.dll",
        ["Fixture.Inner"],
      );
      const unknown = structuredClone(source.result);
      unknown.types = unknown.types.map((type) => ({
        ...type,
        name_sha256: null,
      }));
      if (kind === "historical") unknown.nesting_read = null;
      const comparison = compareManagedMembers(source, {
        ...source,
        result: unknown,
      });
      expect(comparison.summary).toEqual({
        added: 0,
        removed: 0,
        unknown: 4,
        changed: 0,
        unchanged: 0,
      });
      expect(comparison.matching.unmatched).toBe(4);
      expect(comparison.coverage.status).toBe("partial");
    },
  );

  it("keeps one-sided members unknown when distinct selected owners share a display name", () => {
    const bytes = distinctSelectedNestedOwners();
    const left = inspect(bytes.left, "/fixture/left.dll", ["Fixture.Inner"]);
    const right = inspect(bytes.right, "/fixture/right.dll", ["Fixture.Inner"]);
    expect(left.result.coverage.state).toBe("complete");
    expect(right.result.coverage.state).toBe("complete");
    expect(left.result.types[0]?.full_name).toBe("Fixture.Inner");
    expect(right.result.types[0]?.full_name).toBe("Fixture.Inner");
    expect(left.result.types[0]?.name_sha256).not.toBe(
      right.result.types[0]?.name_sha256,
    );
    const selected = compareManagedMembers(left, right);
    expect(selected.coverage.status).toBe("partial");
    expect(selected.summary).toEqual({
      added: 0,
      removed: 0,
      unknown: 4,
      changed: 0,
      unchanged: 0,
    });
    expect(selected.matching.unmatched).toBe(4);
    expect(selected.methods).toHaveLength(2);
    expect(selected.fields).toHaveLength(2);
    const whole = compareManagedMembers(
      inspect(bytes.left, "/fixture/left.dll"),
      inspect(bytes.right, "/fixture/right.dll"),
    );
    expect(whole.coverage.status).toBe("complete-within-inputs");
    expect(whole.summary).toMatchObject({ added: 5, removed: 5, unknown: 0 });
  });
});

describe("managed comparison selected scope agreement", () => {
  it("compares retained types rather than equivalent request spellings", () => {
    const bytes = namespaceBearingNestedTypes();
    const bare = inspect(bytes, "/fixture/bare.dll", ["Inner"]);
    const explicit = inspect(bytes, "/fixture/explicit.dll", [
      "Inner",
      "Fixture.Inner",
    ]);
    expect(explicit.result.types).toEqual(bare.result.types);
    expect(explicit.result.selection).not.toEqual(bare.result.selection);
    const comparison = compareManagedMembers(bare, explicit);
    expect(comparison.coverage.status).toBe("complete-within-inputs");
    expect(comparison.limitations).toContain(
      "Both observations cover only the selected declaring types (Fixture.Inner, Inner); member totals and statuses describe those types, not the whole assembly.",
    );
  });

  it("distinguishes selected nested owners with identical request and display names", () => {
    const observe = (swapEnclosing: boolean) =>
      inspect(
        buildManagedNestedTypeFixture({
          swapEnclosing,
          literalTopLevelName: "OtherInner",
        }),
        `/fixture/owner-${String(swapEnclosing)}.dll`,
        ["Inner"],
      );
    const left = observe(false);
    const right = observe(true);
    expect(left.result.selection).toEqual(right.result.selection);
    expect(left.result.types.map(({ full_name }) => full_name)).toEqual([
      "Inner",
    ]);
    expect(right.result.types.map(({ full_name }) => full_name)).toEqual([
      "Inner",
    ]);
    expect(left.result.types[0]?.name_sha256).not.toBe(
      right.result.types[0]?.name_sha256,
    );
    const comparison = compareManagedMembers(left, right);
    expect(comparison.coverage.status).toBe("partial");
    expect(comparison.summary).toEqual({
      added: 0,
      removed: 0,
      unknown: 4,
      changed: 0,
      unchanged: 0,
    });
    expect(comparison.matching.unmatched).toBe(4);
    expect(comparison.limitations).toContain(
      "The observations select different declaring types; a member outside the other side's selection is unknown, not added or removed.",
    );
  });

  it.each(["historical identities", "partial prefix", "unavailable"])(
    "keeps selected scope agreement unknown for %s",
    (condition) => {
      const source = inspect(
        namespaceBearingNestedTypes(),
        "/fixture/scope.dll",
        ["Inner"],
      );
      const limited = structuredClone(source.result);
      if (condition === "historical identities")
        limited.types = limited.types.map((type) => ({
          ...type,
          name_sha256: null,
        }));
      else {
        limited.metadata.status =
          condition === "unavailable" ? "malformed" : "partial";
        limited.coverage.state =
          condition === "unavailable" ? "unavailable" : "partial";
        limited.types = limited.types.slice(
          0,
          condition === "unavailable" ? 0 : 1,
        );
      }
      const comparison = compareManagedMembers(source, {
        ...source,
        result: limited,
      });
      expect(comparison.coverage.status).toBe("partial");
      expect(comparison.limitations).toContainEqual(
        expect.stringContaining(
          "Selected declaring-type scope agreement is unknown",
        ),
      );
      expect(comparison.limitations).not.toContain(
        "The observations select different declaring types; a member outside the other side's selection is unknown, not added or removed.",
      );
    },
  );

  it("recognizes complete empty selected scopes despite different unmatched requests", () => {
    const bytes = buildManagedPeFixture();
    const left = inspect(bytes, "/fixture/empty-left.dll", ["Absent.Left"]);
    const right = inspect(bytes, "/fixture/empty-right.dll", ["Absent.Right"]);
    expect(left.result.types).toEqual([]);
    expect(right.result.types).toEqual([]);
    expect(left.result.selection?.unmatched_type_names).toEqual([
      "Absent.Left",
    ]);
    expect(right.result.selection?.unmatched_type_names).toEqual([
      "Absent.Right",
    ]);
    const comparison = compareManagedMembers(left, right);
    expect(comparison.coverage.status).toBe("complete-within-inputs");
    expect(comparison.limitations).toContain(
      "Both observations select no observed declaring types; requested and unmatched names remain in each source selection.",
    );
  });
});

describe("managed comparison method row coverage", () => {
  it("keeps paged omissions unknown while preserving full and equal-page controls", () => {
    const bytes = buildMultiMethodFixture({
      methods: [
        { name: "First", body: Buffer.from([0x2a]) },
        { name: "Second", body: Buffer.from([0x2a]) },
        { name: "Third", body: Buffer.from([0x2a]) },
      ],
    });
    const target = managedPeFixtureTarget(bytes);
    const observe = (offset: number, limit: number) => ({
      evidenceId: `ev_${target.sha256}`,
      result: inspectManagedMembersBytes(bytes, target, {
        methodOffset: offset,
        methodLimit: limit,
      }),
    });
    const full = observe(0, 3);
    const middle = observe(1, 1);
    expect(middle.result.method_rows).toEqual({
      offset: 1,
      count: 1,
      total: 3,
    });
    const limited = compareManagedMembers(full, middle);
    expect(limited.summary).toMatchObject({
      removed: 0,
      added: 0,
      unknown: 2,
      unchanged: 2,
    });
    expect(limited.coverage.status).toBe("partial");
    expect(compareManagedMembers(full, full).summary).toMatchObject({
      unchanged: 4,
      unknown: 0,
    });
    expect(compareManagedMembers(full, full).coverage.status).toBe(
      "complete-within-inputs",
    );
    expect(compareManagedMembers(middle, middle).coverage.status).toBe(
      "complete-within-inputs",
    );
    const overlapping = compareManagedMembers(observe(0, 2), observe(1, 2));
    expect(overlapping.summary).toMatchObject({
      added: 0,
      removed: 0,
      unchanged: 2,
      unknown: 2,
    });
    expect(compareManagedMembers(observe(0, 1), middle).summary).toMatchObject({
      added: 0,
      removed: 0,
      unknown: 2,
    });
    const selected = {
      ...middle,
      result: inspectManagedMembersBytes(bytes, target, {
        typeNames: [full.result.types[0]!.full_name],
        methodOffset: 1,
        methodLimit: 1,
      }),
    };
    expect(compareManagedMembers(full, selected).summary.removed).toBe(0);
    const historical = {
      ...full,
      result: managedMemberInspectionSchema.parse({
        ...full.result,
        method_rows: undefined,
      }),
    };
    expect(compareManagedMembers(historical, middle).summary.removed).toBe(0);
  });
});

const observeEdgeTarget = (
  options: Parameters<typeof buildManagedPeFixture>[0] = {},
) =>
  inspect(
    buildManagedPeFixture({
      targetFramework: null,
      memberRefName: "Ping",
      memberRefSignature: Buffer.from([0, 0, 1]),
      memberRefParentRaw: 25,
      ilBody: Buffer.from([0x1a, 0x28, 1, 0, 0, 0x0a, 0x2a]),
      typeReferences: [
        { namespace: "Fixture", name: "Outer" },
        { namespace: "", name: "Inner", enclosingRow: 2 },
      ],
      ...options,
    }),
    "/fixture/edges.dll",
  );

describe("managed edge nominal identity", () => {
  it("detects an enclosing TypeRef change even when display labels and tokens are equal", () => {
    const left = observeEdgeTarget();
    const right = observeEdgeTarget({
      typeReferences: [
        { namespace: "Fixture", name: "OtherOuter" },
        { namespace: "", name: "Inner", enclosingRow: 2 },
      ],
    });
    expect(left.result.call_edges[0]?.target_declaring_type).toBe(
      right.result.call_edges[0]?.target_declaring_type,
    );
    expect(compareManagedMembers(left, right).methods[0]).toMatchObject({
      status: "changed",
      dimensions: ["call-target"],
    });
    expect(compareManagedMembers(left, left).methods[0]?.status).toBe(
      "unchanged",
    );
  });

  it("compares the decoded MemberRef signature for calls and field accesses", () => {
    expect(
      compareManagedMembers(
        observeEdgeTarget(),
        observeEdgeTarget({ memberRefSignature: Buffer.from([0, 1, 1, 8]) }),
      ).methods[0],
    ).toMatchObject({ status: "changed", dimensions: ["call-target"] });
    const field = (type: number) =>
      observeEdgeTarget({
        memberRefName: "Value",
        memberRefSignature: Buffer.from([6, type]),
        ilBody: Buffer.from([0x1a, 0x7e, 1, 0, 0, 0x0a, 0x2a]),
      });
    expect(
      compareManagedMembers(field(8), field(0x0a)).methods[0],
    ).toMatchObject({ status: "changed", dimensions: ["field-target"] });
  });
});

describe("managed edge instruction sites", () => {
  it("joins repeated calls by IL offset even when edge arrays are reordered", () => {
    const source = observeEdgeTarget({
      ilBody: Buffer.from([
        0x2e, 0x28, 1, 0, 0, 0x0a, 0x28, 1, 0, 0, 0x0a, 0x2a,
      ]),
    });
    expect(source.result.call_edges.map((edge) => edge.il_offset)).toEqual([
      0, 5,
    ]);
    const reordered = {
      ...source,
      result: {
        ...source.result,
        call_edges: [...source.result.call_edges].reverse(),
      },
    };
    expect(compareManagedMembers(source, reordered).methods[0]?.status).toBe(
      "unchanged",
    );
  });

  it.each(["method", "field"] as const)(
    "keeps a known %s target change beside an omitted edge",
    (kind) => {
      const opcode = kind === "method" ? 0x28 : 0x7e;
      const args = {
        ilBody: Buffer.from([
          0x2e,
          opcode,
          1,
          0,
          0,
          0x0a,
          opcode,
          1,
          0,
          0,
          0x0a,
          0x2a,
        ]),
        memberRefSignature:
          kind === "method" ? Buffer.from([0, 0, 1]) : Buffer.from([6, 8]),
      };
      const left = observeEdgeTarget(args);
      const right = observeEdgeTarget({ ...args, memberRefName: "Changed" });
      const partial = {
        ...right,
        result: {
          ...right.result,
          ...(kind === "method"
            ? { call_edges: right.result.call_edges.slice(0, 1) }
            : { field_accesses: right.result.field_accesses.slice(0, 1) }),
        },
      };
      expect(compareManagedMembers(left, partial).methods[0]).toMatchObject({
        status: "changed",
        dimensions: expect.arrayContaining([
          kind === "method" ? "call-target" : "field-target",
          "availability",
        ]),
      });
    },
  );
});

describe("managed edge identity resolution", () => {
  it("compares validated MethodSpec base identities and resolved generic arguments", () => {
    const options = {
      memberRefSignature: Buffer.from([0x10, 1, 0, 1]),
      methodSpecMethods: [3],
      methodSpecInstantiation: Buffer.from([0x0a, 1, 8]),
      ilBody: Buffer.from([0x1a, 0x28, 1, 0, 0, 0x2b, 0x2a]),
    };
    const source = observeEdgeTarget(options);
    expect(compareManagedMembers(source, source).methods[0]?.status).toBe(
      "unchanged",
    );
    const changedArgument = observeEdgeTarget({
      ...options,
      methodSpecInstantiation: Buffer.from([0x0a, 1, 0x0a]),
    });
    const changedBase = observeEdgeTarget({
      ...options,
      memberRefName: "OtherGeneric",
    });
    for (const changed of [changedArgument, changedBase])
      expect(compareManagedMembers(source, changed).methods[0]).toMatchObject({
        status: "changed",
        dimensions: ["call-target"],
      });
  });

  it("retains unknown identity for cyclic scope, TypeSpec and historical edges", () => {
    const cyclic = observeEdgeTarget({
      typeReferences: [
        { namespace: "Fixture", name: "Outer", enclosingRow: 3 },
        { namespace: "", name: "Inner", enclosingRow: 2 },
      ],
    });
    expect(compareManagedMembers(cyclic, cyclic).methods[0]?.status).toBe(
      "unknown",
    );
    const spec = observeEdgeTarget({
      memberRefParentRaw: 12,
      typeSpecSignatures: [Buffer.from([0x15, 0x12, 9, 1, 8])],
    });
    expect(compareManagedMembers(spec, spec).methods[0]?.status).toBe(
      "unknown",
    );
    const source = observeEdgeTarget();
    const historical = {
      ...source,
      result: managedMemberInspectionSchema.parse({
        ...source.result,
        call_edges: source.result.call_edges.map(
          ({
            il_offset: _offset,
            target_identity_sha256: _identity,
            ...edge
          }) => edge,
        ),
      }),
    };
    expect(compareManagedMembers(source, historical).methods[0]?.status).toBe(
      "unknown",
    );
  });
});

describe("managed operand-free instruction structural matching", () => {
  it("preserves operand-free opcode order when remapping renamed methods", () => {
    const observe = (
      methodName: string,
      fieldToken: number,
      swapImplicitConstants: boolean,
      path: string,
    ) => {
      const il = Buffer.from([
        0x7b,
        0,
        0,
        0,
        0, // ldfld token
        0x26, // pop
        swapImplicitConstants ? 0x18 : 0x17, // ldc.i4.1 or ldc.i4.2
        0x26, // pop
        swapImplicitConstants ? 0x17 : 0x18, // the other implicit constant
        0x26, // pop
        0x2a, // ret
      ]);
      il.writeUInt32LE(fieldToken, 1);
      return inspect(
        buildManagedPeFixture({
          methodName,
          ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
        }),
        path,
      );
    };
    const left = observe(
      "OldMethod",
      0x04000001,
      false,
      "/tmp/implicit-order-left.dll",
    );
    const sameOrder = observe(
      "NewMethod",
      0x04000002,
      false,
      "/tmp/implicit-order-same.dll",
    );
    const swapped = observe(
      "NewMethod",
      0x04000002,
      true,
      "/tmp/implicit-order-swapped.dll",
    );

    expect(left.result.methods[0]?.body.opcode_counts).toEqual(
      swapped.result.methods[0]?.body.opcode_counts,
    );
    expect(left.result.methods[0]?.body.il_sha256).not.toBe(
      sameOrder.result.methods[0]?.body.il_sha256,
    );
    expect(left.result.methods[0]?.body.il_sha256).not.toBe(
      swapped.result.methods[0]?.body.il_sha256,
    );
    const sameOrderComparison = compareManagedMembers(left, sameOrder);
    expect(sameOrderComparison.methods).toContainEqual(
      expect.objectContaining({
        status: "changed",
        match: expect.objectContaining({
          status: "matched",
          basis: "structural-method-shape",
        }),
      }),
    );

    const swappedComparison = compareManagedMembers(left, swapped);
    expect(swappedComparison.methods.map(({ status }) => status)).toEqual([
      "removed",
      "added",
    ]);
    expect(
      swappedComparison.methods.some(
        ({ match }) => match.basis === "structural-method-shape",
      ),
    ).toBe(false);
    expect(
      left.result.methods[0]?.body.anchors.map(({ opcode }) => opcode),
    ).toEqual(["ldfld", "pop", "ldc.i4.1", "pop", "ldc.i4.2", "pop", "ret"]);
    expect(
      swapped.result.methods[0]?.body.anchors.map(({ opcode }) => opcode),
    ).toEqual(["ldfld", "pop", "ldc.i4.2", "pop", "ldc.i4.1", "pop", "ret"]);
  });
});

describe("managed reference instruction comparison", () => {
  it("does not count ldtoken MemberRefs as calls or field accesses", () => {
    const observe = (signature: readonly number[], path: string) => {
      const il = Buffer.from([0xd0, 1, 0, 0, 0x0a, 0x26, 0x2a]);
      return inspect(
        buildManagedPeFixture({
          targetFramework: null,
          memberRefName: "Counter",
          memberRefParentRaw: 8,
          ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
          memberRefSignature: Buffer.from(signature),
        }),
        path,
      );
    };
    const methodHandle = observe(
      [0x20, 0x01, 0x01, 0x0e],
      "/tmp/ldtoken-method-handle.dll",
    );
    const fieldHandle = observe([0x06, 0x08], "/tmp/ldtoken-field-handle.dll");

    expect(methodHandle.result.methods[0]?.body.anchors[0]).toMatchObject({
      opcode: "ldtoken",
      operand_kind: "method",
    });
    expect(fieldHandle.result.methods[0]?.body.anchors[0]).toMatchObject({
      opcode: "ldtoken",
      operand_kind: "field",
    });
    expect(methodHandle.result.call_edges).toEqual([]);
    expect(fieldHandle.result.call_edges).toEqual([]);
    expect(methodHandle.result.field_accesses).toEqual([]);
    expect(fieldHandle.result.field_accesses).toEqual([]);

    const comparison = compareManagedMembers(methodHandle, fieldHandle);
    const dimensions = comparison.methods[0]?.dimensions ?? [];
    expect(dimensions).not.toContain("call-shape");
    expect(dimensions).not.toContain("field-shape");
    expect(dimensions).not.toContain("call-target");
  });
});

describe("managed field target comparison", () => {
  it("compares observed field targets for aligned field instructions", () => {
    const il = Buffer.from([0x7b, 1, 0, 0, 4, 0x26, 0x2a]);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
    });
    const base = inspect(bytes, "/tmp/field-target-base.dll");
    const counterpart = inspect(bytes, "/tmp/field-target-counterpart.dll");
    const changedTarget = inspect(
      buildManagedPeFixture({
        fieldName: "differentField",
        ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
      }),
      "/tmp/field-target-changed.dll",
    );

    const comparison = compareManagedMembers(base, changedTarget);
    expect(comparison.methods[0]).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["field-target"]),
    });

    const unavailableTarget = {
      ...counterpart,
      result: managedMemberInspectionSchema.parse({
        ...counterpart.result,
        field_accesses: counterpart.result.field_accesses.map((access) => ({
          ...access,
          target_identity_sha256: null,
          field_name: null,
          field_declaring_type: null,
        })),
      }),
    };
    expect(
      compareManagedMembers(base, unavailableTarget).methods[0],
    ).toMatchObject({
      status: "unknown",
      dimensions: expect.arrayContaining(["availability"]),
    });
  });
});

describe("managed exception target comparison", () => {
  it("compares resolved catch names without comparing build-local tokens", () => {
    const bytes = buildManagedPeFixture({ ilBody: Buffer.from([0x06, 0x2a]) });
    const base = inspect(bytes, "/tmp/catch-target-base.dll");
    const counterpart = inspect(bytes, "/tmp/catch-target-counterpart.dll");
    const withCatch = (
      source: typeof base,
      token: string,
      classType: string | null,
      identityResolved = true,
    ) => ({
      ...source,
      result: managedMemberInspectionSchema.parse({
        ...source.result,
        methods: source.result.methods.map((method) => ({
          ...method,
          body: {
            ...method.body,
            exception_regions: [
              {
                flags: 0,
                try_offset: 0,
                try_length: 1,
                handler_offset: 1,
                handler_length: 1,
                class_token: token,
                class_type: classType,
                class_type_name_sha256:
                  classType === null ? null : hash(Buffer.from(classType)),
                class_type_identity_resolved: identityResolved,
                filter_offset: null,
              },
            ],
          },
        })),
      }),
    });
    const sameType = compareManagedMembers(
      withCatch(base, "0x02000001", "Fixture.Error"),
      withCatch(counterpart, "0x02000002", "Fixture.Error"),
    );
    expect(sameType.methods[0]).toMatchObject({ status: "unchanged" });
    expect(sameType.methods[0]?.dimensions).not.toContain("exception-shape");
    expect(sameType.methods[0]?.dimensions).not.toContain("exception-target");

    const changedType = compareManagedMembers(
      withCatch(base, "0x02000001", "Fixture.Error"),
      withCatch(counterpart, "0x02000001", "Fixture.OtherError"),
    );
    expect(changedType.methods[0]).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["exception-target"]),
    });

    const differentNamesWithUnresolvedScope = compareManagedMembers(
      withCatch(base, "0x01000001", "Fixture.Error", false),
      withCatch(counterpart, "0x01000002", "Fixture.OtherError", false),
    );
    expect(differentNamesWithUnresolvedScope.methods[0]).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["exception-target", "availability"]),
    });

    const unresolved = compareManagedMembers(
      withCatch(base, "0x02000001", "Fixture.Error"),
      withCatch(counterpart, "0x01000002", "Fixture.Error", false),
    );
    expect(unresolved.methods[0]).toMatchObject({ status: "unknown" });

    const missingDisplay = compareManagedMembers(
      withCatch(base, "0x02000001", null),
      withCatch(counterpart, "0x02000002", "Fixture.Error"),
    );
    expect(missingDisplay.methods[0]).toMatchObject({ status: "unknown" });
  });

  it("keeps equal TypeRef catch names unknown when valid AssemblyRef scopes differ", () => {
    const catchMethodBody = () => {
      const header = Buffer.alloc(12);
      header.writeUInt16LE(0x300b, 0);
      header.writeUInt16LE(8, 2);
      header.writeUInt32LE(1, 4);
      const section = Buffer.alloc(16);
      section[0] = 0x01;
      section[1] = section.length;
      section.writeUInt16LE(0, 4);
      section.writeUInt16LE(0, 6);
      section[8] = 1;
      section.writeUInt16LE(0, 9);
      section[11] = 1;
      section.writeUInt32LE(0x0100_0001, 12);
      return Buffer.concat([
        header,
        Buffer.from([0x2a]),
        Buffer.alloc(3),
        section,
      ]);
    };
    const observe = (scope: number, path: string) =>
      inspect(
        buildManagedPeFixture({
          ilBody: catchMethodBody(),
          references: ["Scope.One", "Scope.Two"],
          typeRefScopeRaw: scope,
        }),
        path,
      );
    const left = observe((1 << 2) | 2, "/tmp/catch-scope-one.dll");
    const right = observe((2 << 2) | 2, "/tmp/catch-scope-two.dll");

    expect(left.result.methods[0]?.body.exception_regions[0]).toMatchObject({
      class_token: "0x01000001",
      class_type: "System.Runtime.Versioning.TargetFrameworkAttribute",
      class_type_identity_resolved: false,
    });
    expect(right.result.methods[0]?.body.exception_regions[0]).toMatchObject({
      class_type: "System.Runtime.Versioning.TargetFrameworkAttribute",
      class_type_identity_resolved: false,
    });
    expect(compareManagedMembers(left, right).methods[0]).toMatchObject({
      status: "unknown",
      dimensions: expect.arrayContaining(["availability"]),
    });
  });
});

describe("managed exception target scoped identity", () => {
  it("compares catch TypeDef nesting and assembly scope separately", () => {
    const catchBody = () => {
      const header = Buffer.alloc(12);
      header.writeUInt16LE(0x300b, 0);
      header.writeUInt16LE(8, 2);
      header.writeUInt32LE(1, 4);
      const section = Buffer.alloc(16);
      section[0] = 0x01;
      section[1] = section.length;
      section[8] = 0;
      section.writeUInt16LE(0, 9);
      section[11] = 1;
      section.writeUInt32LE(0x0200_0002, 12);
      return Buffer.concat([
        header,
        Buffer.from([0x2a]),
        Buffer.alloc(3),
        section,
      ]);
    };
    const observe = (
      path: string,
      options: Parameters<typeof buildManagedPeFixture>[0],
    ) =>
      inspect(buildManagedPeFixture({ ilBody: catchBody(), ...options }), path);
    const topLevelOuter = observe("/tmp/catch-nested-base.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [[2, 1]],
    });
    const nestedOuter = observe("/tmp/catch-nested-parent-change.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [
        [1, 3],
        [2, 1],
      ],
    });
    const otherAssembly = observe("/tmp/catch-nested-other-assembly.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [[2, 1]],
      assemblyName: "Fixture.Other",
    });
    const differentJitFlags = observe("/tmp/catch-nested-jit-flags.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [[2, 1]],
      assemblyFlags: 0x0000_4000,
    });
    const retargetableAssembly = observe("/tmp/catch-nested-retargetable.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [[2, 1]],
      assemblyFlags: 0x0000_0100,
    });
    const noAssembly = observe("/tmp/catch-nested-no-assembly.dll", {
      typeName: "Outer",
      typeNamespace: "Game",
      additionalEmptyTypes: 2,
      nestedTypes: [[2, 1]],
      assemblyRowCount: 0,
    });
    expect(differentJitFlags.result.assembly).toMatchObject({
      flags: 0x4000,
      hash_algorithm: 0x8004,
    });
    expect(retargetableAssembly.result.assembly?.flags).toBe(0x100);
    const baseRegion =
      topLevelOuter.result.methods[0]?.body.exception_regions[0];
    const nestedRegion =
      nestedOuter.result.methods[0]?.body.exception_regions[0];
    expect(baseRegion?.class_type).toBe(nestedRegion?.class_type);
    expect(baseRegion?.class_type_name_sha256).not.toBe(
      nestedRegion?.class_type_name_sha256,
    );
    expect(
      compareManagedMembers(topLevelOuter, nestedOuter).methods[0],
    ).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["exception-target"]),
    });
    expect(
      compareManagedMembers(topLevelOuter, otherAssembly).methods[0],
    ).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["exception-target"]),
    });
    expect(
      compareManagedMembers(topLevelOuter, differentJitFlags).methods[0],
    ).toMatchObject({ status: "unchanged" });
    expect(
      compareManagedMembers(topLevelOuter, retargetableAssembly).methods[0],
    ).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["exception-target"]),
    });
    expect(
      compareManagedMembers(topLevelOuter, noAssembly).methods[0],
    ).toMatchObject({
      status: "unknown",
      dimensions: expect.arrayContaining(["availability"]),
    });
  });
});

describe("managed member structural matching", () => {
  it("keeps unequal constants from becoming a structural remap", () => {
    const observe = (
      typeName: string,
      methodName: string,
      constant: number,
      branchOffset: number,
    ) =>
      inspect(
        buildManagedPeFixture({
          typeName,
          methodName,
          ilBody: Buffer.from([
            0x1e,
            0x1f,
            constant,
            0x26,
            0x2b,
            branchOffset,
            0x00,
            0x2a,
          ]),
        }),
        `/tmp/${typeName}-${constant}.dll`,
      );
    const left = observe("OldType", "OldMethod", 5, 1);
    const differentConstant = observe("NewType", "NewMethod", 7, 1);
    const sameConstant = observe("NewType", "NewMethod", 5, 0);
    for (const [observed, constant] of [
      [left, 5],
      [differentConstant, 7],
      [sameConstant, 5],
    ] as const) {
      expect(observed.result.methods[0]?.body).toMatchObject({
        status: "present",
        normalized_il_sha256: expect.any(String),
        anchors: expect.arrayContaining([
          expect.objectContaining({
            operand_kind: "constant",
            operand: String(constant),
          }),
        ]),
      });
    }

    const different = compareManagedMembers(left, differentConstant);
    expect(different.methods.map(({ status }) => status)).toEqual([
      "removed",
      "added",
    ]);
    expect(
      different.methods.some(
        ({ match }) => match.basis === "structural-method-shape",
      ),
    ).toBe(false);

    expect(compareManagedMembers(left, sameConstant).methods).toContainEqual(
      expect.objectContaining({
        status: "changed",
        match: expect.objectContaining({
          status: "matched",
          basis: "structural-method-shape",
          confidence: "high",
        }),
      }),
    );
  });
});

describe("managed LocalVarSig comparison", () => {
  const observe = (signature: Buffer, path: string, maxStack = 8) => {
    const body = Buffer.alloc(13);
    body.writeUInt16LE(0x3003, 0);
    body.writeUInt16LE(maxStack, 2);
    body.writeUInt32LE(1, 4);
    body.writeUInt32LE(0x11000001, 8);
    body[12] = 0x2a;
    return inspect(
      buildManagedPeFixture({
        ilBody: body,
        standaloneSignatures: [signature],
        mvid: createHash("md5").update(path).digest(),
      }),
      path,
    );
  };

  it("retains changed validated primitive local signature bytes with identical CIL", () => {
    const left = observe(
      Buffer.from([0x07, 0x01, 0x08]),
      "/fixture/locals-int32.dll",
    );
    const right = observe(
      Buffer.from([0x07, 0x01, 0x0a]),
      "/fixture/locals-int64.dll",
    );
    expect(left.result.coverage).toMatchObject({
      state: "complete",
      issues: [],
    });
    expect(right.result.coverage).toMatchObject({
      state: "complete",
      issues: [],
    });
    expect(left.result.methods[0]?.body).toMatchObject({
      status: "present",
      local_var_sig_token: "0x11000001",
      local_var_signature: { has_context_dependent_types: false },
      il_sha256: right.result.methods[0]?.body.il_sha256,
      normalized_il_sha256: right.result.methods[0]?.body.normalized_il_sha256,
    });
    const result = managedMemberComparisonResultSchema.parse(
      compareManagedMembers(left, right),
    );
    expect(result.methods[0]).toMatchObject({
      status: "changed",
      dimensions: ["metadata"],
      match: { basis: "exact-il-signature" },
      limitations: [expect.stringContaining("encoding difference")],
    });
  });

  it.each([
    ["named type", [0x12, 0x04]],
    ["type variable", [0x13, 0x00]],
    ["method variable", [0x1e, 0x00]],
    ["custom modifier", [0x1f, 0x04, 0x08]],
  ] as const)(
    "keeps cross-artifact %s locals unknown while retaining observed header changes",
    (_name, type) => {
      const signature = Buffer.from([0x07, 0x01, ...type]);
      const left = observe(signature, "/fixture/locals-context-left.dll");
      const right = observe(signature, "/fixture/locals-context-right.dll", 16);
      expect(left.result.methods[0]?.body).toMatchObject({
        status: "present",
        local_var_signature: { has_context_dependent_types: true },
      });
      expect(compareManagedMembers(left, right).methods[0]).toMatchObject({
        status: "changed",
        dimensions: ["metadata", "availability"],
        limitations: [
          expect.stringContaining(
            "Local variable signature identity is unknown",
          ),
        ],
      });
      const sameHeader = observe(
        signature,
        "/fixture/locals-context-same-header.dll",
      );
      expect(compareManagedMembers(left, sameHeader).methods[0]).toMatchObject({
        status: "unknown",
        dimensions: ["availability"],
      });
      expect(compareManagedMembers(left, left).methods[0]).toMatchObject({
        status: "unchanged",
        dimensions: [],
      });
    },
  );

  it("preserves historical locals uncertainty across artifacts and byte identity within one artifact", () => {
    const left = observe(
      Buffer.from([0x07, 0x01, 0x08]),
      "/fixture/locals-current.dll",
    );
    const currentRight = observe(
      Buffer.from([0x07, 0x01, 0x0a]),
      "/fixture/locals-old.dll",
    );
    const historical = (side: typeof left) => ({
      ...side,
      result: managedMemberInspectionSchema.parse({
        ...side.result,
        methods: side.result.methods.map((method) => ({
          ...method,
          body: { ...method.body, local_var_signature: undefined },
        })),
      }),
    });
    expect(
      compareManagedMembers(left, historical(currentRight)).methods[0],
    ).toMatchObject({
      status: "unknown",
      dimensions: ["availability"],
    });
    expect(
      compareManagedMembers(left, historical(left)).methods[0],
    ).toMatchObject({
      status: "unchanged",
      dimensions: [],
    });
  });
});

describe("managed member comparison", () => {
  it.each([
    { label: "initialization flag", flags: 0x3013, maxStack: 8 },
    { label: "maximum stack", flags: 0x3003, maxStack: 16 },
  ])("retains a changed $label with identical CIL", ({ flags, maxStack }) => {
    const observe = (headerFlags: number, stack: number, path: string) => {
      const body = Buffer.alloc(13);
      body.writeUInt16LE(headerFlags, 0);
      body.writeUInt16LE(stack, 2);
      body.writeUInt32LE(1, 4);
      body[12] = 0x2a; // ret
      return inspect(buildManagedPeFixture({ ilBody: body }), path);
    };
    const left = observe(0x3003, 8, "/tmp/header-left.dll");
    const right = observe(flags, maxStack, "/tmp/header-right.dll");
    expect(left.result.methods[0]?.body).toMatchObject({
      status: "present",
      init_locals: false,
      max_stack: 8,
    });
    expect(right.result.methods[0]?.body).toMatchObject({
      status: "present",
      init_locals: (flags & 0x10) !== 0,
      max_stack: maxStack,
      il_sha256: left.result.methods[0]?.body.il_sha256,
      normalized_il_sha256: left.result.methods[0]?.body.normalized_il_sha256,
    });
    const comparison = managedMemberComparisonResultSchema.parse(
      compareManagedMembers(left, right),
    );
    expect(comparison.methods[0]).toMatchObject({
      status: "changed",
      match: { basis: "exact-il-signature", confidence: "exact" },
      dimensions: ["metadata"],
    });
    expect(comparison.summary).toMatchObject({ changed: 1, unchanged: 1 });
    expect(compareManagedMembers(left, left).methods[0]).toMatchObject({
      status: "unchanged",
      dimensions: [],
    });
  });

  it("remaps renamed methods by exact CIL while retaining field target changes", () => {
    const leftBytes = buildManagedPeFixture();
    const rightBytes = buildManagedPeFixture({
      mvid: Buffer.from("00112233445566778899aabbccddeefe", "hex"),
      typeName: "A",
      typeNamespace: "X",
      methodName: "b",
    });
    const left = inspect(leftBytes, "/tmp/left.dll");
    const right = inspect(rightBytes, "/tmp/right.dll");
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.algorithm.name_matching).toBe("exact-signature-fallback");
    expect(result.left.mvid).toBe("00112233-4455-6677-8899-aabbccddeeff");
    expect(result.right.mvid).toBe("33221100-5544-7766-8899-aabbccddeefe");
    expect(result.matching.exact_il_signature).toBe(1);
    expect(result.methods).toEqual([
      expect.objectContaining({
        status: "changed",
        left: expect.objectContaining({ token: "0x06000001", name: "Main" }),
        right: expect.objectContaining({ token: "0x06000001", name: "b" }),
        match: expect.objectContaining({
          status: "matched",
          basis: "exact-il-signature",
          confidence: "exact",
        }),
        dimensions: ["field-target"],
      }),
    ]);
    expect(result.limitations).toContain(
      "Methods pair within one declared type and name by exact CIL/signature, then signature, then structural shape; only then may exact CIL/signature or structural shape alone remap across declared types or names, never taking a member whose own declared type and name remain unpaired on the other side or whose declaring type is unresolved. Names alone are never a matching basis.",
    );
    expect(
      managedMemberComparisonResultSchema.safeParse({
        ...result,
        limitations: Array.from({ length: 101 }, () => "x".repeat(4_097)),
      }).success,
    ).toBe(true);
  });

  it("compares changed CIL after pairing by exact signature", () => {
    const leftBytes = buildManagedPeFixture();
    const rightBytes = buildManagedPeFixture({
      ilBody: Buffer.from([
        0x32, 0x02, 0x7b, 0x02, 0x00, 0x00, 0x04, 0x28, 0x02, 0x00, 0x00, 0x0a,
        0x2a,
      ]),
    });
    const left = inspect(leftBytes, "/tmp/left.dll");
    const right = inspect(rightBytes, "/tmp/right.dll");
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.matching.exact_il_signature).toBe(0);
    expect(result.matching.exact_signature).toBe(1);
    expect(right.result.call_edges[0]).toMatchObject({
      target_name: null,
      target_declaring_type: null,
    });
    expect(result.methods[0]).toMatchObject({
      status: "changed",
      match: { status: "matched", basis: "exact-signature" },
      dimensions: ["cil", "availability"],
    });
  });

  it("rejects member states that disagree with their observed sides or match", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left.dll");
    const right = inspect(buildManagedPeFixture(), "/tmp/right.dll");
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );
    const method = result.methods[0];
    expect(method).toBeDefined();
    if (method === undefined) return;

    expect(
      managedMemberComparisonResultSchema.safeParse({
        ...result,
        methods: [{ ...method, status: "unchanged", right: null }],
      }).success,
    ).toBe(false);
    expect(
      managedMemberComparisonResultSchema.safeParse({
        ...result,
        methods: [
          {
            ...method,
            match: {
              ...method.match,
              basis: "none",
              confidence: "unknown",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("managed member comparison with equal decoded fingerprints", () => {
  it.each([
    { name: "Main", basis: "exact-signature" },
    { name: "Renamed", basis: "structural-method-shape" },
  ])("detects reordered switch targets in $name", ({ name, basis }) => {
    const observe = (targets: readonly number[], methodName: string) => {
      // ldarg.0; switch (case 0, case 1); ldc.i4.0; ret; ldc.i4.1; ret.
      // Both cases target instruction starts, relative to the end of the table.
      const il = Buffer.alloc(18);
      il[0] = 0x02;
      il[1] = 0x45;
      il.writeUInt32LE(2, 2);
      targets.forEach((target, index) =>
        il.writeInt32LE(target, 6 + index * 4),
      );
      Buffer.from([0x16, 0x2a, 0x17, 0x2a]).copy(il, 14);
      return inspect(
        buildManagedPeFixture({
          methodName,
          methodSignature: Buffer.from([0x00, 0x01, 0x08, 0x08]),
          ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
        }),
        `/tmp/${methodName}-${targets.join("-")}.dll`,
      );
    };
    const left = observe([0, 2], "Main");
    const right = observe([2, 0], name);
    const leftBody = left.result.methods[0]?.body;
    const rightBody = right.result.methods[0]?.body;
    expect(leftBody?.status).toBe("present");
    expect(rightBody?.status).toBe("present");
    expect(leftBody?.normalized_il_sha256).toBe(
      rightBody?.normalized_il_sha256,
    );
    expect(leftBody?.il_sha256).not.toBe(rightBody?.il_sha256);

    const result = compareManagedMembers(left, right);
    expect(result.matching.exact_il_signature).toBe(0);
    expect(result.methods[0]).toMatchObject({
      status: "changed",
      match: { status: "matched", basis },
      dimensions: ["cil"],
    });
    expect(
      compareManagedMembers(right, observe([2, 0], name)).methods[0],
    ).toMatchObject({
      status: "unchanged",
      match: {
        status: "matched",
        basis: "exact-il-signature",
        confidence: "exact",
      },
      dimensions: [],
    });
  });
});

describe("managed member comparison floating-point constants", () => {
  it.each([
    {
      opcode: "ldc.r4",
      positive: "22000000002a",
      negative: "22000000802a",
      type: 0x0c,
    },
    {
      opcode: "ldc.r8",
      positive: "2300000000000000002a",
      negative: "2300000000000000802a",
      type: 0x0d,
    },
  ])(
    "detects a change from positive to negative zero in $opcode",
    ({ opcode, positive, negative, type }) => {
      const observe = (hex: string, path: string) => {
        const il = Buffer.from(hex, "hex");
        return inspect(
          buildManagedPeFixture({
            methodSignature: Buffer.from([0x00, 0x00, type]),
            ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
          }),
          path,
        );
      };
      const left = observe(positive, "/tmp/positive-zero.dll");
      const right = observe(negative, "/tmp/negative-zero.dll");
      const comparison = compareManagedMembers(left, right);

      expect(comparison.methods[0]).toMatchObject({
        status: "changed",
        match: { status: "matched", basis: "exact-signature" },
        dimensions: ["cil"],
      });
      for (const [observation, operand] of [
        [left, "0"],
        [right, "-0"],
      ] as const) {
        expect(observation.result.methods[0]?.body).toMatchObject({
          status: "present",
          anchors: [
            { il_offset: 0, opcode, operand_kind: "constant", operand },
            // ldc.r4 spans 5 bytes and ldc.r8 spans 9 before the ret.
            {
              il_offset: opcode === "ldc.r4" ? 5 : 9,
              opcode: "ret",
              operand_kind: "none",
              operand: null,
            },
          ],
        });
      }
      expect(left.result.methods[0]?.body.normalized_il_sha256).not.toBe(
        right.result.methods[0]?.body.normalized_il_sha256,
      );
      const repeated = observe(negative, "/tmp/negative-zero-copy.dll");
      expect(compareManagedMembers(right, repeated).methods[0]).toMatchObject({
        status: "unchanged",
        match: { status: "matched", basis: "exact-il-signature" },
        dimensions: [],
      });
    },
  );
});

describe("managed member comparison uncertainty", () => {
  it("does not infer a structural method match from undecoded signature fields", () => {
    const left = inspect(
      buildManagedPeFixture({ methodSignature: Buffer.from([0xff]) }),
      "/tmp/unknown-left.dll",
    );
    const right = inspect(
      buildManagedPeFixture({ methodSignature: Buffer.from([0xfe]) }),
      "/tmp/unknown-right.dll",
    );
    expect(left.result.methods[0]?.signature.parse_status).not.toBe("decoded");
    expect(right.result.methods[0]?.signature.parse_status).not.toBe("decoded");
    const result = compareManagedMembers(
      {
        evidenceId: left.evidenceId,
        result: {
          ...left.result,
          coverage: { ...left.result.coverage, state: "partial" },
        },
      },
      {
        evidenceId: right.evidenceId,
        result: {
          ...right.result,
          coverage: { ...right.result.coverage, state: "partial" },
        },
      },
    );
    expect(result.matching.structural_method_shape).toBe(0);
    expect(result.methods).toHaveLength(2);
    expect(
      result.methods.every(
        ({ status, match }) =>
          status === "unknown" && match.status === "unmatched",
      ),
    ).toBe(true);
  });

  it("keeps unmatched members unknown when opposite metadata is incomplete", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left-partial.dll");
    const right = inspect(buildManagedPeFixture(), "/tmp/right-partial.dll");
    const leftPartial = {
      ...left.result,
      fields: [],
      metadata: { ...left.result.metadata, status: "partial" as const },
      coverage: { ...left.result.coverage, state: "partial" as const },
    };
    const rightPartial = {
      ...right.result,
      methods: [],
      metadata: { ...right.result.metadata, status: "partial" as const },
      coverage: { ...right.result.coverage, state: "partial" as const },
    };
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: leftPartial },
      { evidenceId: right.evidenceId, result: rightPartial },
    );

    expect(result.summary).toMatchObject({
      added: 0,
      removed: 0,
      unknown: 2,
    });
    expect(result.methods[0]).toMatchObject({
      status: "unknown",
      left: { token: "0x06000001" },
      right: null,
      limitations: [
        expect.stringContaining("unknown-within-incomplete-metadata"),
      ],
    });
    expect(result.fields[0]).toMatchObject({
      status: "unknown",
      left: null,
      right: { token: "0x04000001" },
      limitations: [
        expect.stringContaining("unknown-within-incomplete-metadata"),
      ],
    });
    expect(result.coverage).toEqual({
      status: "partial",
      left_status: "partial",
      right_status: "partial",
    });
  });

  it("does not guess ambiguous field signature matches", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left.dll");
    const leftField = left.result.fields[0];
    expect(leftField).toBeDefined();
    if (leftField === undefined) return;
    const duplicatedLeft = {
      ...left.result,
      fields: [
        leftField,
        {
          ...leftField,
          token: "0x04000002",
          name: "other",
        },
      ],
    };
    const right = inspect(buildManagedPeFixture(), "/tmp/right.dll");
    const rightField = right.result.fields[0];
    expect(rightField).toBeDefined();
    if (rightField === undefined) return;
    // Both right fields are renamed, so neither left field keeps its declared
    // identity and only the shared signature links them.
    const duplicatedRight = {
      ...right.result,
      fields: [
        { ...rightField, name: "moved" },
        {
          ...rightField,
          token: "0x04000002",
          name: "renamed",
        },
      ],
    };
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: duplicatedLeft },
      { evidenceId: right.evidenceId, result: duplicatedRight },
    );

    expect(result.matching.ambiguous).toBe(1);
    expect(result.fields).toEqual([
      expect.objectContaining({
        status: "unknown",
        match: expect.objectContaining({
          status: "ambiguous",
          basis: "field-signature",
          candidate_left_tokens: ["0x04000001", "0x04000002"],
          candidate_right_tokens: ["0x04000001", "0x04000002"],
        }),
        limitations: [
          "Multiple managed fields share the same signature; REA did not guess a token remap.",
        ],
      }),
    ]);
  });
});

describe("managed member comparison beside user strings", () => {
  it("keeps member deltas and coverage when only #US literals are nonconforming", () => {
    // The method loads "ok", stored with flag 1 where ECMA-335 expects 0.
    const options = {
      ilBody: Buffer.from([(7 << 2) | 2, 0x72, 1, 0, 0, 0x70, 0x26, 0x2a]),
      userStringHeap: Buffer.from([0, 5, 0x6f, 0, 0x6b, 0, 1]),
    };
    const left = inspect(buildManagedPeFixture(options), "/tmp/left-us.dll");
    const right = inspect(buildManagedPeFixture(options), "/tmp/right-us.dll");
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: { ...left.result, fields: [] } },
      {
        evidenceId: right.evidenceId,
        result: { ...right.result, methods: [] },
      },
    );

    expect(left.result.metadata.status).toBe("complete");
    expect(left.result.coverage.state).toBe("complete");
    expect(left.result.user_strings?.state).toBe("partial");
    expect(result.summary).toMatchObject({ added: 1, removed: 1, unknown: 0 });
  });
});

it.each([
  ["wrong member kinds", [0x06, 0x08], [0x00, 0x00, 0x01]],
  ["empty blobs", [], []],
  ["truncated blobs", [0x00, 0x80], [0x06]],
  ["invalid headers", [0x08, 0x00, 0x08], [0x26, 0x08]],
] as const)(
  "keeps equal malformed %s unknown regardless of resolution attestation",
  (_label, methodBytes, fieldBytes) => {
    const side = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from(methodBytes),
        fieldSignature: Buffer.from(fieldBytes),
        ilBody: Buffer.from([0x06, 0x2a]),
      }),
      "/tmp/malformed-signatures.dll",
    );
    expect(side.result.methods[0]?.signature.parse_status).toBe("malformed");
    expect(side.result.fields[0]?.signature.parse_status).toBe("malformed");
    expect(side.result.coverage.state).toBe("partial");

    for (const signature_resolution of [
      side.result.signature_resolution,
      null,
    ]) {
      const observation = {
        ...side,
        result: { ...side.result, signature_resolution },
      };
      const comparison = compareManagedMembers(observation, observation);
      expect(comparison.coverage.status).toBe("partial");
      expect(comparison.summary).toMatchObject({
        unchanged: 0,
        changed: 0,
        added: 0,
        removed: 0,
        unknown: 2,
      });
      for (const item of [...comparison.methods, ...comparison.fields])
        expect(item).toMatchObject({
          status: "unknown",
          match: { status: "matched", confidence: "exact" },
          limitations: [expect.stringMatching(/^signature-malformed:/)],
        });
    }
  },
);

describe("managed member comparison of undecoded signatures", () => {
  it("remaps renamed methods only when raw signatures and complete normalized IL match", () => {
    const signature = Buffer.from([0x00, 0x00, 0x7f]);
    const left = inspect(
      buildManagedPeFixture({ methodSignature: signature }),
      "/tmp/undecoded-method-before.dll",
    );
    const renamed = inspect(
      buildManagedPeFixture({
        methodSignature: signature,
        methodName: "renamed",
      }),
      "/tmp/undecoded-method-renamed.dll",
    );
    expect(left.result.methods[0]?.signature.parse_status).toBe("unsupported");
    expect(renamed.result.metadata.status).toBe("complete");
    expect(renamed.result.coverage.state).toBe("partial");

    const exact = compareManagedMembers(left, renamed);
    expect(exact.methods).toEqual([
      expect.objectContaining({
        status: "unchanged",
        match: expect.objectContaining({
          status: "matched",
          basis: "exact-il-signature",
          confidence: "exact",
        }),
      }),
    ]);
    expect(exact.summary).toMatchObject({ added: 0, removed: 0, unknown: 0 });

    const changedRaw = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x7e]),
        methodName: "renamed",
      }),
      "/tmp/undecoded-method-raw-changed.dll",
    );
    const changedBody = inspect(
      buildManagedPeFixture({
        methodSignature: signature,
        methodName: "renamed",
        ilBody: Buffer.from([0x2a]),
      }),
      "/tmp/undecoded-method-il-changed.dll",
    );
    for (const negative of [changedRaw, changedBody]) {
      const result = compareManagedMembers(left, negative);
      expect(result.methods).toHaveLength(2);
      expect(
        result.methods.every((method) => method.match.status !== "matched"),
      ).toBe(true);
    }
  });

  it("pairs undecoded signatures by exact declared type, name, and raw bytes", () => {
    const undecoded = {
      methodSignature: Buffer.from([0x00, 0x00, 0x7f]),
      fieldSignature: Buffer.from([0x06, 0x7f]),
    };
    const left = inspect(
      buildManagedPeFixture(undecoded),
      "/tmp/undecoded-left.dll",
    );
    const right = inspect(
      buildManagedPeFixture(undecoded),
      "/tmp/undecoded-right.dll",
    );
    expect(left.result.metadata.status).toBe("complete");
    expect(left.result.coverage.state).toBe("partial");
    expect(left.result.methods[0]?.signature.parse_status).toBe("unsupported");
    expect(left.result.fields[0]?.signature.parse_status).toBe("unsupported");
    const result = compareManagedMembers(left, right);
    expect(result.summary).toMatchObject({
      unchanged: 1,
      added: 0,
      removed: 0,
      unknown: 1,
    });
    expect(result.methods[0]?.match).toMatchObject({
      status: "matched",
      basis: "exact-il-signature",
    });
    expect(result.fields[0]?.match).toMatchObject({
      status: "matched",
      basis: "exact-signature",
    });
  });

  it("keeps unmatched undecoded members unknown with complete metadata inventories", () => {
    const left = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x7f]),
        fieldSignature: Buffer.from([0x06, 0x7f]),
      }),
      "/tmp/undecoded-before.dll",
    );
    const right = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x7e]),
        fieldSignature: Buffer.from([0x06, 0x7e]),
      }),
      "/tmp/undecoded-after.dll",
    );
    expect(right.result.metadata.status).toBe("complete");
    expect(right.result.coverage.state).toBe("partial");
    const result = compareManagedMembers(left, right);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, unknown: 4 });
    for (const item of [...result.methods, ...result.fields])
      expect(item).toMatchObject({
        status: "unknown",
        match: { status: "unmatched" },
        limitations: [expect.stringContaining("signature-not-decoded")],
      });
  });

  it("keeps a decoded member unknown beside a same-named undecoded counterpart", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/decoded-before.dll");
    const right = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x7f]),
        fieldSignature: Buffer.from([0x06, 0x7f]),
      }),
      "/tmp/undecoded-after.dll",
    );
    expect(left.result.methods[0]?.signature.parse_status).toBe("decoded");
    expect(left.result.fields[0]?.signature.parse_status).toBe("decoded");
    expect(right.result.metadata.status).toBe("complete");
    expect(right.result.coverage.state).toBe("partial");
    const result = compareManagedMembers(left, right);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, unknown: 4 });
    for (const item of [...result.methods, ...result.fields])
      expect(item).toMatchObject({
        status: "unknown",
        match: { status: "unmatched" },
        limitations: [
          expect.stringMatching(
            item.left === null
              ? /^signature-not-decoded:/
              : /^counterpart-signature-not-decoded: The right (method|field) inventory/,
          ),
        ],
      });
  });
});

describe("managed member comparison of ambiguous undecoded signatures", () => {
  it("keeps a decoded member unknown beside an ambiguous same-named undecoded group", () => {
    const undecoded = { methodSignature: Buffer.from([0x00, 0x00, 0x7f]) };
    const decoded = inspect(buildManagedPeFixture(), "/tmp/decoded.dll");
    const left = inspect(buildManagedPeFixture(undecoded), "/tmp/left.dll");
    const right = inspect(buildManagedPeFixture(undecoded), "/tmp/right.dll");
    const [undecodedMethod] = left.result.methods;
    const [decodedMethod] = decoded.result.methods;
    if (undecodedMethod === undefined || decodedMethod === undefined)
      throw new Error("Expected fixture methods");
    expect(decodedMethod.name).toBe(undecodedMethod.name);
    // One undecoded T.M on the left meets two identical undecoded T.M on the
    // right, so that group stays ambiguous; the left also has a decoded T.M.
    const result = compareManagedMembers(
      {
        ...left,
        result: {
          ...left.result,
          methods: [undecodedMethod, { ...decodedMethod, token: "0x06000002" }],
        },
      },
      {
        ...right,
        result: {
          ...right.result,
          methods: [
            undecodedMethod,
            { ...undecodedMethod, token: "0x06000002" },
          ],
        },
      },
    );

    expect(result.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unknown",
          match: expect.objectContaining({
            status: "ambiguous",
            basis: "exact-il-signature",
          }),
          limitations: [
            "Multiple managed methods share the same CIL and signature; REA did not guess a token remap.",
          ],
        }),
        expect.objectContaining({
          status: "unknown",
          left: expect.objectContaining({ token: "0x06000002" }),
          limitations: [
            expect.stringMatching(
              /^counterpart-signature-not-decoded: The right method inventory has an unpaired member/u,
            ),
          ],
        }),
      ]),
    );
    expect(result.summary).toMatchObject({ removed: 0, added: 0 });
  });
});

describe("managed member comparison of selected types", () => {
  it("keeps members outside the other side's selection unknown", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left-all.dll");
    const right = inspect(buildManagedPeFixture(), "/tmp/right-selected.dll", [
      "Missing.Type",
    ]);
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.summary).toMatchObject({ added: 0, removed: 0, unknown: 2 });
    expect(result.methods[0]).toMatchObject({
      status: "unknown",
      left: { token: "0x06000001" },
      right: null,
    });
    expect(result.coverage.status).toBe("partial");
    expect(result.limitations).toContain(
      "The observations select different declaring types; a member outside the other side's selection is unknown, not added or removed.",
    );
  });

  it("does not remap members across types neither side observed", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left-a.dll", [
      "Fixture.Program",
    ]);
    const right = inspect(
      buildManagedPeFixture({
        mvid: Buffer.from("00112233445566778899aabbccddeefe", "hex"),
        typeName: "A",
        typeNamespace: "X",
      }),
      "/tmp/right-b.dll",
      ["X.A"],
    );
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.matching.exact_il_signature).toBe(0);
    expect(result.summary).toMatchObject({
      unchanged: 0,
      added: 0,
      removed: 0,
      unknown: 4,
    });
  });

  it("compares two identical selections within those types", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/left-sel.dll", [
      "Fixture.Program",
    ]);
    const right = inspect(buildManagedPeFixture(), "/tmp/right-sel.dll", [
      "Fixture.Program",
    ]);
    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.methods[0]).toMatchObject({ status: "unchanged" });
    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(result.limitations).toContain(
      "Both observations cover only the selected declaring types (Fixture.Program); member totals and statuses describe those types, not the whole assembly.",
    );
  });
});

describe("managed member comparison of one signature in several types", () => {
  it("pairs a file with itself when two types hold identical members", () => {
    const inspected = withTwin(
      inspect(buildManagedPeFixture(), "/tmp/twin.dll"),
    );
    const result = compareManagedMembers(inspected, inspected);

    expect(result.matching.ambiguous).toBe(0);
    expect(result.summary).toMatchObject({
      unchanged: 4,
      changed: 0,
      added: 0,
      removed: 0,
      unknown: 0,
    });
    for (const item of [...result.methods, ...result.fields])
      expect(item.right?.token).toBe(item.left?.token);
  });

  it.each([1, 2])(
    "keeps a member with its own changed counterpart beside %i identical members of other types",
    (twins) => {
      const left = inspect(buildManagedPeFixture(), "/tmp/own-before.dll");
      const changed = withTwin(
        inspect(
          buildManagedPeFixture({
            ilBody: Buffer.from([
              0x32, 0x02, 0x7b, 0x02, 0x00, 0x00, 0x04, 0x28, 0x02, 0x00, 0x00,
              0x0a, 0x2a,
            ]),
          }),
          "/tmp/own-after.dll",
        ),
        left,
        twins,
      );
      const result = compareManagedMembers(left, changed);

      expect(result.methods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "changed",
            left: expect.objectContaining({
              declaring_type: "Fixture.Program",
            }),
            right: expect.objectContaining({
              declaring_type: "Fixture.Program",
            }),
            match: expect.objectContaining({ basis: "exact-signature" }),
            dimensions: expect.arrayContaining(["cil"]),
          }),
          expect.objectContaining({
            status: "added",
            right: expect.objectContaining({ declaring_type: "Other.Twin" }),
          }),
        ]),
      );
      expect(result.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "unchanged",
            left: expect.objectContaining({
              declaring_type: "Fixture.Program",
            }),
            right: expect.objectContaining({
              declaring_type: "Fixture.Program",
            }),
          }),
          expect.objectContaining({
            status: "added",
            right: expect.objectContaining({ declaring_type: "Other.Twin" }),
          }),
        ]),
      );
      expect(result.summary).toMatchObject({ unknown: 0, removed: 0 });
    },
  );

  it("does not remap a member whose own identity remains on the other side", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/sig-before.dll");
    const changed = withTwin(
      inspect(
        buildManagedPeFixture({
          methodSignature: Buffer.from([0x00, 0x00, 0x08]),
          fieldSignature: Buffer.from([0x06, 0x0a]),
        }),
        "/tmp/sig-after.dll",
      ),
      left,
    );
    // Either side may hold the member whose own identity is left behind.
    const forward = compareManagedMembers(left, changed);
    const backward = compareManagedMembers(changed, left);

    for (const item of [
      ...forward.methods,
      ...forward.fields,
      ...backward.methods,
      ...backward.fields,
    ])
      expect(item.match.status).not.toBe("matched");
    expect(forward.summary).toMatchObject({ removed: 2, added: 4 });
    expect(backward.summary).toMatchObject({ removed: 4, added: 2 });
  });

  it("does not remap by structural shape a method whose own identity remains on the other side", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/shape-before.dll");
    const changed = withTwin(
      inspect(
        buildManagedPeFixture({
          methodSignature: Buffer.from([0x00, 0x00, 0x08]),
        }),
        "/tmp/shape-after.dll",
      ),
      left,
    );
    const [own, twin] = changed.result.methods;
    if (own === undefined || twin === undefined)
      throw new Error("Expected two methods");
    // Same body shape, different CIL digest: only the structural round links
    // the left method to the twin.
    const result = compareManagedMembers(left, {
      ...changed,
      result: {
        ...changed.result,
        methods: [
          own,
          {
            ...twin,
            body: { ...twin.body, normalized_il_sha256: "0".repeat(64) },
          },
        ],
      },
    });

    for (const item of result.methods)
      expect(item.match.status).not.toBe("matched");
  });
});

describe("managed member comparison remaps around kept identities", () => {
  it("does not hide a member whose own identity remains in an ambiguous remap group", () => {
    const left = inspect(buildManagedPeFixture(), "/tmp/group-before.dll");
    const changed = withTwin(
      inspect(
        buildManagedPeFixture({
          methodSignature: Buffer.from([0x00, 0x00, 0x08]),
          fieldSignature: Buffer.from([0x06, 0x0a]),
        }),
        "/tmp/group-after.dll",
      ),
      left,
      2,
    );
    const result = compareManagedMembers(left, changed);

    expect(result.matching.ambiguous).toBe(0);
    expect(result.summary).toMatchObject({ removed: 2, added: 6 });
  });

  it("remaps to the one candidate whose own identity is not kept elsewhere", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/kept-base.dll");
    const changedSignature = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x08]),
      }),
      "/tmp/kept-signature.dll",
    );
    // Left: Fixture.Program.Main, plus Other.Twin.Main with another signature.
    const left = withTwin(base, changedSignature);
    // Right: Other.Twin.Main and Other.Twin3.Main, both identical to the
    // left Fixture.Program.Main, which the right no longer has.
    const twins = withTwin(base, base, 2);
    const right = {
      ...twins,
      result: { ...twins.result, methods: twins.result.methods.slice(1) },
    };
    const result = compareManagedMembers(left, right);

    expect(result.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          left: expect.objectContaining({ declaring_type: "Fixture.Program" }),
          right: expect.objectContaining({ declaring_type: "Other.Twin3" }),
          match: expect.objectContaining({
            status: "matched",
            basis: "exact-il-signature",
          }),
        }),
      ]),
    );
    expect(
      result.methods.filter(({ match }) => match.status === "ambiguous"),
    ).toEqual([]);
  });

  it("names the shared structural shape of an ambiguous remap group", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/shape-group.dll");
    const twins = withTwin(base, base, 2);
    // Two right methods share the left method's shape but not its CIL digest,
    // and the right no longer declares the left method's identity.
    const right = {
      ...twins,
      result: {
        ...twins.result,
        methods: twins.result.methods.slice(1).map((method) => ({
          ...method,
          body: { ...method.body, normalized_il_sha256: "0".repeat(64) },
        })),
        fields: [],
      },
    };
    const left = { ...base, result: { ...base.result, fields: [] } };
    const result = compareManagedMembers(left, right);

    expect(result.methods).toEqual([
      expect.objectContaining({
        match: expect.objectContaining({
          status: "ambiguous",
          basis: "structural-method-shape",
        }),
        limitations: [
          "Multiple managed methods share the same structural shape; REA did not guess a token remap.",
        ],
      }),
    ]);
  });
});

describe("managed member comparison of unresolved and held identities", () => {
  it("does not remap past an unresolved member that may be the counterpart", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/orphan-copy.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const left = { ...base, result: { ...base.result, fields: [] } };
    // The right keeps Main with an unresolved owner, and an identical copy
    // in another type; either could be the left Main.
    const right = {
      ...base,
      result: {
        ...base.result,
        types: [
          ...base.result.types,
          namedTypeFact("Twin", "Other", "0x02000003"),
        ],
        methods: [
          { ...method, declaring_type: null, declaring_type_token: null },
          {
            ...method,
            declaring_type: "Other.Twin",
            declaring_type_token: "0x02000003",
            name: "Copy",
            token: "0x06000002",
          },
        ],
        fields: [],
      },
    };

    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ]) {
      expect(
        result.methods.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
      expect(result.summary).toMatchObject({ added: 0, removed: 0 });
    }
  });
});

describe("managed member comparison of raw-signature contention", () => {
  it("contests same-signature methods even when their bodies differ", () => {
    const base = inspect(
      buildManagedPeFixture(),
      "/tmp/ownerless-signatures.dll",
    );
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const changedBody = (hash: string, stack: number) => ({
      ...method.body,
      normalized_il_sha256: hash.repeat(64),
      max_stack: stack,
    });
    const withOwnerless = {
      ...base,
      result: {
        ...base.result,
        fields: [],
        methods: [
          { ...method, body: changedBody("a", 1) },
          {
            ...method,
            token: "0x06000002",
            declaring_type: null,
            declaring_type_token: null,
            body: changedBody("b", 2),
          },
        ],
      },
    };
    const resolvedOnly = {
      ...base,
      result: {
        ...base.result,
        fields: [],
        methods: [{ ...method, body: changedBody("c", 3) }],
      },
    };
    for (const result of [
      compareManagedMembers(withOwnerless, resolvedOnly),
      compareManagedMembers(resolvedOnly, withOwnerless),
    ]) {
      expect(result.methods).toHaveLength(1);
      const [item] = result.methods;
      if (item === undefined)
        throw new Error("Expected uncertain signature group");
      expect(item).toMatchObject({
        status: "unknown",
        match: { status: "ambiguous", basis: "exact-signature" },
      });
      expect(result.summary).toMatchObject({
        added: 0,
        removed: 0,
        unknown: 1,
      });
      expect(
        item.match.candidate_left_tokens.length +
          item.match.candidate_right_tokens.length,
      ).toBe(3);
    }
  });

  it("contests ownerless undecoded fields by raw signature", () => {
    const base = inspect(
      buildManagedPeFixture({ fieldSignature: Buffer.from([0x06, 0x7f]) }),
      "/tmp/ownerless-field-signatures.dll",
    );
    const [field] = base.result.fields;
    if (field === undefined) throw new Error("Expected a fixture field");
    expect(field.signature.parse_status).toBe("unsupported");
    const withOwnerless = {
      ...base,
      result: {
        ...base.result,
        methods: [],
        fields: [
          field,
          {
            ...field,
            token: "0x04000002",
            declaring_type: null,
            declaring_type_token: null,
          },
        ],
      },
    };
    const resolvedOnly = {
      ...base,
      result: { ...base.result, methods: [], fields: [field] },
    };
    for (const result of [
      compareManagedMembers(withOwnerless, resolvedOnly),
      compareManagedMembers(resolvedOnly, withOwnerless),
    ])
      expect(
        result.fields.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
  });
});

describe("managed member comparison of consumed ownerless ambiguity", () => {
  it("keeps a consumed ownerless ambiguity from authorizing a later remap", () => {
    const base = inspect(
      buildManagedPeFixture(),
      "/tmp/consumed-ownerless.dll",
    );
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const ownerTypes = new Map(
      ["T", "D", "U"].map((name, index) => [
        name,
        namedTypeFact(name, "", `0x0200000${String(index + 3)}`),
      ]),
    );
    const candidate = (
      raw: string,
      token: string,
      owner: string | null,
      name: string,
      stack: number,
    ) => ({
      ...method,
      token,
      declaring_type: owner,
      declaring_type_token:
        owner === null ? null : ownerTypes.get(owner)!.token,
      name,
      // An operand-free signature: its resolved digest is the raw one.
      signature: {
        ...method.signature,
        raw_sha256: raw.repeat(64),
        resolved_sha256: raw.repeat(64),
      },
      body: {
        ...method.body,
        normalized_il_sha256: raw.repeat(64),
        max_stack: stack,
      },
    });
    const left = {
      ...base,
      result: {
        ...base.result,
        types: [...base.result.types, ...ownerTypes.values()],
        fields: [],
        methods: [
          candidate("a", "0x06000001", "T", "M", 1),
          candidate("b", "0x06000002", null, "M", 1),
          candidate("b", "0x06000003", "D", "D", 2),
        ],
      },
    };
    const right = {
      ...base,
      result: {
        ...base.result,
        types: [...base.result.types, ...ownerTypes.values()],
        fields: [],
        methods: [
          candidate("c", "0x06000001", "U", "N", 1),
          candidate("b", "0x06000002", null, "M", 1),
          candidate("d", "0x06000003", "T", "M", 3),
        ],
      },
    };
    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ]) {
      expect(result.matching.ambiguous).toBeGreaterThan(0);
      expect(
        result.methods.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
    }
  });
});

describe("managed member comparison of retained ownership contention", () => {
  it("keeps changed counterparts unknown after an ownerless candidate is held", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/held-ownerless.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const body = (hash: string, stack: number) => ({
      ...method.body,
      il_sha256: hash.repeat(64),
      normalized_il_sha256: hash.repeat(64),
      max_stack: stack,
    });
    const ownerless = {
      ...method,
      token: "0x06000002",
      declaring_type: null,
      declaring_type_token: null,
      body: body("b", 2),
    };
    const left = {
      ...base,
      result: {
        ...base.result,
        fields: [],
        methods: [{ ...method, body: body("a", 1) }, ownerless],
      },
    };
    const right = {
      ...base,
      result: {
        ...base.result,
        types: [
          ...base.result.types,
          namedTypeFact("Twin", "Other", "0x02000003"),
        ],
        fields: [],
        methods: [
          { ...method, body: body("c", 3) },
          {
            ...method,
            token: "0x06000002",
            declaring_type: "Other.Twin",
            declaring_type_token: "0x02000003",
            name: "Copy",
            body: ownerless.body,
          },
        ],
      },
    };
    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ]) {
      expect(result.summary).toEqual({
        unchanged: 0,
        changed: 0,
        added: 0,
        removed: 0,
        unknown: 2,
      });
      expect(result.methods).toEqual([
        expect.objectContaining({
          status: "unknown",
          match: {
            status: "ambiguous",
            basis: "exact-il-signature",
            confidence: "unknown",
            candidate_left_tokens: ["0x06000002"],
            candidate_right_tokens: ["0x06000002"],
          },
        }),
        expect.objectContaining({
          status: "unknown",
          match: {
            status: "ambiguous",
            basis: "exact-signature",
            confidence: "unknown",
            candidate_left_tokens: ["0x06000001"],
            candidate_right_tokens: ["0x06000001"],
          },
        }),
      ]);
    }
  });
});

describe("managed member comparison of ownerless structural competitors", () => {
  it("keeps structural competitors of an ownerless method ambiguous in both directions", () => {
    const base = inspect(
      buildManagedPeFixture(),
      "/tmp/ownerless-shape-competitors.dll",
    );
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const withSignature = (raw: string, token: string) => ({
      ...method,
      token,
      signature: { ...method.signature, raw_sha256: raw.repeat(64) },
    });
    const withOwnerless = {
      ...base,
      result: {
        ...base.result,
        methods: [
          withSignature("a", "0x06000001"),
          {
            ...withSignature("b", "0x06000002"),
            declaring_type: null,
            declaring_type_token: null,
          },
        ],
        fields: [],
      },
    };
    const resolvedOnly = {
      ...base,
      result: {
        ...base.result,
        methods: [withSignature("c", "0x06000001")],
        fields: [],
      },
    };
    for (const result of [
      compareManagedMembers(withOwnerless, resolvedOnly),
      compareManagedMembers(resolvedOnly, withOwnerless),
    ]) {
      expect(result.matching.ambiguous).toBe(1);
      expect(
        result.methods.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
      expect(result.summary).toMatchObject({ added: 0, removed: 0 });
    }
  });
});

it("keeps a lone ownerless member unknown despite an identical payload", () => {
  const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-lone.dll");
  const [method] = base.result.methods;
  if (method === undefined) throw new Error("Expected a fixture method");
  const ownerless = {
    ...method,
    declaring_type: null,
    declaring_type_token: null,
  };
  const side = {
    ...base,
    result: { ...base.result, methods: [ownerless], fields: [] },
  };

  const result = compareManagedMembers(side, side);

  expect(result.matching.ambiguous).toBe(1);
  expect(
    result.methods.filter(({ match }) => match.status === "matched"),
  ).toHaveLength(0);
  expect(result.methods[0]).toMatchObject({
    status: "unknown",
    match: {
      status: "ambiguous",
      candidate_left_tokens: [ownerless.token],
      candidate_right_tokens: [ownerless.token],
    },
    limitations: [
      expect.stringContaining("Declared type identity remains unresolved"),
    ],
  });
  expect(result.summary).toMatchObject({
    unchanged: 0,
    added: 0,
    removed: 0,
    unknown: 1,
  });
});

describe("managed member comparison of ownerless members", () => {
  it("keeps an ownerless member ambiguous beside a resolved copy, as main does", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-copy.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const ownerless = {
      ...method,
      declaring_type: null,
      declaring_type_token: null,
    };
    const left = {
      ...base,
      result: { ...base.result, methods: [ownerless], fields: [] },
    };
    // The right keeps the ownerless Foo and a resolved copy with the same
    // CIL and signature; the left Foo's owner may be either one.
    const right = {
      ...base,
      result: {
        ...base.result,
        methods: [ownerless, { ...method, token: "0x06000002" }],
        fields: [],
      },
    };

    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ]) {
      expect(result.matching.ambiguous).toBe(1);
      expect(
        result.methods.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
      expect(result.summary).toMatchObject({ added: 0, removed: 0 });
    }
  });

  it("keeps a resolved copy out of the declared round when an ownerless competitor is on the left, as main does", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-left.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const ownerless = {
      ...method,
      declaring_type: null,
      declaring_type_token: null,
    };
    // The left holds the resolved Foo and an ownerless Foo with the same CIL
    // and signature; the right holds only the resolved Foo. The ownerless
    // Foo's owner may be the resolved one, so the three stay ambiguous.
    const withOwnerless = {
      ...base,
      result: { ...base.result, methods: [method, ownerless], fields: [] },
    };
    const resolvedOnly = {
      ...base,
      result: { ...base.result, methods: [method], fields: [] },
    };

    const result = compareManagedMembers(withOwnerless, resolvedOnly);

    expect(result.matching.ambiguous).toBe(1);
    expect(
      result.methods.filter(({ match }) => match.status === "matched"),
    ).toEqual([]);
    expect(result.summary).toMatchObject({ added: 0, removed: 0 });
  });

  it("keeps a resolved copy out of the declared round when an ownerless competitor is on the right, as main does", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-right.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const ownerless = {
      ...method,
      declaring_type: null,
      declaring_type_token: null,
    };
    const withOwnerless = {
      ...base,
      result: { ...base.result, methods: [method, ownerless], fields: [] },
    };
    const resolvedOnly = {
      ...base,
      result: { ...base.result, methods: [method], fields: [] },
    };

    const result = compareManagedMembers(resolvedOnly, withOwnerless);

    expect(result.matching.ambiguous).toBe(1);
    expect(
      result.methods.filter(({ match }) => match.status === "matched"),
    ).toEqual([]);
    expect(result.summary).toMatchObject({ added: 0, removed: 0 });
  });

  it("keeps an ownerless method ambiguous beside a resolved method of the same shape", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-shape.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const ownerless = {
      ...method,
      declaring_type: null,
      declaring_type_token: null,
    };
    // Raw signature digests differ, so only the decoded shape links them.
    const reshaped = (raw: string, token: string) => ({
      signature: { ...method.signature, raw_sha256: raw.repeat(64) },
      token,
    });
    const left = {
      ...base,
      result: { ...base.result, methods: [ownerless], fields: [] },
    };
    const right = {
      ...base,
      result: {
        ...base.result,
        methods: [
          { ...ownerless, ...reshaped("e", "0x06000001") },
          { ...method, name: "Bar", ...reshaped("d", "0x06000002") },
        ],
        fields: [],
      },
    };
    const result = compareManagedMembers(left, right);

    expect(result.matching.ambiguous).toBe(1);
    expect(
      result.methods.filter(({ match }) => match.status === "matched"),
    ).toEqual([]);
  });
});

describe("managed member comparison of unresolved owners", () => {
  it("does not pair members of unresolved types under different names", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/orphan-names.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const orphan = { declaring_type: null, declaring_type_token: null };
    const side = (name: string) => ({
      ...base,
      result: {
        ...base.result,
        methods: [{ ...method, ...orphan, name }],
        fields: [],
      },
    });
    const result = compareManagedMembers(side("Main"), side("Renamed"));

    for (const item of result.methods)
      expect(item.match.status).not.toBe("matched");
  });

  it("keeps ownerless members that share a body ambiguous, as main does", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/orphan-self.dll");
    const [method] = base.result.methods;
    const [field] = base.result.fields;
    if (method === undefined || field === undefined)
      throw new Error("Expected a fixture method and field");
    const orphan = { declaring_type: null, declaring_type_token: null };
    const inspected = {
      ...base,
      result: {
        ...base.result,
        methods: [
          { ...method, ...orphan, name: "p" },
          { ...method, ...orphan, name: "q", token: "0x06000002" },
        ],
        fields: [
          { ...field, ...orphan, name: "a" },
          { ...field, ...orphan, name: "b", token: "0x04000002" },
        ],
      },
    };
    const result = compareManagedMembers(inspected, inspected);

    // Their owners are unknown, so `p` may be `q`; names alone cannot tell.
    expect(result.matching.ambiguous).toBe(2);
    expect(
      [...result.methods, ...result.fields].filter(
        ({ match }) => match.status === "matched",
      ),
    ).toEqual([]);
  });

  it("does not remap a member whose own identity is in an ambiguous group", () => {
    const undecoded = { methodSignature: Buffer.from([0x00, 0x00, 0x7f]) };
    const decoded = inspect(buildManagedPeFixture(), "/tmp/held-decoded.dll");
    const held = inspect(buildManagedPeFixture(undecoded), "/tmp/held.dll");
    const [undecodedMethod] = held.result.methods;
    const [decodedMethod] = decoded.result.methods;
    if (undecodedMethod === undefined || decodedMethod === undefined)
      throw new Error("Expected fixture methods");
    // The right keeps two identical undecoded Fixture.Program.Main, which
    // stay ambiguous, and a copy of the decoded Main in another type.
    const left = {
      ...held,
      result: {
        ...held.result,
        methods: [{ ...undecodedMethod, token: "0x06000002" }, decodedMethod],
      },
    };
    const right = {
      ...held,
      result: {
        ...held.result,
        types: [
          ...held.result.types,
          namedTypeFact("Twin", "Other", "0x02000003"),
        ],
        methods: [
          undecodedMethod,
          { ...undecodedMethod, token: "0x06000002" },
          {
            ...decodedMethod,
            declaring_type: "Other.Twin",
            declaring_type_token: "0x02000003",
            token: "0x06000003",
          },
        ],
      },
    };

    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ])
      expect(
        result.methods.filter(({ match }) => match.status === "matched"),
      ).toEqual([]);
  });

  it("does not remap a member whose declaring type is unresolved", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/orphan.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    const left = {
      ...base,
      result: {
        ...base.result,
        methods: [
          { ...method, declaring_type: null, declaring_type_token: null },
        ],
        fields: [],
      },
    };
    const right = {
      ...base,
      result: {
        ...base.result,
        types: [
          ...base.result.types,
          namedTypeFact("Twin", "Other", "0x02000003"),
        ],
        methods: [
          {
            ...method,
            declaring_type: "Other.Twin",
            declaring_type_token: "0x02000003",
            token: "0x06000002",
          },
        ],
        fields: [],
      },
    };

    for (const result of [
      compareManagedMembers(left, right),
      compareManagedMembers(right, left),
    ])
      for (const item of result.methods)
        expect(item.match.status).not.toBe("matched");
  });
});

// Signatures name types by TypeDef/TypeRef row. The right build inserts a
// TypeDef and a TypeRef ahead of the ones its members use, so the same
// types sit at different rows and the raw signature bytes differ.
const LIST_REFERENCE = {
  namespace: "System.Collections.Generic",
  name: "List`1",
};
const leftBuild = {
  typeReferences: [LIST_REFERENCE],
};
const rightBuild = {
  additionalEmptyTypes: 1,
  typeReferences: [{ namespace: "System", name: "Uri" }, LIST_REFERENCE],
};
// List`1 is TypeRef row 2 on the left and row 3 on the right; Program is
// TypeDef row 1 on the left and row 2 on the right.
const leftTypes = { list: (2 << 2) | 1, program: 1 << 2 };
const rightTypes = { list: (3 << 2) | 1, program: 2 << 2 };
// List`1<Program> counter
const fieldSignature = (types: typeof leftTypes) =>
  Buffer.from([0x06, 0x15, 0x12, types.list, 0x01, 0x12, types.program]);
// List`1<Program> Main(Program)
const methodSignature = (types: typeof leftTypes) =>
  Buffer.from([
    0x00,
    0x01,
    0x15,
    0x12,
    types.list,
    0x01,
    0x12,
    types.program,
    0x12,
    types.program,
  ]);
const changedIl = Buffer.from([
  0x32, 0x02, 0x7b, 0x02, 0x00, 0x00, 0x04, 0x28, 0x02, 0x00, 0x00, 0x0a, 0x2a,
]);

const compareBuilds = (
  left: Parameters<typeof buildManagedPeFixture>[0],
  right: Parameters<typeof buildManagedPeFixture>[0],
) => {
  const leftInspection = inspect(
    buildManagedPeFixture(left),
    "/tmp/left-build.dll",
  );
  const rightInspection = inspect(
    buildManagedPeFixture(right),
    "/tmp/right-build.dll",
  );
  return compareManagedMembers(
    { evidenceId: leftInspection.evidenceId, result: leftInspection.result },
    {
      evidenceId: rightInspection.evidenceId,
      result: rightInspection.result,
    },
  );
};

describe("managed member comparison across builds", () => {
  it("pairs members whose signatures name the same types at different metadata rows", () => {
    const result = compareBuilds(
      {
        ...leftBuild,
        fieldSignature: fieldSignature(leftTypes),
        methodSignature: methodSignature(leftTypes),
      },
      {
        ...rightBuild,
        fieldSignature: fieldSignature(rightTypes),
        methodSignature: methodSignature(rightTypes),
      },
    );

    expect(result.methods).toEqual([
      expect.objectContaining({
        status: "unchanged",
        dimensions: [],
        match: expect.objectContaining({ basis: "exact-il-signature" }),
      }),
    ]);
    expect(result.fields).toEqual([
      expect.objectContaining({
        status: "unchanged",
        match: expect.objectContaining({ basis: "field-signature" }),
      }),
    ]);
  });

  it("pairs a method by declared type, name, and resolved signature when its CIL changed", () => {
    const result = compareBuilds(
      { ...leftBuild, methodSignature: methodSignature(leftTypes) },
      {
        ...rightBuild,
        methodSignature: methodSignature(rightTypes),
        ilBody: changedIl,
      },
    );

    expect(result.methods).toEqual([
      expect.objectContaining({
        status: "changed",
        dimensions: ["cil", "availability"],
        match: expect.objectContaining({ basis: "exact-signature" }),
      }),
    ]);
  });

  it("pairs a renamed method by structural shape when its signature names the same types", () => {
    const result = compareBuilds(
      { ...leftBuild, methodSignature: methodSignature(leftTypes) },
      {
        ...rightBuild,
        methodName: "Renamed",
        methodSignature: methodSignature(rightTypes),
        ilBody: changedIl,
      },
    );

    expect(result.methods).toEqual([
      expect.objectContaining({
        status: "changed",
        match: expect.objectContaining({
          basis: "structural-method-shape",
          confidence: "high",
        }),
      }),
    ]);
  });

  it("does not pair members whose identical signature bytes name different types", () => {
    // TypeDef row 1 is Program on the left and Empty0 on the right.
    const result = compareBuilds(
      {
        fieldSignature: Buffer.from([0x06, 0x12, leftTypes.program]),
        methodSignature: Buffer.from([0x00, 0x00, 0x12, leftTypes.program]),
      },
      {
        additionalEmptyTypes: 1,
        fieldSignature: Buffer.from([0x06, 0x12, leftTypes.program]),
        methodSignature: Buffer.from([0x00, 0x00, 0x12, leftTypes.program]),
      },
    );

    expect(result.methods.map(({ status }) => status).sort()).toEqual([
      "added",
      "removed",
    ]);
    expect(result.fields.map(({ status }) => status).sort()).toEqual([
      "added",
      "removed",
    ]);
  });
});

describe("managed member comparison of resolved signatures", () => {
  it("pairs a partially decoded field by declared type, name, and resolved signature", () => {
    // Trailing data after the field type leaves the signature partial.
    const result = compareBuilds(
      { fieldSignature: Buffer.from([0x06, 0x12, leftTypes.program, 0x00]) },
      {
        additionalEmptyTypes: 1,
        fieldSignature: Buffer.from([0x06, 0x12, rightTypes.program, 0x00]),
      },
    );

    expect(result.fields).toEqual([
      expect.objectContaining({
        status: "unchanged",
        match: expect.objectContaining({ basis: "exact-signature" }),
      }),
    ]);
  });

  it("does not pair a raw digest with an equal resolved digest", () => {
    // class Fixture.Program on the left; on the right, the bytes of its
    // resolved preimage, which do not decode and so compare by raw digest.
    const programDigest = createHash("sha256")
      .update(Buffer.from([0]))
      .update("Fixture")
      .update(Buffer.from([0]))
      .update("Program")
      .digest();
    const left = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.from([0x00, 0x00, 0x12, leftTypes.program]),
      }),
      "/tmp/left-collision.dll",
    );
    const right = inspect(
      buildManagedPeFixture({
        methodSignature: Buffer.concat([
          Buffer.from([0x00, 0x00, 0x12, 0xff]),
          programDigest,
        ]),
      }),
      "/tmp/right-collision.dll",
    );
    // The collision this guards against must exist: the right blob does not
    // decode, and its raw digest is the left signature's resolved digest.
    const [leftMethod] = left.result.methods;
    const [rightMethod] = right.result.methods;
    expect(rightMethod?.signature.resolved_sha256).toBeNull();
    expect(rightMethod?.signature.raw_sha256).toBe(
      leftMethod?.signature.resolved_sha256,
    );

    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: left.result },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(
      result.methods.filter(({ match }) => match.status === "matched"),
    ).toEqual([]);
  });

  it("compares raw signatures against Evidence recorded before resolution", () => {
    // Both signatures name Program, TypeDef row 1, in the same build.
    const build = () =>
      buildManagedPeFixture({
        fieldSignature: Buffer.from([0x06, 0x12, leftTypes.program]),
        methodSignature: Buffer.from([
          0x00,
          0x01,
          0x01,
          0x12,
          leftTypes.program,
        ]),
      });
    const left = inspect(build(), "/tmp/left-recorded.dll");
    const right = inspect(build(), "/tmp/right-current.dll");
    const withoutResolution = <Member extends { signature: object }>(
      members: readonly Member[],
    ) =>
      members.map((member) => {
        const { resolved_sha256: _omitted, ...recorded } = member.signature as {
          resolved_sha256: unknown;
        };
        return { ...member, signature: recorded };
      });
    const recorded = managedMemberInspectionSchema.parse({
      ...left.result,
      signature_resolution: undefined,
      methods: withoutResolution(left.result.methods),
      fields: withoutResolution(left.result.fields),
      member_refs: withoutResolution(left.result.member_refs),
    });
    expect(recorded.methods[0]?.signature.resolved_sha256).toBeNull();

    const result = compareManagedMembers(
      { evidenceId: left.evidenceId, result: recorded },
      { evidenceId: right.evidenceId, result: right.result },
    );

    expect(result.methods).toEqual([
      expect.objectContaining({ status: "unchanged" }),
    ]);
    expect(result.fields).toEqual([
      expect.objectContaining({ status: "unchanged" }),
    ]);
    expect(result.limitations).toContain(
      "At least one managed member observation does not attest signature type-name resolution, so signatures compare by raw bytes, which name types by build-local metadata row.",
    );
  });
});

describe("managed member comparison of nested signature types", () => {
  const fieldOfType = (codedIndex: number) =>
    Buffer.from([0x06, 0x12, codedIndex]);
  const statuses = (result: ReturnType<typeof compareBuilds>) =>
    result.fields.map(({ status }) => status).sort();

  it("pairs a nested TypeDef by its enclosing type at different rows", () => {
    // Fixture.Empty0/Fixture.Program is TypeDef row 2, then row 3.
    const result = compareBuilds(
      {
        additionalEmptyTypes: 1,
        nestedTypes: [[2, 1]],
        fieldSignature: fieldOfType(2 << 2),
      },
      {
        additionalEmptyTypes: 2,
        nestedTypes: [[3, 1]],
        fieldSignature: fieldOfType(3 << 2),
      },
    );

    expect(statuses(result)).toEqual(["unchanged"]);
  });

  it("tells same-named TypeDefs apart by their enclosing types", () => {
    // TypeDef row 2 is nested in Empty0 on the left only.
    const result = compareBuilds(
      {
        additionalEmptyTypes: 2,
        nestedTypes: [[2, 1]],
        fieldSignature: fieldOfType(2 << 2),
      },
      { additionalEmptyTypes: 2, fieldSignature: fieldOfType(2 << 2) },
    );

    expect(statuses(result)).toEqual(["added", "removed"]);
  });

  it("does not name a TypeDef whose nesting is cyclic", () => {
    const bytes = buildManagedPeFixture({
      additionalEmptyTypes: 2,
      nestedTypes: [
        [1, 2],
        [2, 1],
      ],
      fieldSignature: fieldOfType(1 << 2),
    });
    const field = inspect(bytes, "/tmp/cyclic.dll").result.fields[0];

    expect(field?.signature.parse_status).toBe("decoded");
    expect(field?.signature.resolved_sha256).toBeNull();
  });

  const enumerator = (enclosingRow: number) => ({
    namespace: "",
    name: "Enumerator",
    enclosingRow,
  });
  const list = { namespace: "System.Collections.Generic", name: "List`1" };
  const dictionary = {
    namespace: "System.Collections.Generic",
    name: "Dictionary`2",
  };

  it("pairs a nested TypeRef by its enclosing TypeRef at different rows", () => {
    // List`1/Enumerator is TypeRef row 3, then row 4.
    const result = compareBuilds(
      {
        typeReferences: [list, enumerator(2)],
        fieldSignature: fieldOfType((3 << 2) | 1),
      },
      {
        typeReferences: [dictionary, list, enumerator(3)],
        fieldSignature: fieldOfType((4 << 2) | 1),
      },
    );

    expect(statuses(result)).toEqual(["unchanged"]);
  });

  it("tells same-named TypeRefs apart by their enclosing TypeRefs", () => {
    // List`1/Enumerator on the left, Dictionary`2/Enumerator on the right.
    const result = compareBuilds(
      {
        typeReferences: [list, enumerator(2)],
        fieldSignature: fieldOfType((3 << 2) | 1),
      },
      {
        typeReferences: [dictionary, enumerator(2)],
        fieldSignature: fieldOfType((3 << 2) | 1),
      },
    );

    expect(statuses(result)).toEqual(["added", "removed"]);
  });
});

describe("managed member comparison of unresolved signatures", () => {
  // A TypeSpec operand has no name, so the method compares by raw bytes,
  // while the default field resolves.
  const typeSpecs = [Buffer.from([0x1d, 0x08]), Buffer.from([0x1d, 0x0e])];
  const unresolvedAt = (row: number) => ({
    typeSpecSignatures: typeSpecs,
    methodSignature: Buffer.from([0x00, 0x00, 0x12, (row << 2) | 2]),
  });
  const resolved = {
    methodSignature: Buffer.from([0x00, 0x00, 0x12, leftTypes.program]),
  };
  const methodLimitations = (result: ReturnType<typeof compareBuilds>) =>
    result.methods.map(({ status, limitations }) => [status, limitations]);

  it("does not establish unchanged signatures from identical unresolved row bytes", () => {
    const result = compareBuilds(unresolvedAt(1), {
      ...unresolvedAt(1),
      typeSpecSignatures: [...typeSpecs].reverse(),
    });
    expect(methodLimitations(result)).toEqual([
      ["unknown", [expect.stringMatching(/^signature-not-resolved:/u)]],
    ]);
  });

  it("retains a known CIL change beside an unresolved signature", () => {
    const result = compareBuilds(unresolvedAt(1), {
      ...unresolvedAt(1),
      ilBody: Buffer.from([0x0a, 0x17, 0x2a]),
    });
    expect(methodLimitations(result)).toEqual([
      ["changed", [expect.stringMatching(/^signature-not-resolved:/u)]],
    ]);
    expect(result.methods[0]?.dimensions).toContain("cil");
  });

  it("keeps a partially decoded field's unresolved type unknown after pairing", () => {
    const fieldSignature = Buffer.from([0x06, 0x12, (1 << 2) | 2, 0xff]);
    const result = compareBuilds(
      { typeSpecSignatures: typeSpecs, fieldSignature },
      { typeSpecSignatures: [...typeSpecs].reverse(), fieldSignature },
    );
    expect(result.fields).toEqual([
      expect.objectContaining({
        status: "unknown",
        limitations: [expect.stringMatching(/^signature-not-resolved:/u)],
      }),
    ]);
  });

  it("retains unknown signatures when every member has an unresolved operand", () => {
    const at = (row: number) => ({
      ...unresolvedAt(row),
      fieldSignature: Buffer.from([0x06, 0x12, (row << 2) | 2]),
    });
    const result = compareBuilds(at(1), at(2));
    expect(
      [...result.methods, ...result.fields].map(({ status }) => status),
    ).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(result.limitations).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "does not attest signature type-name resolution",
        ),
      ]),
    );
  });

  it("keeps an unmatched unresolved method unknown in a resolved comparison", () => {
    for (const result of [
      compareBuilds(unresolvedAt(1), unresolvedAt(2)),
      compareBuilds(unresolvedAt(2), unresolvedAt(1)),
    ])
      expect(methodLimitations(result)).toEqual([
        ["unknown", [expect.stringMatching(/^signature-not-resolved:/u)]],
        ["unknown", [expect.stringMatching(/^signature-not-resolved:/u)]],
      ]);
  });

  it("keeps a resolved method unknown beside an unresolved same-named counterpart", () => {
    for (const [left, right] of [
      [unresolvedAt(1), resolved],
      [resolved, unresolvedAt(1)],
    ] as const) {
      const result = compareBuilds(left, right);
      const unresolvedSide = left === resolved ? "right" : "left";
      expect(
        result.methods.map(({ status, left: leftItem, limitations }) => [
          status,
          (leftItem === null) === (unresolvedSide === "left")
            ? "resolved"
            : "unresolved",
          limitations,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [
            "unknown",
            "unresolved",
            [expect.stringMatching(/^signature-not-resolved:/u)],
          ],
          [
            "unknown",
            "resolved",
            [
              expect.stringMatching(
                new RegExp(
                  `^counterpart-signature-not-resolved: The ${unresolvedSide} method inventory`,
                  "u",
                ),
              ),
            ],
          ],
        ]),
      );
    }
  });
});

describe("managed member comparison limitations for resolved signatures", () => {
  it("does not report missing resolved digests for observations without signatures", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/no-members.dll");
    const empty = {
      ...base,
      result: { ...base.result, methods: [], fields: [] },
    };
    const result = compareManagedMembers(empty, empty);

    expect(result.limitations).not.toContain(
      "At least one managed member observation does not attest signature type-name resolution, so signatures compare by raw bytes, which name types by build-local metadata row.",
    );
  });
});

describe("managed member comparison of resolved-signature contention", () => {
  it("contests an ownerless method across builds whose raw signature bytes differ", () => {
    const base = inspect(buildManagedPeFixture(), "/tmp/ownerless-builds.dll");
    const [method] = base.result.methods;
    if (method === undefined) throw new Error("Expected a fixture method");
    // The same signature names a type at another row in the right build.
    const member = (raw: string, body: string, stack: number) => ({
      ...method,
      signature: {
        ...method.signature,
        raw_sha256: raw.repeat(64),
        resolved_sha256: "e".repeat(64),
      },
      body: {
        ...method.body,
        normalized_il_sha256: body.repeat(64),
        max_stack: stack,
      },
    });
    const withOwnerless = {
      ...base,
      result: {
        ...base.result,
        fields: [],
        methods: [
          member("a", "a", 1),
          {
            ...member("a", "b", 2),
            token: "0x06000002",
            declaring_type: null,
            declaring_type_token: null,
          },
        ],
      },
    };
    const resolvedOnly = {
      ...base,
      result: { ...base.result, fields: [], methods: [member("f", "c", 3)] },
    };
    for (const result of [
      compareManagedMembers(withOwnerless, resolvedOnly),
      compareManagedMembers(resolvedOnly, withOwnerless),
    ]) {
      expect(result.methods).toEqual([
        expect.objectContaining({
          status: "unknown",
          match: expect.objectContaining({
            status: "ambiguous",
            basis: "exact-signature",
          }),
        }),
      ]);
      expect(result.summary).toMatchObject({ added: 0, removed: 0 });
    }
  });
});

/**
 * Add copies of the fixture's method and field, each pair declared by another
 * type, to an inspection. The copies come from `source`, so they can carry
 * the bytes of a different build than the inspection they join.
 */
const namedTypeFact = (
  typeName: string,
  typeNamespace: string,
  token: string,
) => {
  const type = inspect(
    buildManagedPeFixture({ typeName, typeNamespace }),
    `/fixture/${typeNamespace}/${typeName}.dll`,
  ).result.types.find(
    (type) => type.name === typeName && type.namespace === typeNamespace,
  );
  if (type === undefined || type.name_sha256 === null)
    throw new Error("Expected a named fixture TypeDef");
  return { ...type, token };
};

const withTwin = (
  inspected: ReturnType<typeof inspect>,
  source: ReturnType<typeof inspect> = inspected,
  count = 1,
): ReturnType<typeof inspect> => {
  const [method] = source.result.methods;
  const [field] = source.result.fields;
  if (method === undefined || field === undefined)
    throw new Error("Expected a fixture method and field");
  const rows = Array.from({ length: count }, (_, index) => index + 2);
  // This consumer fixture needs matching TypeDef facts as well as member
  // facts. Obtain nominal digests from the production metadata owner; copying
  // only display names leaves declaring_type_token pointing at a missing row.
  const types = rows.map((row) =>
    namedTypeFact(
      row === 2 ? "Twin" : `Twin${String(row)}`,
      "Other",
      `0x0200000${String(row + 1)}`,
    ),
  );
  const twin = (row: number) => ({
    declaring_type: types[row - 2]!.full_name,
    declaring_type_token: types[row - 2]!.token,
  });
  const caller = (row: number) => ({
    caller_token: `0x0600000${String(row)}`,
    caller: `${twin(row).declaring_type}.${method.name}`,
  });
  return {
    ...inspected,
    result: {
      ...inspected.result,
      types: [...inspected.result.types, ...types],
      methods: [
        ...inspected.result.methods,
        ...rows.map((row) => ({
          ...method,
          ...twin(row),
          token: `0x0600000${String(row)}`,
        })),
      ],
      fields: [
        ...inspected.result.fields,
        ...rows.map((row) => ({
          ...field,
          ...twin(row),
          token: `0x0400000${String(row)}`,
        })),
      ],
      call_edges: [
        ...inspected.result.call_edges,
        ...rows.flatMap((row) =>
          source.result.call_edges
            .filter((edge) => edge.caller_token === method.token)
            .map((edge) => ({ ...edge, ...caller(row) })),
        ),
      ],
      field_accesses: [
        ...inspected.result.field_accesses,
        ...rows.flatMap((row) =>
          source.result.field_accesses
            .filter((edge) => edge.method_token === method.token)
            .map((edge) => {
              const identity = caller(row);
              return {
                ...edge,
                method_token: identity.caller_token,
                method: identity.caller,
              };
            }),
        ),
      ],
    },
  };
};

const inspect = (bytes: Buffer, path: string, typeNames?: string[]) => {
  const target = managedPeFixtureTarget(bytes, path);
  const result = inspectManagedMembersBytes(
    bytes,
    target,
    typeNames === undefined ? {} : { typeNames },
  );
  return {
    result,
    evidenceId: `ev_${hash(Buffer.from(path))}`,
  };
};

const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
