import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { HexRecordArtifactReader } from "./HexRecordArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { extractArtifact } from "./extraction/ArtifactExtraction.js";
import {
  INTEL_HEX_I32_GAP,
  SREC_S19,
  intelHexRecord,
} from "../domain/firmware/hexRecords.fixture.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";

const writeImage = async (name: string, text: string): Promise<string> => {
  const directory = await createTestTempDirectory("rea-hex-records-");
  const path = join(directory, name);
  await writeFile(path, text);
  return path;
};

it("reports unknown coverage and termination facts as limitations", async () => {
  const truncated = await scanCanonicalArtifactInventory(
    await writeImage("truncated.s19", SREC_S19.replace("S9030000FC\n", "")),
  );
  expect(truncated.manifest.root_format).toBe("srec");
  expect(truncated.coverage.status).toBe("unknown");
  expect(truncated.limitations).toContain(
    "S-record has no termination record; the file may be truncated.",
  );
  expect(truncated.occurrences.map((row) => row.logical_path).sort()).toEqual([
    ".",
    "0x00000000-0x0000001f.bin",
  ]);
  const mismatched = await scanCanonicalArtifactInventory(
    await writeImage(
      "s7.s19",
      SREC_S19.replace("S9030000FC", "S70500000000FA"),
    ),
  );
  expect(mismatched.coverage.status).toBe("complete");
  expect(mismatched.limitations).toContain(
    "S-record termination S7 does not match the address width of S1 data records.",
  );
});

it("fails closed on over-limit records", async () => {
  const runs = [intelHexRecord(0, 0, [1])];
  for (let index = 1; index <= 65_536; index += 1) {
    const address = index * 2;
    if (address % 0x1_0000 === 0)
      runs.push(intelHexRecord(4, 0, [0, address >>> 16]));
    runs.push(intelHexRecord(0, address & 0xffff, [1]));
  }
  await expect(
    scanCanonicalArtifactInventory(
      await writeImage("runs.hex", `${runs.join("\n")}\n`),
    ),
  ).rejects.toMatchObject({ reason: "limit", boundary: "capacity" });
});

it("leaves an invalid first record to plain file classification", async () => {
  const snapshot = await scanCanonicalArtifactInventory(
    await writeImage("notes.hex", ":0300300002337A1F\n:00000001FF\n"),
  );
  expect(snapshot.manifest.root_format).toBe("file");
});

it("re-inventories extracted regions as raw files", async () => {
  const directory = await createTestTempDirectory("rea-hex-extract-");
  const path = join(directory, "firmware.hex");
  await writeFile(path, INTEL_HEX_I32_GAP);
  const resourceScope = new ArtifactResourceScope();
  try {
    const extracted = await extractArtifact({
      inputPath: path,
      inputFormat: "intel-hex",
      outputRoot: join(directory, "out"),
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope,
    });
    const reinventoried = await scanCanonicalArtifactInventory(
      extracted.output_root,
    );
    expect(reinventoried.manifest.root_format).toBe("directory");
    expect(
      reinventoried.occurrences
        .filter((row) => row.entry_kind === "file")
        .map((row) => row.logical_path)
        .sort(),
    ).toEqual(["0x08000000-0x0800001f.bin", "0x08000100-0x08000103.bin"]);
  } finally {
    await resourceScope.close();
  }
});

it("rejects a changed carrier during extraction preparation", async () => {
  const path = await writeImage("changed.hex", INTEL_HEX_I32_GAP);
  const reader = new HexRecordArtifactReader(path, "intel-hex");
  try {
    await expect(reader.prepareContainer("0".repeat(64))).rejects.toMatchObject(
      { reason: "integrity" },
    );
  } finally {
    await reader.close();
  }
});

it("rejects forged entries and changed carrier identity, then closes idempotently", async () => {
  const path = await writeImage("identity.hex", INTEL_HEX_I32_GAP);
  const reader = new HexRecordArtifactReader(path, "intel-hex");
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Missing region");
    await expect(
      reader.open({ ...entry, declaredSize: 1 }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(
      reader.open({ ...entry, adapterKey: "hex-records:9" }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await writeFile(path, INTEL_HEX_I32_GAP.replace(":00000001FF\n", ""));
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
    await reader.close();
  }
});

it("settles an active region stream when closed", async () => {
  const reader = new HexRecordArtifactReader(
    await writeImage("close.hex", INTEL_HEX_I32_GAP),
    "intel-hex",
  );
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Missing region");
    const stream = await reader.open(entry);
    await reader.close();
    expect(stream.destroyed).toBe(true);
    await expect(
      reader.entries()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ reason: "unavailable" });
  } finally {
    await reader.close();
  }
});

it("honors cancellation before admitting a file with the exact reason", async () => {
  const reader = new HexRecordArtifactReader(
    await writeImage("cancel.hex", INTEL_HEX_I32_GAP),
    "intel-hex",
  );
  const controller = new AbortController();
  const reason = { stage: "before admission" };
  controller.abort(reason);
  try {
    await expect(
      reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
  } finally {
    await reader.close();
  }
});

it.each(["cancel", "close"] as const)(
  "settles decoding when the caller requests %s",
  async (action) => {
    const rows: string[] = [];
    for (let address = 0; address < 0x1_0000; address += 16)
      rows.push(
        intelHexRecord(
          0,
          address,
          Array.from({ length: 16 }, () => 0),
        ),
      );
    const text = `${Array.from({ length: 16 }, (_, segment) =>
      [intelHexRecord(4, 0, [0, segment]), ...rows].join("\n"),
    ).join("\n")}\n:00000001FF\n`;
    const reader = new HexRecordArtifactReader(
      await writeImage("large.hex", text),
      "intel-hex",
    );
    const controller = new AbortController();
    const reason = { stage: "decoding" };
    let completion: Promise<void> | undefined;
    try {
      const pending = reader
        .entries(controller.signal)
        [Symbol.asyncIterator]()
        .next();
      setImmediate(() => {
        if (action === "cancel") controller.abort(reason);
        else completion = reader.close();
      });
      await expect(pending).rejects.toMatchObject(
        action === "cancel"
          ? { reason: "cancelled", cause: reason }
          : { reason: "unavailable" },
      );
      await completion;
    } finally {
      await reader.close();
    }
  },
);

it("retains the caller's cancellation reason after a region stream was opened", async () => {
  const reader = new HexRecordArtifactReader(
    await writeImage("stream-cancel.hex", INTEL_HEX_I32_GAP),
    "intel-hex",
  );
  const controller = new AbortController();
  const reason = { stage: "region consumption" };
  try {
    const { value: entry } = await reader
      .entries()
      [Symbol.asyncIterator]()
      .next();
    if (entry === undefined) throw new Error("Missing region");
    const stream = await reader.open(entry, controller.signal);
    controller.abort(reason);
    await expect(
      (async () => {
        for await (const _chunk of stream) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    await reader.close();
    expect(stream.closed).toBe(true);
  } finally {
    await reader.close();
  }
});

it("bounds copied region chunks and isolates cached bytes across opens", async () => {
  const data = Array.from({ length: 16 }, () => 0);
  const records = Array.from({ length: 4096 }, (_, index) =>
    intelHexRecord(0, index * 16, data),
  );
  const text = [
    intelHexRecord(4, 0, [0, 0]),
    ...records,
    intelHexRecord(4, 0, [0, 1]),
    ...records,
    intelHexRecord(1, 0, []),
  ].join("\n");
  const reader = new HexRecordArtifactReader(
    await writeImage("chunked.hex", text),
    "intel-hex",
  );
  const controller = new AbortController();
  const reason = { stage: "partial region consumption" };
  try {
    const { value: entry } = await reader
      .entries()
      [Symbol.asyncIterator]()
      .next();
    if (entry === undefined) throw new Error("Missing region");
    const stream = await reader.open(entry, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    const { value: first }: { value: unknown } = await iterator.next();
    if (!Buffer.isBuffer(first)) throw new Error("Expected byte chunk");
    expect(first.length).toBeLessThanOrEqual(64 * 1024);
    expect(first.length).toBeLessThan(entry.declaredSize!);
    first[0] = 42;
    const reopened = await reader.open(entry);
    const peer = reopened[Symbol.asyncIterator]();
    const { value: again }: { value: unknown } = await peer.next();
    if (!Buffer.isBuffer(again)) throw new Error("Expected byte chunk");
    expect(again[0]).toBe(0);
    controller.abort(reason);
    await expect(iterator.next()).rejects.toMatchObject({
      reason: "cancelled",
      cause: reason,
    });
    const { value: peerRemainder }: { value: unknown } = await peer.next();
    if (!Buffer.isBuffer(peerRemainder)) throw new Error("Expected peer bytes");
    expect(peerRemainder[0]).toBe(0);
    await reader.close();
    expect(stream.closed).toBe(true);
    expect(reopened.closed).toBe(true);
  } finally {
    await reader.close();
  }
});
