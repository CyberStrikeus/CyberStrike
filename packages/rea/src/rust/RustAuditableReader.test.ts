import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { rustAuditableMetadataSchema } from "../domain/rust/rustBinary.js";
import {
  RUST_SECTION_BYTES,
  readAuditableSection,
  RustAuditableFormatFailure,
  RustAuditableResourceFailure,
} from "./RustAuditableReader.js";

const section = (document: unknown) =>
  readAuditableSection(
    ".dep-v0",
    0,
    deflateSync(Buffer.from(JSON.stringify(document))),
  );
const sectionJson = (document: string) =>
  readAuditableSection(".dep-v0", 0, deflateSync(Buffer.from(document)));

it("preserves package order, omitted kind, and the root index", () => {
  const parsed = section({
    packages: [
      { name: "itoa", version: "1.0.18", source: "crates.io" },
      {
        name: "sample",
        version: "0.1.0",
        source: "local",
        dependencies: [0],
        root: true,
        kind: "runtime",
      },
    ],
    format: 1,
  });
  expect(parsed).toMatchObject({
    section_name: ".dep-v0",
    format_version: 1,
    root_package_index: 1,
    compressed_bytes: parsed.section_bytes,
    packages: [
      {
        name: "itoa",
        version: "1.0.18",
        source: "crates.io",
        kind: null,
        dependencies: [],
        root: false,
      },
      {
        name: "sample",
        version: "0.1.0",
        kind: "runtime",
        dependencies: [0],
        root: true,
      },
    ],
    dependency_edges: [{ from_index: 1, to_index: 0 }],
    cyclic_dependency_indices: [],
  });
  expect(parsed.uncompressed_bytes).toBeGreaterThan(parsed.compressed_bytes);
});

it("preserves historical cargo-auditable feature lists and rejects bad values", () => {
  const parsed = section({
    format: 0,
    packages: [
      {
        name: "feature_dep",
        version: "1.2.3",
        source: "crates.io",
        features: ["default", "serde"],
      },
    ],
  });
  expect(parsed.packages).toEqual([
    {
      name: "feature_dep",
      version: "1.2.3",
      source: "crates.io",
      kind: null,
      dependencies: [],
      features: ["default", "serde"],
      root: false,
    },
  ]);
  const omitted = section({
    packages: [{ name: "no_features", version: "1", source: "crates.io" }],
  });
  const explicitEmpty = section({
    packages: [
      {
        name: "no_features",
        version: "1",
        source: "crates.io",
        features: [],
      },
    ],
  });
  expect(omitted.packages[0]?.features).toBeNull();
  expect(explicitEmpty.packages[0]?.features).toEqual([]);
  expect(() =>
    section({
      packages: [
        {
          name: "feature_dep",
          version: "1.2.3",
          source: "crates.io",
          features: ["default", 7],
        },
      ],
    }),
  ).toThrow(RustAuditableFormatFailure);
});

it("reports dependency cycles and keeps an omitted format version unknown", () => {
  const parsed = section({
    packages: [
      { name: "a", version: "1", source: "local", dependencies: [1] },
      { name: "b", version: "1", source: "local", dependencies: [0] },
    ],
  });
  expect(parsed.cyclic_dependency_indices).toEqual([0, 1]);
  expect(parsed.format_version).toBeNull();
  expect(parsed.root_package_index).toBeNull();
});

it("includes every package that participates in a dependency cycle", () => {
  const parsed = section({
    packages: [
      { name: "a", version: "1", source: "local", dependencies: [1, 2] },
      { name: "b", version: "1", source: "local", dependencies: [0] },
      { name: "c", version: "1", source: "local", dependencies: [1] },
    ],
  });
  expect(parsed.cyclic_dependency_indices).toEqual([0, 1, 2]);
  const self = section({
    packages: [{ name: "a", version: "1", source: "local", dependencies: [0] }],
  });
  expect(self.cyclic_dependency_indices).toEqual([0]);
});

it("finishes a long acyclic dependency chain", () => {
  const count = 20_000;
  const parsed = section({
    packages: Array.from({ length: count }, (_, index) => ({
      name: `p${index.toString(36)}`,
      version: "1",
      source: "local",
      ...(index + 1 < count ? { dependencies: [index + 1] } : {}),
    })),
  });
  expect(parsed.packages).toHaveLength(count);
  expect(parsed.cyclic_dependency_indices).toEqual([]);
});

it("rejects out-of-range indices, multiple roots, and schema drift", () => {
  expect(() =>
    section({
      packages: [
        { name: "a", version: "1", source: "local", dependencies: [2] },
      ],
    }),
  ).toThrow(RustAuditableFormatFailure);
  expect(() =>
    section({
      packages: [
        { name: "a", version: "1", source: "local", root: true },
        { name: "b", version: "1", source: "local", root: true },
      ],
    }),
  ).toThrow(/more than one root/);
  expect(() =>
    section({
      packages: [{ name: "a", version: "1", source: "local" }],
      extra: true,
    }),
  ).toThrow(/package schema/);
});

it("rejects invalid JSON, trailing zlib bytes, and an empty section", () => {
  expect(() =>
    readAuditableSection(".dep-v0", 0, deflateSync(Buffer.from("{"))),
  ).toThrow(/JSON is invalid/);
  const trailed = Buffer.concat([
    deflateSync(Buffer.from('{"packages":[]}')),
    Buffer.from([0]),
  ]);
  expect(() => readAuditableSection(".dep-v0", 0, trailed)).toThrow(
    /zlib stream/,
  );
  expect(() => readAuditableSection(".dep-v0", 0, Buffer.alloc(0))).toThrow(
    /empty/,
  );
  expect(() =>
    readAuditableSection(".dep-v0", 0, Buffer.from([1, 2, 3])),
  ).toThrow(RustAuditableFormatFailure);
});

it("rejects duplicate decoded JSON fields before object conversion", () => {
  for (const document of [
    '{"packages":[],"packages":[]}',
    '{"packages":[{"name":"alpha","name":"beta","version":"1","source":"local"}]}',
    '{"packages":[{"name":"alpha","version":"1","source":"local","dependencies":[0],"dependencies":[]}]}',
    '{"packages":[],"meta":{"name":"alpha","na\\u006de":"beta"}}',
  ])
    expect(() => sectionJson(document)).toThrow(
      /duplicate field "(?:packages|name|dependencies)"/u,
    );
  expect(
    sectionJson(
      '{"packages":[{"name":"alpha","version":"1","source":"local"}]}',
    ).packages,
  ).toHaveLength(1);
});

it("stops an inflate that exceeds the section ratio", () => {
  const raw = Buffer.alloc(8000);
  const compressed = deflateSync(raw);
  expect(compressed.length * 64).toBeLessThan(raw.length);
  expect(() => readAuditableSection(".dep-v0", 0, compressed)).toThrow(
    RustAuditableResourceFailure,
  );
  expect(() =>
    readAuditableSection(".dep-v0", 0, Buffer.alloc(RUST_SECTION_BYTES + 1)),
  ).toThrow(/1 MiB/);
});

it("retains the compressed-stream limit for a PE section with padding", () => {
  const compressed = deflateSync(Buffer.alloc(RUST_SECTION_BYTES), {
    level: 0,
  });
  expect(compressed.length).toBeGreaterThan(RUST_SECTION_BYTES);
  const fileAlignment = 512;
  const stored = Buffer.alloc(
    Math.ceil(compressed.length / fileAlignment) * fileAlignment,
  );
  compressed.copy(stored);
  expect(() =>
    readAuditableSection(".dep-v0", 0, stored, {
      peFileAlignment: fileAlignment,
    }),
  ).toThrow(
    expect.objectContaining({
      constraint: {
        resource: "memory",
        reported_limits: { maximum_bytes: RUST_SECTION_BYTES },
      },
    }),
  );
});

it.each([0, 8])("reads documented cargo-auditable revision %i", (format) => {
  const parsed = section({
    format,
    packages: [
      { name: "sample", version: "0.1.0", source: "local", root: true },
    ],
  });
  expect(parsed).toMatchObject({
    format_version: format,
    root_package_index: 0,
  });
  expect(rustAuditableMetadataSchema.parse(parsed)).toEqual(parsed);
});

it.each([{ source: 4 }, { source: 9 }, { source: 99 }])(
  "preserves unknown revision $source for the documented preceding-revision interpretation",
  ({ source }) => {
    const parsed = section({
      format: source,
      packages: [
        { name: "sample", version: "0.1.0", source: "local", root: true },
      ],
    });
    expect(parsed).toMatchObject({
      format_version: source,
    });
    expect(rustAuditableMetadataSchema.parse(parsed)).toEqual(parsed);
  },
);

it("rejects unknown package fields even for a forward-compatible revision", () => {
  expect(() =>
    section({
      format: 99,
      packages: [
        { name: "sample", version: "0.1.0", source: "local", future: true },
      ],
    }),
  ).toThrow(/package schema/);
});

it.each([-1, 1.5, 0x1_0000_0000])(
  "rejects invalid cargo-auditable format value %s",
  (format) => {
    expect(() => section({ format, packages: [] })).toThrow(
      expect.objectContaining({
        name: "RustAuditableFormatFailure",
        kind: "malformed",
      }),
    );
  },
);

it("rejects the first malformed package before schema issues accumulate", () => {
  const stored = (document: unknown) =>
    deflateSync(Buffer.from(JSON.stringify(document)), { level: 0 });
  const emptyPackages = stored({
    format: 1,
    packages: Array.from({ length: 80_000 }, () => ({})),
  });
  expect(emptyPackages.length).toBeLessThan(RUST_SECTION_BYTES);
  expect(() => readAuditableSection(".dep-v0", 0, emptyPackages)).toThrow(
    /Dependency package 0 does not match the package schema/,
  );
  const invalidDependencies = stored({
    format: 1,
    packages: [
      {
        name: "a",
        version: "1",
        source: "local",
        dependencies: Array.from({ length: 1_000 }, () => null),
      },
    ],
  });
  expect(() => readAuditableSection(".dep-v0", 0, invalidDependencies)).toThrow(
    /Dependency package 0 does not match the package schema/,
  );
});

it("admits dependency expansion before allocating normalized or reverse edges", () => {
  const document = {
    packages: [
      {
        name: "a",
        version: "1",
        source: "local",
        dependencies: Array<number>(400_000).fill(0),
      },
    ],
  };
  // An uncompressed zlib stream clears the ratio guard while remaining below
  // the one-MiB section limit, isolating the graph representation admission.
  const payload = deflateSync(Buffer.from(JSON.stringify(document)), {
    level: 0,
  });
  expect(payload.length).toBeLessThan(RUST_SECTION_BYTES);
  expect(() => readAuditableSection(".dep-v0", 0, payload)).toThrow(
    expect.objectContaining({
      constraint: {
        resource: "transport",
        reported_limits: { maximum_output_bytes: 8 * 1024 * 1024 },
      },
    }),
  );
});
