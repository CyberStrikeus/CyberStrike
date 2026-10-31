import { expect, it } from "vitest";
import { parseNativeExports } from "./NativeExportParser.js";
import {
  elfExportImage,
  peExportImage,
} from "../../../tests/fixtures/binaryDiagnostics/nativeExports.js";
import { freezeJsonSnapshot } from "../../domain/immutableJson.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "../../domain/analysisView/analysisView.js";

const artifact = {
  path: "/fixtures/exports",
  sha256: "a".repeat(64),
  bytes: 2048,
};
const parent = (report: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"b".repeat(64)}`,
  operation: "inspect_native_exports",
  normalizedResult: report,
  limitations: [],
});
const project = (report: unknown, input: unknown) => {
  const result = projectAnalysisView(
    parent(report),
    analysisViewRequestSchema.parse(input),
  );
  if (!result.ok) throw result.error;
  return result.value;
};
const elf = () => {
  const report = parseNativeExports(
    elfExportImage({
      symbols: [
        { name: "same", version: 2, value: 0x1234n },
        { name: "other" },
        { name: "same", version: 0x8003, value: 0x1234n },
        { name: "cafÃ©" },
      ],
      versionDefinitions: ["libfixture.so", "V1", "V2"],
    }),
    artifact,
  );
  if (report.format !== "elf") throw new Error("Expected ELF fixture");
  return report;
};

it("keeps every ELF same-name/version alternative, source order and matching-page coordinates", () => {
  const report = elf();
  const input = {
    kind: "native-exports",
    collection: "exports",
    names: ["same", "same"],
    fields: ["name", "value", "version"],
    limit: 1,
  };
  expect(project(report, input)).toMatchObject({
    items: [
      {
        source_index: 0,
        name: "same",
        value: "0x1234",
        version: { index: 2, name: "V1", hidden: false },
      },
    ],
    exports: { export_count: 4, coverage: { status: "complete" } },
    coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
  });
  expect(project(report, { ...input, offset: 1 })).toMatchObject({
    items: [
      { source_index: 2, version: { index: 3, name: "V2", hidden: true } },
    ],
    coverage: { total: 2, next_offset: null, exhausted: true },
  });
  expect(
    project(report, { ...input, indices: [2, 2, 99], fields: [] }),
  ).toMatchObject({ items: [{ source_index: 2 }], coverage: { total: 1 } });
  expect(project(report, { ...input, names: [] })).toMatchObject({
    items: [],
    coverage: { status: "empty", total: 0 },
  });
});

it("qualifies projected names with exact encoding facts and normalizes historical omissions", () => {
  const report = elf();
  expect(
    project(report, {
      kind: "native-exports",
      collection: "exports",
      names: ["café"],
      fields: ["name"],
    }),
  ).toMatchObject({
    items: [
      {
        source_index: 3,
        name: "café",
        name_bytes_base64: "Y2Fmw6k=",
        name_utf8_decodable: true,
      },
    ],
  });
  const historical = {
    ...report,
    exports: report.exports.map(
      ({ name_bytes_base64: _bytes, name_utf8_decodable: _utf8, ...row }) =>
        row,
    ),
  };
  freezeJsonSnapshot(historical);
  const input = { ...parent(historical), sealedResult: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = projectAnalysisView(
      input,
      analysisViewRequestSchema.parse({
        kind: "native-exports",
        collection: "exports",
        indices: [3],
        fields: ["name"],
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      items: [
        { name: "café", name_bytes_base64: null, name_utf8_decodable: null },
      ],
    });
  }
});

it("matches ELF UTF-8 identities without conflating Latin-1 display names or unknown encodings", () => {
  const report = parseNativeExports(
    elfExportImage({
      symbols: [{ name: "cafÃ©" }, { name: "café" }, { name: "same" }],
    }),
    artifact,
  );
  expect(
    project(report, {
      kind: "native-exports",
      collection: "exports",
      names: ["café"],
      fields: ["name"],
    }),
  ).toMatchObject({
    items: [{ source_index: 0, name: "café", name_utf8_decodable: true }],
    coverage: { total: 1 },
  });
  if (report.format !== "elf") throw new Error("Expected ELF fixture");
  const historical = {
    ...report,
    exports: report.exports.map(
      ({ name_bytes_base64: _bytes, name_utf8_decodable: _utf8, ...row }) =>
        row,
    ),
  };
  expect(
    project(historical, {
      kind: "native-exports",
      collection: "exports",
      names: ["café"],
    }),
  ).toMatchObject({
    items: [],
    unknowns: [expect.stringContaining("lack retained encoding facts")],
  });
  expect(
    project(historical, {
      kind: "native-exports",
      collection: "exports",
      names: [],
    }),
  ).toMatchObject({ items: [], unknowns: [] });
  const missingBytes = {
    ...report,
    exports: report.exports.map((row) => ({ ...row, name_bytes_base64: null })),
  };
  expect(
    project(missingBytes, {
      kind: "native-exports",
      collection: "exports",
      names: ["café", "same"],
      fields: [],
    }),
  ).toMatchObject({
    items: [{ source_index: 2 }],
    unknowns: [expect.stringContaining("lack retained encoding facts")],
  });
});

it("does not fill historical name defaults into a projection that omits names", () => {
  const result = project(elf(), {
    kind: "native-exports",
    collection: "exports",
    names: ["same"],
    fields: ["value"],
  });
  expect(result).toHaveProperty("items", [
    { source_index: 0, value: "0x1234" },
    { source_index: 2, value: "0x1234" },
  ]);
  const { view_digest, ...content } = result;
  expect(view_digest).toBe(digestCanonicalValue(content, "Analysis view"));
});

it.each(["Y2Fmw6k", "Y2Fmw6l=", "not base64"])(
  "rejects untrustworthy imported ELF name bytes %s before selection",
  (encoded) => {
    for (const target of ["symbol", "version"]) {
      const report = elf();
      const row = report.exports[0]!;
      if (target === "symbol") row.name_bytes_base64 = encoded;
      else if (typeof row.version === "object" && row.version !== null)
        row.version.name_bytes_base64 = encoded;
      const result = projectAnalysisView(
        parent(report),
        analysisViewRequestSchema.parse({
          kind: "native-exports",
          collection: "exports",
          names: ["missing"],
        }),
      );
      expect(result.ok).toBe(false);
    }
  },
);

it.each(["text", "encoding"])(
  "rejects contradictory ELF %s facts at the source owner",
  (fact) => {
    for (const target of ["symbol", "version"]) {
      const report = elf();
      const row = report.exports[0]!;
      const name = target === "symbol" ? row : row.version;
      if (name === null || typeof name !== "object")
        throw new Error("Expected named ELF row");
      name.name_bytes_base64 = Buffer.from(name.name!).toString("base64");
      if (fact === "text") name.name = "different";
      else name.name_utf8_decodable = false;
      expect(
        projectAnalysisView(
          parent(report),
          analysisViewRequestSchema.parse({
            kind: "native-exports",
            collection: "exports",
            names: ["missing"],
          }),
        ).ok,
      ).toBe(false);
    }
  },
);

it("preserves PE ordinal-only, forwarder, alias and same-address distinctions", () => {
  const report = parseNativeExports(
    peExportImage({
      ordinalBase: 65536,
      functions: [
        { rva: 0x2000 },
        { forwarder: "other.Target" },
        { rva: 0x2000 },
      ],
      names: [
        { name: "AliasA", index: 0 },
        { name: "AliasB", index: 0 },
        { name: "Forwarded", index: 1 },
      ],
    }),
    artifact,
  );
  const result = project(report, {
    kind: "native-exports",
    collection: "exports",
    offset: 1,
    limit: 9,
  });
  expect(result).toMatchObject({
    items: [
      {
        source_index: 1,
        name: "AliasB",
        ordinal: 65536,
        address: "0x180002000",
        forwarder: null,
      },
      {
        source_index: 2,
        name: "Forwarded",
        ordinal: 65537,
        address: null,
        forwarder: "other.Target",
      },
      {
        source_index: 3,
        name: null,
        ordinal: 65538,
        address: "0x180002000",
        forwarder: null,
      },
    ],
  });
});

it.each(["partial", "unsupported"] as const)(
  "keeps %s source coverage in empty pages and exposes complete issues",
  (status) => {
    const report = elf();
    report.coverage = {
      ...report.coverage,
      status,
      reason: "Selected tables remain incomplete",
    };
    report.issues = [
      {
        code: "table_unavailable",
        location: null,
        message: "Unobserved table",
      },
    ];
    expect(
      project(report, {
        kind: "native-exports",
        collection: "exports",
        names: ["missing"],
      }),
    ).toMatchObject({
      items: [],
      coverage: { status: "empty", total: 0 },
      exports: {
        coverage: { status, reason: "Selected tables remain incomplete" },
        issue_count: 1,
      },
      unknowns: ["Selected tables remain incomplete"],
    });
    expect(
      project(report, { kind: "native-exports", collection: "issues" }),
    ).toMatchObject({
      items: [
        {
          source_index: 0,
          code: "table_unavailable",
          location: null,
          message: "Unobserved table",
        },
      ],
    });
  },
);

it("revalidates mutable imports and refuses inconsistent coverage and format-incompatible fields", () => {
  const report = elf();
  const input = { ...parent(report), sealedResult: true };
  expect(projectAnalysisView(input, { kind: "summary" }).ok).toBe(true);
  Object.freeze(report);
  report.coverage.exports = 99;
  expect(projectAnalysisView(input, { kind: "summary" }).ok).toBe(false);
  expect(
    projectAnalysisView(
      parent(elf()),
      analysisViewRequestSchema.parse({
        kind: "native-exports",
        collection: "exports",
        fields: ["ordinal"],
      }),
    ).ok,
  ).toBe(false);
  expect(projectAnalysisView(parent({}), { kind: "summary" }).ok).toBe(false);
});
