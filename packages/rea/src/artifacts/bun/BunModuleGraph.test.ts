import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  locateBunStandaloneGraph,
  probeBunStandaloneGraph,
  bunModuleCountLimit,
  BUN_GRAPH_SUFFIX_BYTES,
} from "./BunModuleGraphLayout.js";
import { decodeBunModuleGraph } from "./BunModuleGraphMembers.js";
import {
  bunModuleGraphPayload,
  bunPrefixedPayload,
  machoBunSection,
  machoBunSections,
  peBunSection,
  elfBunSection,
  elfAppendedBunPayload,
  elfPrefix,
} from "./BunStandalone.fixture.js";

async function locate(bytes: Buffer) {
  const path = join(await createTestTempDirectory("rea-bun-parser-"), "app");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    const result = await locateBunStandaloneGraph(handle, bytes.length);
    if (result.status === "present" && result.graph !== undefined) {
      const graph = result.graph;
      return {
        ...result,
        graph: {
          ...graph,
          data: {
            length: graph.data.length,
            read: async (offset: number, length: number) =>
              Buffer.from(
                bytes.subarray(
                  graph.payloadOffset + offset,
                  graph.payloadOffset + offset + length,
                ),
              ),
          },
        },
      };
    }
    return result;
  } finally {
    await handle.close();
  }
}

/** Probe while counting bytes read through the handle. */
async function probe(bytes: Buffer) {
  const path = join(await createTestTempDirectory("rea-bun-parser-"), "app");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  let bytesRead = 0;
  const read = handle.read.bind(handle);
  const counted = new Proxy(handle, {
    get: (target, key) =>
      key === "read"
        ? async (...args: Parameters<typeof read>) => {
            const result = await read(...args);
            bytesRead += result.bytesRead;
            return result;
          }
        : Reflect.get(target, key),
  });
  try {
    return {
      result: await probeBunStandaloneGraph(counted, bytes.length),
      bytesRead,
    };
  } finally {
    await handle.close();
  }
}

it.each([
  ["Mach-O", machoBunSection],
  ["PE", peBunSection],
  ["ELF", elfBunSection],
] as const)(
  "decodes section carrier %s with preserved names and auxiliary regions",
  async (_name, carrier) => {
    const result = await locate(
      carrier(
        bunPrefixedPayload(
          bunModuleGraphPayload({
            modules: [
              {
                name: "/$bunfs/root/main.js",
                contents: Buffer.from("hello"),
                sourcemap: Buffer.from("map"),
                bytecode: Buffer.from([1]),
              },
            ],
            compileExecArgv: "--smol",
          }),
        ),
      ),
    );
    expect(result.status).toBe("present");
    if (result.status !== "present" || !result.graph)
      throw new Error("missing graph");
    const decoded = await decodeBunModuleGraph(result.graph);
    expect(decoded.compileExecArgv.text).toBe("--smol");
    expect(decoded.modules[0]).toMatchObject({
      nameText: { text: "/$bunfs/root/main.js" },
      contents: { length: 5 },
      sourcemap: { length: 3 },
      bytecode: { length: 1 },
    });
  },
);

it.each([0, 16])(
  "decodes legacy Mach-O four-byte prefixes with %s padding bytes",
  async (padding) => {
    const payload = bunModuleGraphPayload({
      revision: "bun-1.3.3",
      modules: [
        { name: "/$bunfs/root/main.js", contents: Buffer.from("hello") },
      ],
    });
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(payload.length);
    const bytes = machoBunSection(
      Buffer.concat([prefix, payload, Buffer.alloc(padding)]),
    );
    const result = await locate(bytes);
    if (result.status !== "present" || !result.graph)
      throw new Error("missing graph");
    expect(result.graph.carrier).toBe("mach-o-section");
    expect(result.graph.payloadOffset).toBe(
      bytes.length - padding - payload.length,
    );
    expect(result.graph.payloadLength).toBe(payload.length);
    const module = (await decodeBunModuleGraph(result.graph)).modules[0]!;
    expect(module.nameText.text).toBe("/$bunfs/root/main.js");
    expect(
      (
        await result.graph.data.read(
          module.contents.offset,
          module.contents.length,
        )
      ).toString(),
    ).toBe("hello");
  },
);

it.each(["trailer", "byte_count"])(
  "rejects legacy Mach-O prefixes with invalid %s",
  async (field) => {
    const payload = bunModuleGraphPayload({
      revision: "bun-1.3.3",
      modules: [{ name: "/$bunfs/root/main.js" }],
    });
    if (field === "trailer") payload[payload.length - 1] = 0;
    else payload.writeBigUInt64LE(0n, payload.length - BUN_GRAPH_SUFFIX_BYTES);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(payload.length);
    expect(
      await locate(machoBunSection(Buffer.concat([prefix, payload]))),
    ).toMatchObject({ status: "present", failure: expect.anything() });
  },
);

it.each(["bun-1.3.3", "bun-1.3.9"] as const)(
  "decodes appended %s and retains duplicate names",
  async (revision) => {
    const result = await locate(
      elfAppendedBunPayload(
        bunModuleGraphPayload({
          revision,
          modules: [{ name: "same" }, { name: "same" }],
        }),
      ),
    );
    if (result.status !== "present" || !result.graph)
      throw new Error("missing graph");
    expect(
      (await decodeBunModuleGraph(result.graph)).modules.map(
        (m) => m.nameText.text,
      ),
    ).toEqual(["same", "same"]);
  },
);

it.each([
  [
    { modules: [{ contentsPointer: { offset: 99999, length: 1 } }] },
    "pointer exceeds",
  ],
  [{ modules: [{}], tableLength: 53 }, "unsupported"],
  [
    { modules: [{ loader: 0, moduleFormat: 0 }], tableLength: 468 },
    "more than one known revision",
  ],
  [{ modules: [{}], entryPointId: 8 }, "entry_point_id"],
])("fails closed for invalid module declarations", async (input, reason) => {
  const result = await locate(
    elfAppendedBunPayload(bunModuleGraphPayload(input)),
  );
  if (result.status !== "present" || !result.graph)
    throw new Error("missing graph");
  const graph = result.graph;
  await expect(decodeBunModuleGraph(graph)).rejects.toThrow(reason);
});

it("recognizes a truncated section as malformed", async () => {
  const section = bunPrefixedPayload(bunModuleGraphPayload({ modules: [{}] }));
  const result = await locate(
    machoBunSection(section.subarray(0, section.length - 1)),
  );
  expect(result).toMatchObject({
    status: "present",
    failure: { reason: "format" },
  });
});

it("locates the legacy trailer before its final carrier length", async () => {
  const bytes = elfAppendedBunPayload(
    bunModuleGraphPayload({ modules: [{ name: "main.js" }] }),
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length + 8));
  const result = await locate(Buffer.concat([bytes, length]));
  if (result.status !== "present" || !result.graph)
    throw new Error("missing graph");
  expect((await decodeBunModuleGraph(result.graph)).modules).toHaveLength(1);
});

it("does not admit oversized payloads or truncated length prefixes", async () => {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(300n * 1024n * 1024n);
  expect(await locate(machoBunSection(prefix))).toMatchObject({
    status: "present",
    failure: { reason: "limit" },
  });
  expect(await locate(machoBunSection(Buffer.from([1])))).toMatchObject({
    status: "present",
    failure: { reason: "format" },
  });
  expect(await locate(machoBunSection(Buffer.alloc(8)))).toEqual({
    status: "absent",
  });
});

it("refuses multiple embedded graphs instead of selecting one", async () => {
  const section = bunPrefixedPayload(bunModuleGraphPayload({ modules: [{}] }));
  expect(await locate(machoBunSections([section, section]))).toMatchObject({
    status: "present",
    failure: { reason: "unavailable" },
  });
});

it("probes a section graph without reading its payload data", async () => {
  const contents = Buffer.alloc(1024 * 1024, 0x61);
  const bytes = machoBunSection(
    bunPrefixedPayload(
      bunModuleGraphPayload({ modules: [{ name: "main.js", contents }] }),
    ),
  );
  const { result, bytesRead } = await probe(bytes);
  expect(result).toMatchObject({
    status: "present",
    claim: { carrier: "mach-o-section" },
  });
  expect(bytesRead).toBeLessThan(4096);
});

it.each([
  [
    "Mach-O",
    (section: Buffer) => {
      const bytes = machoBunSection(Buffer.concat([section, Buffer.alloc(16)]));
      return bytes.subarray(0, bytes.length - 8);
    },
  ],
  [
    "ELF",
    (section: Buffer) => {
      const bytes = elfBunSection(section);
      const sectionOffset = 64 + "\0.shstrtab\0.bun\0".length;
      bytes.writeBigUInt64LE(
        BigInt(bytes.length - sectionOffset + 1),
        bytes.length - 64 + 32,
      );
      return bytes;
    },
  ],
] as const)(
  "rejects %s sections whose declared tail is missing",
  async (_name, carrier) => {
    const section = bunPrefixedPayload(
      bunModuleGraphPayload({ modules: [{ name: "main.js" }] }),
    );
    expect(await locate(carrier(section))).toMatchObject({
      status: "present",
      failure: {
        reason: "format",
        message: expect.stringContaining("past the end of the file"),
      },
    });
  },
);

it("matches ELF section names in bounded time when headers share one long name", async () => {
  const shnum = 16_383;
  const stringOffset = 64;
  const strings = Buffer.alloc(1024 * 1024, 0x61);
  const tableOffset = stringOffset + strings.length;
  const bytes = Buffer.alloc(tableOffset + shnum * 64);
  elfPrefix().copy(bytes, 0);
  bytes.writeBigUInt64LE(BigInt(tableOffset), 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(shnum, 60);
  bytes.writeUInt16LE(0, 62);
  strings.copy(bytes, stringOffset);
  for (let index = 0; index < shnum; index += 1) {
    const header = tableOffset + index * 64;
    bytes.writeBigUInt64LE(BigInt(stringOffset), header + 24);
    bytes.writeBigUInt64LE(BigInt(strings.length), header + 32);
  }
  const started = performance.now();
  expect((await probe(bytes)).result).toEqual({ status: "absent" });
  expect(performance.now() - started).toBeLessThan(2_000);
});

it("refuses an excessive table count before reading or allocating the module table", async () => {
  const count = 100_001;
  const result = await locate(
    elfAppendedBunPayload(
      bunModuleGraphPayload({ modules: [{}], tableLength: count * 52 }),
    ),
  );
  if (result.status !== "present" || result.graph === undefined)
    throw new Error("Missing graph");
  const read = vi.fn(result.graph.data.read);
  const expected = bunModuleCountLimit(count);
  await expect(
    decodeBunModuleGraph({
      ...result.graph,
      data: { ...result.graph.data, read },
    }),
  ).rejects.toMatchObject({
    reason: "limit",
    boundary: "capacity",
    message: expected.message,
  });
  expect(read).not.toHaveBeenCalled();
});
