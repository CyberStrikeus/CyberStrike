import { describe, expect, it } from "vitest";

import {
  cells,
  devicetreeFixture,
  dtString,
  type FixtureNode,
} from "../../firmware/devicetree/Devicetree.fixture.js";
import {
  FIT_EMBEDDED,
  FIT_KERNEL,
  fitFixture,
  type FitFixtureImage,
} from "./FitImage.fixture.js";
import {
  FIT_MAX_CONFIGURATION_REFERENCES,
  FIT_MAX_CONFIGURATIONS,
  FIT_MAX_HASH_NODES_PER_IMAGE,
  FIT_MAX_IMAGES,
  readFitStructure,
} from "./FitStructure.js";

const read = (file: Buffer) =>
  readFitStructure(
    file.subarray(0, file.readUInt32BE(4)),
    "test.itb",
    file.length,
  );

const failureOf = (file: Buffer): unknown => {
  try {
    read(file);
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected readFitStructure to fail");
};

const imageBytes = (file: Buffer, index: number): Buffer => {
  const image = read(file).images[index];
  if (image === undefined) throw new Error("Missing image");
  return file.subarray(image.start, image.start + image.size);
};

const kernel = (properties: Record<string, Buffer> = {}): FitFixtureImage => ({
  name: "kernel",
  data: FIT_KERNEL,
  properties,
});

const shared = (properties: Record<string, Buffer>): FitFixtureImage => ({
  name: "shared",
  data: Buffer.alloc(0),
  properties,
});

/** A FIT whose single image node carries exactly these properties. */
const singleImage = (properties: Record<string, Buffer>): Buffer =>
  devicetreeFixture({
    name: "",
    children: [{ name: "images", children: [{ name: "kernel", properties }] }],
  });

describe("FIT image facts", () => {
  it("preserves a leading U+FEFF in string facts and configuration references", () => {
    const structure = read(
      fitFixture({
        images: [kernel({ description: dtString("\uFEFFkernel description") })],
        configurations: {
          name: "configurations",
          properties: { default: dtString("\uFEFFconf-1") },
          children: [
            {
              name: "conf-1",
              properties: {
                kernel: dtString("\uFEFFkernel"),
                loadables: dtString("kernel\0\uFEFFkernel"),
              },
            },
          ],
        },
      }),
    );
    expect(structure.images[0]?.metadata.description).toBe(
      "\uFEFFkernel description",
    );
    expect(structure.metadata.default_configuration).toBe("\uFEFFconf-1");
    expect(structure.metadata.configurations[0]).toMatchObject({
      name: "conf-1",
      kernel: ["\uFEFFkernel"],
      loadables: ["kernel", "\uFEFFkernel"],
      unresolved_reference_count: 2,
    });
    expect(structure.limitations).toContain(
      "/configurations: default \uFEFFconf-1 names no configuration",
    );
  });

  it("decodes embedded root and image facts with property ranges", () => {
    const structure = read(FIT_EMBEDDED);
    expect(structure.metadata).toMatchObject({
      kind: "fit",
      fdt_version: 17,
      fdt_totalsize: FIT_EMBEDDED.length,
      description: "Test FIT",
      timestamp: 1_700_000_000,
      address_cells: 1,
    });
    expect(structure.images[0]?.metadata).toEqual({
      kind: "fit-image",
      index: 0,
      name: "kernel",
      description: "Linux kernel",
      type: "kernel",
      arch: "arm64",
      os: "linux",
      compression: "none",
      load: "0x40200000",
      entry: "0x40200000",
      data_source: "embedded",
      declared_offset: null,
      image_data: null,
      cipher_present: false,
      cipher_algo: null,
      unreadable_fields: [],
      hash_algorithms: ["crc32", "md5", "sha1", "sha256", "sha384", "sha512"],
      hashes_verified: 6,
      hashes_unverified: 0,
      signature_count: 0,
      signatures_unreadable: 0,
      signature_algorithms: [],
    });
    expect(structure.images[0]?.limitations).toEqual([]);
    expect(Buffer.compare(imageBytes(FIT_EMBEDDED, 0), FIT_KERNEL)).toBe(0);
  });

  it("bases data-offset at the aligned devicetree end and accepts gaps", () => {
    const file = fitFixture({
      images: [kernel(), { name: "second", data: Buffer.from("second") }],
      mode: "offset",
      align: 512,
    });
    const structure = read(file);
    const { fdt_totalsize: totalsize, external_data_base: base } =
      structure.metadata;
    expect(totalsize % 4).not.toBe(0);
    expect(base).toBe(Math.ceil(totalsize / 4) * 4);
    expect(
      structure.images.map((image) => [
        image.start,
        image.metadata.data_source,
        image.metadata.declared_offset,
      ]),
    ).toEqual([
      [base, "data-offset", 0],
      [base + 1024, "data-offset", 1024],
    ]);
    expect(Buffer.compare(imageBytes(file, 0), FIT_KERNEL)).toBe(0);
    expect(imageBytes(file, 1).toString()).toBe("second");
  });

  it("reads data-position as an absolute file offset", () => {
    const file = fitFixture({ images: [kernel()], mode: "position" });
    const [image] = read(file).images;
    expect(image?.metadata.data_source).toBe("data-position");
    expect(image?.start).toBe(image?.metadata.declared_offset);
    expect(Buffer.compare(imageBytes(file, 0), FIT_KERNEL)).toBe(0);
  });

  it("reports malformed descriptive facts as limitations", () => {
    const [image] = read(
      fitFixture({
        images: [
          kernel({ load: cells(1, 2, 3), arch: Buffer.from([0xff, 0]) }),
        ],
      }),
    ).images;
    expect(image?.metadata).toMatchObject({ load: null, arch: null });
    expect(image?.limitations).toEqual([
      "/images/kernel: arch is not a NUL-terminated UTF-8 string",
      "/images/kernel: load is not a 1- or 2-cell address",
    ]);
  });
});

describe("FIT image data ranges", () => {
  it("accepts an identical range linked by image-data", () => {
    const [target, linked] = read(
      fitFixture({
        images: [
          kernel(),
          shared({
            "image-data": dtString("kernel"),
            "data-offset": cells(0),
            "data-size": cells(FIT_KERNEL.length),
          }),
        ],
        mode: "offset",
      }),
    ).images;
    expect(linked?.start).toBe(target?.start);
    expect(linked?.metadata.image_data).toBe("kernel");
  });

  it.each([
    [
      "an unlinked identical range",
      { "data-offset": cells(0), "data-size": cells(1000) },
      "image data overlaps: /images/shared and /images/kernel",
    ],
    [
      "a dangling link",
      {
        "image-data": dtString("missing"),
        "data-offset": cells(0),
        "data-size": cells(1000),
      },
      "image-data names no image: missing",
    ],
    [
      "a mismatched link",
      {
        "image-data": dtString("kernel"),
        "data-offset": cells(0),
        "data-size": cells(999),
      },
      "data does not match its image-data target /images/kernel",
    ],
    [
      "a malformed link",
      {
        "image-data": dtString("a\0b"),
        "data-offset": cells(0),
        "data-size": cells(1000),
      },
      "image-data is not one string",
    ],
    [
      "a partial overlap",
      { "data-offset": cells(500), "data-size": cells(400) },
      "image data overlaps: /images/shared and /images/kernel",
    ],
    [
      "data past the end of the file",
      { "data-offset": cells(900), "data-size": cells(200) },
      "lies outside the",
    ],
  ])("fails %s", (_name, properties, message) => {
    expect(
      failureOf(
        fitFixture({ images: [kernel(), shared(properties)], mode: "offset" }),
      ),
    ).toMatchObject({
      reason: "format",
      message: expect.stringContaining(message),
    });
  });

  it("fails a chained image-data link", () => {
    const link = (target: string) => ({
      "image-data": dtString(target),
      "data-offset": cells(0),
      "data-size": cells(FIT_KERNEL.length),
    });
    expect(
      failureOf(
        fitFixture({
          images: [
            kernel(),
            shared(link("kernel")),
            { ...shared(link("shared")), name: "chained" },
          ],
          mode: "offset",
        }),
      ),
    ).toMatchObject({
      reason: "format",
      message:
        "FIT is malformed: /images/chained: image-data target /images/shared has its own image-data",
    });
  });

  it("fails external data inside the devicetree", () => {
    expect(
      failureOf(
        fitFixture({
          images: [
            kernel(),
            shared({ "data-position": cells(0), "data-size": cells(4) }),
          ],
          mode: "position",
        }),
      ),
    ).toMatchObject({
      reason: "format",
      message:
        "FIT is malformed: image data overlaps: /images/shared and the FIT devicetree",
    });
  });

  it.each([
    [
      "missing data",
      singleImage({ type: dtString("kernel") }),
      "/images/kernel has no data, data-offset or data-position",
    ],
    [
      "data plus data-offset",
      fitFixture({ images: [kernel({ "data-offset": cells(0) })] }),
      "/images/kernel declares more than one data source",
    ],
    [
      "data-offset without data-size",
      singleImage({ "data-offset": cells(0) }),
      "/images/kernel: data-offset requires data-size",
    ],
    [
      "an 8-byte data-size",
      fitFixture({
        images: [kernel({ "data-size": cells(0, 1000) })],
        mode: "offset",
      }),
      "/images/kernel: data-size is not a single 32-bit cell",
    ],
  ])("fails %s", (_name, file, message) => {
    expect(failureOf(file)).toMatchObject({
      reason: "format",
      message: `FIT is malformed: ${message}`,
    });
  });
});

describe("FIT hashes", () => {
  it("leaves unsupported, algo-less and value-less hashes unverified", () => {
    const [image] = read(
      fitFixture({
        images: [
          {
            ...kernel(),
            hashes: ["sha256"],
            children: [
              {
                name: "hash-2",
                properties: { algo: dtString("crc16-ccitt"), value: cells(0) },
              },
              { name: "hash-3", properties: { value: cells(0) } },
              { name: "hash-4", properties: { algo: dtString("sha1") } },
              {
                name: "signature-1",
                properties: { algo: dtString("sha256,rsa2048") },
              },
              { name: "cipher", properties: { algo: dtString("aes256") } },
            ],
          },
        ],
      }),
    ).images;
    expect(image?.hashes.map((hash) => [hash.node, hash.algo])).toEqual([
      ["hash-1", "sha256"],
    ]);
    expect(image?.metadata).toMatchObject({
      hash_algorithms: ["sha256", "crc16-ccitt", "sha1"],
      hashes_verified: 1,
      hashes_unverified: 3,
      signature_algorithms: ["sha256,rsa2048"],
      cipher_present: true,
      cipher_algo: "aes256",
    });
    expect(image?.limitations).toEqual([
      'hash-2 algorithm "crc16-ccitt" is not verified',
      "hash-3 has no NUL-terminated UTF-8 algo; it is not verified",
      "hash-4 has no value; it is not verified",
    ]);
  });

  it("fails a supported hash whose value has the wrong length", () => {
    expect(
      failureOf(
        fitFixture({
          images: [
            {
              ...kernel(),
              children: [
                {
                  name: "hash-1",
                  properties: {
                    algo: dtString("sha256"),
                    value: Buffer.alloc(31),
                  },
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      reason: "integrity",
      message:
        "FIT image kernel hash-1 sha256 value is 31 bytes; sha256 values are 32 bytes",
    });
  });
});

describe("FIT configurations", () => {
  const images = ["kernel", "fdt-1", "overlay-1"].map((name) => ({
    name,
    data: Buffer.from(name),
  }));
  const configured = (configurations: FixtureNode) =>
    read(fitFixture({ images, configurations }));

  it("reports default, references and signature algorithms", () => {
    const structure = configured({
      name: "configurations",
      properties: { default: dtString("conf-a") },
      children: [
        {
          name: "conf-a",
          properties: {
            description: dtString("Board A"),
            kernel: dtString("kernel"),
            fdt: dtString("fdt-1\0overlay-1"),
            loadables: dtString("kernel"),
            firmware: dtString("fdt-1"),
          },
          children: [
            {
              name: "signature-1",
              properties: { algo: dtString("sha256,rsa4096") },
            },
          ],
        },
      ],
    });
    expect(structure.metadata).toMatchObject({
      default_configuration: "conf-a",
      configurations: [
        {
          name: "conf-a",
          description: "Board A",
          kernel: ["kernel"],
          firmware: ["fdt-1"],
          fdt: ["fdt-1", "overlay-1"],
          ramdisk: [],
          loadables: ["kernel"],
          signature_algorithms: ["sha256,rsa4096"],
        },
      ],
    });
    expect(structure.limitations).toEqual([]);
  });

  it("reports missing references and a missing default as limitations", () => {
    const structure = configured({
      name: "configurations",
      properties: { default: dtString("conf-x") },
      children: [{ name: "conf-a", properties: { kernel: dtString("gone") } }],
    });
    expect(structure.metadata.configurations[0]).toMatchObject({
      kernel: ["gone"],
      unresolved_reference_count: 1,
    });
    expect(structure.limitations).toHaveLength(2);
    expect(
      structure.limitations.some((value) =>
        value.includes("/configurations/conf-a"),
      ),
    ).toBe(true);
    expect(
      structure.limitations.some((value) => value.includes("conf-x")),
    ).toBe(true);
  });

  it("reports no configurations when the node is absent", () => {
    expect(read(fitFixture({ images })).metadata).toMatchObject({
      default_configuration: null,
      configurations: [],
    });
  });
});

describe("FIT fixed limits", () => {
  it("fails more images than the fixed allowance", () => {
    expect(
      failureOf(
        fitFixture({
          images: Array.from({ length: FIT_MAX_IMAGES + 1 }, (_, index) => ({
            name: `image-${String(index)}`,
            data: Buffer.from([index & 0xff]),
          })),
        }),
      ),
    ).toMatchObject({ reason: "limit", boundary: "capacity" });
  });

  it("fails more hash nodes than the fixed allowance", () => {
    expect(
      failureOf(
        fitFixture({
          images: [
            {
              ...kernel(),
              hashes: Array.from(
                { length: FIT_MAX_HASH_NODES_PER_IMAGE + 1 },
                () => "crc32",
              ),
            },
          ],
        }),
      ),
    ).toMatchObject({ reason: "limit", boundary: "capacity" });
  });

  it("fails more configurations than the fixed allowance", () => {
    expect(
      failureOf(
        fitFixture({
          images: [kernel()],
          configurations: {
            name: "configurations",
            children: Array.from(
              { length: FIT_MAX_CONFIGURATIONS + 1 },
              (_, index) => ({ name: `conf-${String(index)}` }),
            ),
          },
        }),
      ),
    ).toMatchObject({ reason: "limit", boundary: "capacity" });
  });

  it("bounds configuration references before decoding them", () => {
    expect(
      failureOf(
        fitFixture({
          images: [kernel()],
          configurations: {
            name: "configurations",
            children: [
              {
                name: "conf-1",
                properties: {
                  loadables: Buffer.alloc(FIT_MAX_CONFIGURATION_REFERENCES + 1),
                },
              },
            ],
          },
        }),
      ),
    ).toMatchObject({ reason: "limit", boundary: "capacity" });
  });

  it("maps a parser limit to a fixed allowance without a caller limit", () => {
    let nested: FixtureNode = { name: "leaf" };
    for (let depth = 0; depth < 64; depth += 1)
      nested = { name: `n${String(depth)}`, children: [nested] };
    const failure = failureOf(
      devicetreeFixture({
        name: "",
        children: [{ name: "images" }, nested],
      }),
    );
    expect(failure).toMatchObject({ reason: "limit", boundary: "capacity" });
    // The parser's caller-limit recovery does not apply to fixed FIT reads.
    expect(String((failure as Error).message)).not.toContain("caller-selected");
  });

  it("fails a structure without /images", () => {
    expect(failureOf(devicetreeFixture())).toMatchObject({
      reason: "format",
      message: "FIT is malformed: /images node is missing",
    });
  });
});

it("bounds dangling-reference diagnostics while preserving every declared reference", () => {
  const name = "c".repeat(4096);
  const references = Array.from(
    { length: FIT_MAX_CONFIGURATION_REFERENCES },
    () => "missing",
  );
  const file = fitFixture({
    images: [{ name: "kernel", data: Buffer.from("K") }],
    configurations: {
      name: "configurations",
      children: [
        { name, properties: { loadables: dtString(references.join("\0")) } },
      ],
    },
  });
  const structure = read(file);
  expect(structure.limitations.length).toBe(1);
  expect(structure.metadata.configurations[0]).toMatchObject({
    name,
    loadables: references,
    unresolved_reference_count: references.length,
  });
  expect(
    Buffer.byteLength(
      JSON.stringify({
        metadata: structure.metadata,
        limitations: structure.limitations,
      }),
    ),
  ).toBeLessThan(file.length * 4);
});

it.each(["data-offset", "data-position"] as const)(
  "accepts a shared external range whose target uses %s",
  (targetKey) => {
    const linkedKey =
      targetKey === "data-offset" ? "data-position" : "data-offset";
    const data = Buffer.from("payload");
    const build = (start: number) =>
      devicetreeFixture({
        name: "",
        children: [
          {
            name: "images",
            children: [
              {
                name: "target",
                properties: {
                  [targetKey]: cells(targetKey === "data-offset" ? 0 : start),
                  "data-size": cells(data.length),
                },
              },
              {
                name: "linked",
                properties: {
                  [linkedKey]: cells(linkedKey === "data-offset" ? 0 : start),
                  "data-size": cells(data.length),
                  "image-data": dtString("target"),
                },
              },
            ],
          },
        ],
      });
    const start = Math.ceil(build(0).length / 4) * 4;
    const fdt = build(start);
    const file = Buffer.concat([fdt, Buffer.alloc(start - fdt.length), data]);
    const [target, linked] = read(file).images;
    expect(target?.start).toBe(start);
    expect(linked?.start).toBe(start);
    expect(target?.metadata.data_source).toBe(targetKey);
    expect(linked?.metadata.data_source).toBe(linkedKey);
    expect(imageBytes(file, 1).equals(data)).toBe(true);
  },
);
