import { describe, expect, it } from "vitest";

import {
  CPU,
  arArchive,
  fatImage,
  machoImage,
} from "../apple/MachoImage.fixture.js";
import {
  createArtifactEdges,
  classifyArtifactContent,
  createOccurrence,
  indexDestinationOccurrencesByPath,
  resolveOccurrenceParents,
} from "./ArtifactGraphConstruction.js";
import { createArtifactClassificationProbe } from "../ArtifactClassificationProbe.js";
import { artifactIdForContent } from "../../domain/artifactIdentity.js";
import { pe } from "../../domain/binaryTarget.fixture.js";
import type { ArtifactEntry } from "../ArtifactReader.js";
import { dfuseFile } from "../../domain/firmware/dfuse.fixture.js";
import {
  RP2040_FAMILY,
  patternBytes,
  uf2File,
  uf2Image,
} from "../../domain/firmware/uf2.fixture.js";

import { classifyArtifactBytesAtPath } from "../../../tests/fixtures/artifactClassification.js";
import {
  ESP32C3_APP_SEGMENTS,
  esp8266Image,
  espImage,
} from "../../../tests/fixtures/espImage.js";
import { devicetreeFixture } from "../../firmware/devicetree/Devicetree.fixture.js";
import { fitFixture } from "../fit/FitImage.fixture.js";

it("joins only observed PE signature bytes across stream chunks", () => {
  const bytes = pe(0x8664, 8190);
  const probe = createArtifactClassificationProbe();
  probe.write(bytes.subarray(0, 8191));
  probe.write(bytes.subarray(8191, 8192));
  const partial = probe.finish(bytes.length);
  expect(partial.mzWindowsHeaderSignature).toEqual({
    offset: 8190,
    bytes: Buffer.from("PE"),
  });
  expect(
    classifyArtifactContent("native.exe", partial, bytes.length).format,
  ).toBe("unknown");
  probe.write(bytes.subarray(8192));
  const complete = probe.finish(bytes.length);
  expect(complete.mzWindowsHeaderSignature).toEqual({
    offset: 8190,
    bytes: Buffer.from([0x50, 0x45, 0, 0]),
  });
  expect(
    classifyArtifactContent("native.exe", complete, bytes.length).format,
  ).toBe("pe");
});

it("classifies original DOS header padding as an executable", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(128, 2);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(28, 24);
  bytes.write("ABCD", 60, "ascii");
  expect(classifyArtifactBytesAtPath("legacy.exe", bytes)).toEqual({
    kind: "executable",
    format: "dos-mz",
  });
});

const entry = (path: string, kind: ArtifactEntry["kind"]): ArtifactEntry => ({
  path,
  kind,
  declaredSize: null,
  compressedSize: null,
  executable: false,
  encrypted: false,
  byteOffset: null,
  declaredIntegrity: null,
  unpacked: false,
  limitations: [],
  adapterKey: path,
});

it.each([false, true])(
  "preserves ASAR file storage (unpacked=%s)",
  (unpacked) => {
    const occurrence = createOccurrence(
      { ...entry("main.js", "file"), unpacked },
      "main.js",
      null,
      { sourceFormat: "asar" },
    );
    expect(occurrence.unpacked).toBe(unpacked);
  },
);

it.each(["directory", "symlink"] as const)(
  "preserves positive ASAR declarations for %s entries",
  (kind) => {
    for (const unpacked of [false, true]) {
      const occurrence = createOccurrence(
        { ...entry("member", kind), unpacked },
        "member",
        null,
        { sourceFormat: "asar" },
      );
      if (unpacked) expect(occurrence.unpacked).toBe(true);
      else expect(occurrence).not.toHaveProperty("unpacked");
    }
  },
);

it.each(["directory", "zip", "node-sea"] as const)(
  "omits false storage declarations for %s readers",
  (sourceFormat) => {
    const occurrence = createOccurrence(
      entry("main.js", "file"),
      "main.js",
      null,
      {
        sourceFormat,
      },
    );
    expect(occurrence).not.toHaveProperty("unpacked");
  },
);

it("preserves a positive storage declaration without reader format", () => {
  const occurrence = createOccurrence(
    { ...entry("main.js", "file"), unpacked: true },
    "main.js",
    null,
  );
  expect(occurrence.unpacked).toBe(true);
});

describe("occurrence parent ownership", () => {
  it("selects the nearest unique nested parent", () => {
    const outer = createOccurrence(entry("a", "directory"), "a", null);
    const inner = createOccurrence(entry("a/b", "directory"), "a/b", null);
    const file = createOccurrence(entry("a/b/file", "file"), "a/b/file", null);
    const occurrences = [outer, inner, file];

    resolveOccurrenceParents(
      occurrences,
      indexDestinationOccurrencesByPath(occurrences),
      new Set(),
    );

    expect(file.parent_occurrence_id).toBe(inner.occurrence_id);
  });

  it("leaves a child unparented when duplicate directories make ownership ambiguous", () => {
    const first = createOccurrence(entry("a", "directory"), "a", null, {
      duplicateOrdinal: 0,
    });
    const second = createOccurrence(entry("a", "directory"), "a", null, {
      duplicateOrdinal: 1,
    });
    const file = createOccurrence(entry("a/file", "file"), "a/file", null);
    const occurrences = [first, second, file];

    const resolution = resolveOccurrenceParents(
      occurrences,
      indexDestinationOccurrencesByPath(occurrences),
      new Set(),
    );

    expect(file.parent_occurrence_id).toBeNull();
    expect(resolution.unknownParentOccurrences.has(file)).toBe(true);
    expect(resolution.limitations).toContain(
      'The parent occurrence for "a/file" is unknown because multiple observed directory or container occurrences share "a".',
    );
    expect([first, second].map(({ hash_status }) => hash_status)).toEqual([
      "unavailable",
      "unavailable",
    ]);
  });
});

describe("source-map artifact relationships", () => {
  const contentId = (digit: string): string =>
    artifactIdForContent(digit.repeat(64));

  it.each([
    ["missing target", [] as string[], "contains"],
    ["unread target", ["unread"] as string[], "contains"],
    ["unique identified target", ["identified"] as string[], "maps-source"],
    ["duplicate targets", ["identified", "identified"] as string[], "contains"],
  ] as const)(
    "uses a truthful edge for a %s",
    (_label, targetIdentities, relation) => {
      const directory = createOccurrence(
        entry("app", "directory"),
        "app",
        null,
      );
      directory.artifact_id = contentId("1");
      const targets = targetIdentities.map((identity, index) => {
        const target = createOccurrence(
          entry("app/main.js", "file"),
          "app/main.js",
          directory.occurrence_id,
          { duplicateOrdinal: index },
        );
        target.artifact_id = identity === "unread" ? null : contentId("2");
        return target;
      });
      const sourceMap = createOccurrence(
        entry("app/main.js.map", "file"),
        "app/main.js.map",
        directory.occurrence_id,
      );
      sourceMap.artifact_id = contentId("3");

      const result = createArtifactEdges(contentId("4"), [
        directory,
        ...targets,
        sourceMap,
      ]);
      const edge = result.edges.find(
        ({ occurrence_id }) => occurrence_id === sourceMap.occurrence_id,
      );

      expect(edge).toMatchObject({
        relation,
        parent_artifact_id:
          relation === "maps-source" ? contentId("2") : contentId("1"),
        occurrence_id: sourceMap.occurrence_id,
      });
      expect(result.limitations.length > 0).toBe(
        (targetIdentities.length === 1 && targetIdentities[0] === "unread") ||
          targetIdentities.length > 1,
      );
    },
  );

  it("keeps a directory named like a source map contained by its parent", () => {
    const archive = createOccurrence(entry("app", "directory"), "app", null);
    archive.artifact_id = contentId("1");
    const script = createOccurrence(
      entry("app/main.js", "file"),
      "app/main.js",
      archive.occurrence_id,
    );
    script.artifact_id = contentId("2");
    const directory = createOccurrence(
      entry("app/main.js.map", "directory"),
      "app/main.js.map",
      archive.occurrence_id,
    );
    directory.artifact_id = contentId("3");

    const { edges, limitations } = createArtifactEdges(contentId("4"), [
      archive,
      script,
      directory,
    ]);

    expect(directory).toMatchObject({
      artifact_kind: "container",
      artifact_format: "directory",
    });
    expect(
      edges.find(
        ({ occurrence_id }) => occurrence_id === directory.occurrence_id,
      ),
    ).toMatchObject({
      relation: "contains",
      parent_artifact_id: contentId("1"),
    });
    expect(limitations).toEqual([]);
  });
});

const fat = (wide = false): Buffer =>
  Buffer.from(fatImage([{ cpu: CPU.arm64, bytes: machoImage({}) }], wide));

const expectStreamedFatClassification = (testCase: {
  readonly slices: readonly {
    readonly cpu: { readonly type: number; readonly subtype: number };
    readonly bytes: Uint8Array;
  }[];
  readonly expected: string;
}): void => {
  const bytes = Buffer.alloc(24_128);
  const offsets = testCase.slices.map((_, index) => 20_000 + index * 4_000);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(testCase.slices.length, 4);
  testCase.slices.forEach((slice, index) => {
    const entry = 8 + index * 20;
    const sliceOffset = offsets[index]!;
    bytes.writeUInt32BE(slice.cpu.type, entry);
    bytes.writeUInt32BE(slice.cpu.subtype, entry + 4);
    bytes.writeUInt32BE(sliceOffset, entry + 8);
    bytes.writeUInt32BE(slice.bytes.length, entry + 12);
    bytes.writeUInt32BE(0, entry + 16);
    Buffer.from(slice.bytes).copy(bytes, sliceOffset);
  });

  const probe = createArtifactClassificationProbe();
  const boundaries = [
    8_192,
    ...offsets.flatMap((offset) => [offset + 3, offset + 4]),
    bytes.length,
  ].sort((left, right) => left - right);
  let previous = 0;
  for (const boundary of boundaries) {
    if (boundary <= previous) continue;
    probe.write(bytes.subarray(previous, boundary));
    previous = boundary;
  }
  const evidence = probe.finish(bytes.length);
  expect(evidence.prefix.length).toBeLessThan(bytes.length);
  expect(classifyArtifactContent("native", evidence, bytes.length).format).toBe(
    testCase.expected,
  );
};

describe("bounded FAT inventory classification", () => {
  it("requires the complete table and an observed slice header", () => {
    const bytes = fat();
    for (const length of [4, 7, 8, 27]) {
      expect(
        classifyArtifactBytesAtPath(
          "native",
          bytes.subarray(0, length),
          bytes.length,
        ),
      ).toEqual({ kind: "unknown", format: "unknown" });
    }
    expect(
      classifyArtifactBytesAtPath(
        "native.class",
        bytes.subarray(0, 28),
        bytes.length,
      ),
    ).toEqual({ kind: "unknown", format: "unknown" });
    expect(classifyArtifactBytesAtPath("native.class", bytes)).toEqual({
      kind: "executable",
      format: "mach-o-universal",
    });
  });

  it("does not classify known-CPU FAT archive slices as Mach-O", () => {
    const archive = arArchive();
    const bytes = Buffer.from(
      fatImage([
        { cpu: CPU.x86_64, bytes: archive },
        { cpu: CPU.arm64, bytes: archive },
      ]),
    );
    expect(classifyArtifactBytesAtPath("libfat.a", bytes)).toEqual({
      kind: "unknown",
      format: "unknown",
    });
  });

  it.each([
    ["empty table", (bytes: Buffer) => bytes.writeUInt32BE(0, 4)],
    ["slice overlapping table", (bytes: Buffer) => bytes.writeUInt32BE(0, 16)],
    ["empty slice", (bytes: Buffer) => bytes.writeUInt32BE(0, 20)],
    [
      "slice beyond file",
      (bytes: Buffer) => bytes.writeUInt32BE(bytes.length, 20),
    ],
    ["unaligned slice", (bytes: Buffer) => bytes.writeUInt32BE(4097, 16)],
    ["unsupported alignment", (bytes: Buffer) => bytes.writeUInt32BE(53, 24)],
  ] as const)("keeps %s unknown", (_label, mutate) => {
    const bytes = fat();
    mutate(bytes);
    expect(classifyArtifactBytesAtPath("native", bytes)).toEqual({
      kind: "unknown",
      format: "unknown",
    });
  });

  it("does not infer Mach-O from an out-of-bounds architecture count", () => {
    const bytes = fat();
    bytes.writeUInt32BE(0xffffffff, 4);
    expect(classifyArtifactBytesAtPath("native", bytes)).toEqual({
      kind: "resource",
      format: "file",
    });
  });

  it("does not lose unsafe FAT64 range values to number conversion", () => {
    const bytes = fat(true);
    bytes.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 16);
    expect(classifyArtifactBytesAtPath("native", bytes)).toEqual({
      kind: "unknown",
      format: "unknown",
    });
  });

  it("requires valid ranges for every declared slice", () => {
    const bytes = Buffer.from(
      fatImage([
        { cpu: CPU.arm64, bytes: machoImage({}) },
        { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
      ]),
    );
    bytes.writeUInt32BE(bytes.length, 40);
    expect(classifyArtifactBytesAtPath("native", bytes)).toEqual({
      kind: "unknown",
      format: "unknown",
    });
  });

  it("requires observed slice magic for an unknown CPU type", () => {
    const cpu = { type: 0x12345678, subtype: 0 };
    const bytes = Buffer.from(fatImage([{ cpu, bytes: machoImage({ cpu }) }]));
    expect(
      classifyArtifactBytesAtPath(
        "native",
        bytes.subarray(0, 28),
        bytes.length,
      ),
    ).toEqual({ kind: "unknown", format: "unknown" });
    expect(classifyArtifactBytesAtPath("native", bytes)).toEqual({
      kind: "executable",
      format: "mach-o-universal",
    });
  });

  it("classifies distant FAT headers from bounded streaming observations", () => {
    const cases = [
      {
        name: "Mach-O",
        slices: [{ cpu: CPU.arm64, bytes: machoImage({}) }],
        expected: "mach-o-universal",
      },
      {
        name: "archive",
        slices: [{ cpu: CPU.arm64, bytes: arArchive() }],
        expected: "unknown",
      },
      {
        name: "mixed Mach-O and archive",
        slices: [
          { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
          { cpu: CPU.arm64, bytes: arArchive() },
        ],
        expected: "unknown",
      },
    ] as const;
    for (const testCase of cases) expectStreamedFatClassification(testCase);
  });
});

it("keeps byte content format separate from path-specific package role", () => {
  const probe = createArtifactClassificationProbe();
  probe.write(Buffer.from("PK\x03\x04", "binary"));
  expect(
    classifyArtifactContent("application.apk", probe.finish(4), 4),
  ).toEqual({
    kind: "container",
    format: "apk",
    contentFormat: "zip",
  });
});

it("classifies nested HEX and S-record content as containers by bytes", () => {
  expect(
    classifyArtifactBytesAtPath(
      "firmware/update.txt",
      Buffer.from(":0300300002337A1E\n:00000001FF\n"),
    ),
  ).toEqual({ kind: "container", format: "intel-hex" });
  expect(
    classifyArtifactBytesAtPath(
      "firmware/app.s19",
      Buffer.from("S00600004844521B\n"),
    ),
  ).toEqual({ kind: "container", format: "srec" });
  expect(
    classifyArtifactBytesAtPath(
      "firmware/bad.hex",
      Buffer.from(":0300300002337A1F\n"),
    ),
  ).toEqual({ kind: "resource", format: "file" });
});

it("classifies nested ESP images as containers by bytes", () => {
  const image = espImage({ segments: ESP32C3_APP_SEGMENTS });
  expect(classifyArtifactBytesAtPath("ota/update.dat", image)).toEqual({
    kind: "container",
    format: "esp-image",
  });
  // An unsupported ESP8266 image is a plain file, not a container.
  expect(classifyArtifactBytesAtPath("esp8266.bin", esp8266Image())).toEqual({
    kind: "resource",
    format: "file",
  });
});

it("classifies nested UF2 by block magics and DfuSe by prefix and suffix", () => {
  const uf2 = uf2File(uf2Image(RP2040_FAMILY, 0x1000_0000, patternBytes(300)));
  expect(classifyArtifactBytesAtPath("firmware/update.bin", uf2)).toEqual({
    kind: "container",
    format: "uf2",
  });
  expect(
    classifyArtifactBytesAtPath("firmware/short.uf2", uf2.subarray(0, 511)),
  ).toEqual({ kind: "resource", format: "file" });
  const dfu = dfuseFile({
    targets: [{ alternateSetting: 0, elements: [{ address: 0, data: [1] }] }],
  });
  // The prefix alone is not DfuSe; the suffix is observed at the stream end.
  expect(classifyArtifactBytesAtPath("firmware/update.dfu", dfu)).toEqual({
    kind: "resource",
    format: "file",
  });
  const probe = createArtifactClassificationProbe();
  for (let offset = 0; offset < dfu.length; offset += 5)
    probe.write(dfu.subarray(offset, offset + 5));
  expect(
    classifyArtifactContent(
      "firmware/update.bin",
      probe.finish(dfu.length),
      dfu.length,
    ),
  ).toMatchObject({ kind: "container", format: "dfuse" });
  // Bytes the probe never saw may follow, so it reports no suffix at all.
  const partial = probe.finish(dfu.length + 1);
  expect(partial.suffix).toBeUndefined();
  expect(
    classifyArtifactContent("firmware/update.bin", partial, dfu.length + 1),
  ).toMatchObject({ format: "file" });
});

it("classifies a FIT by a /images node within the first 4 KiB", () => {
  const images = [{ name: "kernel", data: Buffer.from("kernel") }];
  const late = devicetreeFixture({
    name: "",
    properties: { padding: Buffer.alloc(4096) },
    children: [{ name: "images" }],
  });
  const configurationsFirst = devicetreeFixture({
    name: "",
    children: [{ name: "configurations" }, { name: "images" }],
  });
  for (const [path, bytes] of [
    ["firmware/boot.itb", fitFixture({ images })],
    ["firmware/boot", configurationsFirst],
  ] as const)
    expect(classifyArtifactBytesAtPath(path, bytes)).toEqual({
      kind: "container",
      format: "fit",
    });
  for (const bytes of [
    devicetreeFixture(),
    fitFixture({ images, version: 15 }),
    late,
  ])
    expect(classifyArtifactBytesAtPath("firmware/board.dtb", bytes)).toEqual({
      kind: "resource",
      format: "file",
    });
});

describe("FAT prefix observation coverage", () => {
  it("does not invent an observation for a header beyond the retained prefix", () => {
    const bytes = Buffer.alloc(8_224);
    bytes.writeUInt32BE(0xcafebabe, 0);
    bytes.writeUInt32BE(2, 4);
    for (const [index, slice] of [
      { cpu: CPU.x86_64, offset: 4_096 },
      { cpu: CPU.arm64, offset: 8_192 },
    ].entries()) {
      const entry = 8 + index * 20;
      bytes.writeUInt32BE(slice.cpu.type, entry);
      bytes.writeUInt32BE(slice.cpu.subtype, entry + 4);
      bytes.writeUInt32BE(slice.offset, entry + 8);
      bytes.writeUInt32BE(32, entry + 12);
      bytes.writeUInt32BE(12, entry + 16);
      bytes.writeUInt32LE(0xfeedfacf, slice.offset);
      bytes.writeUInt32LE(slice.cpu.type, slice.offset + 4);
      bytes.writeUInt32LE(slice.cpu.subtype, slice.offset + 8);
    }

    const probe = createArtifactClassificationProbe();
    probe.write(bytes.subarray(0, 8_192));
    const evidence = probe.finish(bytes.length);

    expect(
      evidence.fatSliceHeaders?.sliceHeadersByOffset.get(4_096)?.magic,
    ).toBe(0xcffaedfe);
    expect(evidence.fatSliceHeaders?.sliceHeadersByOffset.has(8_192)).toBe(
      false,
    );
  });
});

describe("bounded FAT inventory classification", () => {
  it.each([NaN, Infinity, -1, 8.5, Number.MAX_SAFE_INTEGER + 1, 27])(
    "keeps invalid or contradictory file size %s unknown",
    (size) => {
      const bytes = fat();
      expect(classifyArtifactBytesAtPath("native", bytes, size)).toEqual({
        kind: "unknown",
        format: "unknown",
      });
    },
  );
});

it("preserves path-selected inventory roles for XML content", () => {
  const xml = Buffer.from(
    '<?xml version="1.0"?><plist version="1.0"><dict/></plist>',
  );
  expect(classifyArtifactBytesAtPath("state.archive", xml)).toEqual({
    kind: "plist",
    format: "plist",
  });
  expect(classifyArtifactBytesAtPath("state.js", xml)).toEqual({
    kind: "javascript",
    format: "javascript-bundle",
  });
  expect(classifyArtifactBytesAtPath("state.map", xml)).toEqual({
    kind: "source-map",
    format: "source-map",
  });
  expect(classifyArtifactBytesAtPath("state.asar", xml)).toEqual({
    kind: "resource",
    format: "file",
  });
});
