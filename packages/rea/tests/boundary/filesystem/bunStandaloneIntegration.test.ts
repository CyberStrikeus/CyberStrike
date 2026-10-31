import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { BunStandaloneArtifactReader } from "../../../src/artifacts/BunStandaloneArtifactReader.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import * as layout from "../../../src/artifacts/bun/BunModuleGraphLayout.js";
import { decodeBunModuleGraph } from "../../../src/artifacts/bun/BunModuleGraphMembers.js";
import {
  bunModuleGraphPayload,
  bunPrefixedPayload,
  peBunSection,
} from "../../../src/artifacts/bun/BunStandalone.fixture.js";
import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const host = (contents: Buffer) =>
  peBunSection(
    bunPrefixedPayload(
      bunModuleGraphPayload({
        modules: [{ name: "/$bunfs/root/main.js", contents }],
      }),
    ),
  );

it("reads bounded metadata instead of the stored Bun asset body", async () => {
  const root = await createTestTempDirectory("rea-bun-metadata-range-");
  const path = join(root, "host.exe");
  const bytes = host(Buffer.alloc(8 * 1024 * 1024, 97));
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  const read = handle.read.bind(handle);
  let bytesRead = 0;
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
    const located = await layout.locateBunStandaloneGraph(
      counted,
      bytes.length,
    );
    if (located.status !== "present" || located.graph === undefined)
      throw new Error("Missing graph");
    const decoded = await decodeBunModuleGraph(located.graph);
    expect(decoded.modules[0]?.contents.length).toBe(8 * 1024 * 1024);
    expect(decoded.modules[0]?.nameText.text).toBe("/$bunfs/root/main.js");
    expect(bytesRead).toBeLessThan(1024 * 1024);
  } finally {
    await handle.close();
  }
});

it("shares the Bun probe across preflight, inventory and extraction", async () => {
  const root = await createTestTempDirectory("rea-bun-shared-probe-");
  const path = join(root, "host.exe");
  const contents = Buffer.from("owned Bun source");
  const bytes = host(contents);
  await writeFile(path, bytes);
  const pe = bytes.readUInt32LE(60);
  const section = pe + 24 + bytes.readUInt16LE(pe + 20);
  const prefixOffset = bytes.readUInt32LE(section + 20);
  const observed = await open(path, "r");
  const prototype = Object.getPrototypeOf(observed) as FileHandle;
  const read = prototype.read;
  let probes = 0;
  const probe = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<typeof read>
  ) {
    const reply = await read.apply(this, args);
    const observedArguments: readonly unknown[] = args;
    if (observedArguments[2] === 8 && observedArguments[3] === prefixOffset)
      probes++;
    return reply;
  });
  const scope = new ArtifactResourceScope();
  try {
    const output = join(root, "out");
    await extractArtifact({
      inputPath: path,
      inputFormat: "pe",
      outputRoot: output,
      environment: process.env,
      resourceScope: scope,
      integrityPolicy: "fail",
    });
    expect(
      (await readFile(join(output, "$bunfs/root/main.js"))).equals(contents),
    ).toBe(true);
    expect(probes).toBe(1);
  } finally {
    try {
      await scope.close();
    } finally {
      probe.mockRestore();
      await observed.close();
    }
  }
});

it("closes a completed producer whose readable bytes remain buffered", async () => {
  const root = await createTestTempDirectory("rea-bun-buffered-reader-");
  const path = join(root, "host.exe");
  await writeFile(path, host(Buffer.from("unconsumed source")));
  const reader = new BunStandaloneArtifactReader(path);
  let stream;
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    stream = await reader.open(entries[0]!);
    await finished(stream, { readable: false });
    await setImmediate();
    expect(stream.readableEnded).toBe(false);
    await reader.close();
    expect(stream.destroyed).toBe(true);
    expect(stream.closed).toBe(true);
  } finally {
    stream?.destroy();
    await reader.close();
  }
});

it("rejects replacement of the selected parent while the old descriptor stays valid", async () => {
  const root = await createTestTempDirectory("rea-bun-selected-parent-");
  const parent = join(root, "selected");
  await mkdir(parent);
  const path = join(parent, "host.exe");
  const bytes = host(Buffer.from("owned source"));
  await writeFile(path, bytes);
  const reader = new BunStandaloneArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    await rename(parent, join(root, "previous"));
    await mkdir(parent);
    await writeFile(path, bytes);
    await expect(reader.open(entries[0]!)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
  }
});

it("indexes a deep virtual name while retaining its exact source identity", async () => {
  const root = await createTestTempDirectory("rea-bun-deep-virtual-name-");
  const path = join(root, "host.exe");
  const name = "/" + "a/".repeat(256) + "main.js";
  await writeFile(
    path,
    peBunSection(
      bunPrefixedPayload(
        bunModuleGraphPayload({
          modules: [{ name, contents: Buffer.from("owned source") }],
        }),
      ),
    ),
  );
  const reader = new BunStandaloneArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: "bun-modules/0",
      sourcePath: name,
      formatMetadata: {
        kind: "bun-standalone-entry",
        index: 0,
        source_name: name,
        entry_point: true,
      },
    });
    expect(entries[0]?.limitations.length).toBeGreaterThan(0);
    expect(reader.formatMetadata()).toMatchObject({
      entry_point_logical_path: "bun-modules/0",
      entry_point_source_name: name,
    });
  } finally {
    await reader.close();
  }
});
