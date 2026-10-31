import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

import {
  cells,
  devicetreeFixture,
  dtString,
  type FixtureNode,
} from "../../firmware/devicetree/Devicetree.fixture.js";

/** One /images node; `hashes` names algorithms whose values the fixture computes. */
export interface FitFixtureImage {
  name: string;
  data: Buffer;
  properties?: Record<string, Buffer>;
  hashes?: string[];
  children?: FixtureNode[];
}

const align = (value: number, boundary: number): number =>
  Math.ceil(value / boundary) * boundary;

const hashValue = (algo: string, data: Buffer): Buffer =>
  algo === "crc32"
    ? cells(crc32(data))
    : createHash(algo).update(data).digest();

/**
 * Synthetic FIT writer. External modes place each image at a multiple of
 * `align` in a data store that starts at ALIGN(totalsize, 4), as mkimage -E
 * does; position mode records absolute file offsets (mkimage -p).
 */
export const fitFixture = ({
  images,
  configurations,
  mode = "embedded",
  align: boundary = 4,
  version = 17,
}: {
  images: FitFixtureImage[];
  configurations?: FixtureNode;
  mode?: "embedded" | "offset" | "position";
  align?: number;
  version?: number;
}): Buffer => {
  const offsets: number[] = [];
  let storeBytes = 0;
  for (const image of images) {
    storeBytes = align(storeBytes, boundary);
    offsets.push(storeBytes);
    storeBytes += image.data.length;
  }
  const build = (base: number): Buffer =>
    devicetreeFixture(
      {
        name: "",
        properties: {
          description: dtString("Test FIT"),
          timestamp: cells(1_700_000_000),
          "#address-cells": cells(1),
        },
        children: [
          {
            name: "images",
            children: images.map((image, index) => ({
              name: image.name,
              // Explicit properties override the generated data properties.
              properties: {
                ...(mode === "embedded"
                  ? { data: image.data }
                  : {
                      [mode === "offset" ? "data-offset" : "data-position"]:
                        cells(base + (offsets[index] ?? 0)),
                      "data-size": cells(image.data.length),
                    }),
                ...image.properties,
              },
              children: [
                ...(image.hashes ?? []).map((algo, hash) => ({
                  name: `hash-${String(hash + 1)}`,
                  properties: {
                    algo: dtString(algo),
                    value: hashValue(algo, image.data),
                  },
                })),
                ...(image.children ?? []),
              ],
            })),
          },
          ...(configurations === undefined ? [] : [configurations]),
        ],
      },
      version,
    );
  if (mode === "embedded") return build(0);
  // Cell values do not change the blob size, so a placeholder build fixes it.
  const store = align(build(0).length, 4);
  const fdt = build(mode === "position" ? store : 0);
  const file = Buffer.alloc(store + storeBytes);
  fdt.copy(file);
  images.forEach((image, index) =>
    image.data.copy(file, store + (offsets[index] ?? 0)),
  );
  return file;
};

export const FIT_KERNEL = Buffer.from(
  Array.from({ length: 1000 }, (_, index) => (index * 7 + 3) % 251),
);
export const FIT_DEVICETREE = devicetreeFixture();

const FIT_IMAGES: FitFixtureImage[] = [
  {
    name: "kernel",
    data: FIT_KERNEL,
    properties: {
      description: dtString("Linux kernel"),
      type: dtString("kernel"),
      arch: dtString("arm64"),
      os: dtString("linux"),
      compression: dtString("none"),
      load: cells(0x4020_0000),
      entry: cells(0, 0x4020_0000),
    },
    hashes: ["crc32", "md5", "sha1", "sha256", "sha384", "sha512"],
  },
  {
    name: "fdt-1",
    data: FIT_DEVICETREE,
    properties: {
      type: dtString("flat_dt"),
      arch: dtString("arm64"),
      compression: dtString("none"),
    },
    hashes: ["sha256"],
  },
];

const FIT_CONFIGURATIONS: FixtureNode = {
  name: "configurations",
  properties: { default: dtString("conf-1") },
  children: [
    {
      name: "conf-1",
      properties: {
        description: dtString("Boot Linux"),
        kernel: dtString("kernel"),
        fdt: dtString("fdt-1"),
      },
      children: [
        {
          name: "signature-1",
          properties: { algo: dtString("sha256,rsa2048") },
        },
      ],
    },
  ],
};

export const FIT_EMBEDDED = fitFixture({
  images: FIT_IMAGES,
  configurations: FIT_CONFIGURATIONS,
});
export const FIT_EXTERNAL = fitFixture({
  images: FIT_IMAGES,
  configurations: FIT_CONFIGURATIONS,
  mode: "offset",
});
