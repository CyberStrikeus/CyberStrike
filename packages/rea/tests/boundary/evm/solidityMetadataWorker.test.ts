import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { solidityMetadataSchema } from "../../../src/domain/evm/solidityMetadata.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/** Real compiled worker and unchanged WASM engine; no Linux provider-admission claim. */
it.each([
  ["compiler", "00a164736f6c634300081e000a", "decoded"],
  ["integer", "00a1011bffffffffffffffff000b", "decoded"],
  ["BOM text", "00a1617864efbbbf610008", "decoded"],
  ["nested value", "00a1617881000005", "partial"],
  [
    "distinct nested byte keys",
    "00a264736f6c634300081e6178a24101014102020013",
    "partial",
  ],
  [
    "duplicate nested byte keys",
    "00a264736f6c634300081e6178a24101014101020013",
    "not-decoded",
  ],
  [
    "duplicate nested text keys",
    "00a264736f6c634300081e6178a26161016161020013",
    "not-decoded",
  ],
  ["unavailable trailer", "00", "unavailable"],
  ["unsupported tag", "00a16178c0000005", "not-decoded"],
  ["floating point", "00a16178fa3f8000000008", "not-decoded"],
  ["invalid UTF-8", "00a1617861ff0005", "not-decoded"],
])(
  "retains independent %s metadata through the actual worker",
  async (kind, hex, status) => {
    const directory = await createTestTempDirectory("rea-solidity-worker-");
    const snapshot = join(directory, "selected.hex");
    const reply = join(directory, "reply.json");
    const request = join(directory, "request.json");
    await writeFile(snapshot, hex);
    await writeFile(
      request,
      JSON.stringify({
        snapshot_path: snapshot,
        reply_path: reply,
        failure_marker_path: join(directory, "resource.failure"),
        encoding: "hex",
      }),
    );
    await promisify(execFile)(
      process.execPath,
      [
        "--max-old-space-size=256",
        "--disable-wasm-trap-handler",
        fileURLToPath(
          new URL(
            "../../../dist/evm/EvmoleInterfaceWorker.js",
            import.meta.url,
          ),
        ),
        request,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const value = JSON.parse(await readFile(reply, "utf8"));
    expect(value.ok, JSON.stringify(value)).toBe(true);
    expect(value.bytecode.hex).toBe(hex);
    const metadata = solidityMetadataSchema.parse(value.bytecode.metadata);
    expect(metadata.status).toBe(status);
    if (kind === "integer")
      expect(metadata.entries[0]?.value).toEqual({
        kind: "integer",
        value: "18446744073709551615",
      });
    if (kind === "compiler")
      expect(metadata.compiler_version?.value).toBe("0.8.30");
    if (kind === "BOM text")
      expect(metadata.entries[0]?.value).toEqual({
        kind: "text",
        value: "\ufeffa",
      });
    if (kind === "nested value")
      expect(metadata.entries[0]?.value).toEqual({
        kind: "uninterpreted",
        container: "array",
      });
    if (kind === "distinct nested byte keys") {
      expect(metadata.compiler_version?.value).toBe("0.8.30");
      expect(metadata.bytecode_offset).toBe(1);
      expect(metadata.cbor_bytes).toBe(19);
    }
    if (kind.startsWith("duplicate nested")) {
      expect(metadata.entries).toEqual([]);
      expect(metadata.compiler_version).toBeNull();
      expect(metadata.diagnostic).toBe("repeated_map_key");
      expect(metadata.admission).toMatchObject({ code: "repeated_map_key" });
      if (kind === "duplicate nested text keys")
        expect(metadata.admission?.detail).toEqual({
          key: JSON.stringify({ kind: "text", value: "a" }),
        });
      else
        expect(
          metadata.admission?.detail?.key ??
            metadata.admission?.detail?.key_length,
        ).toBeDefined();
      expect(metadata.bytecode_offset).toBe(1);
      expect(metadata.cbor_bytes).toBe(19);
    }
    if (kind === "unavailable trailer") {
      expect(metadata.bytecode_offset).toBeNull();
      expect(metadata.entries).toEqual([]);
      expect(metadata.compiler_version).toBeNull();
    }
  },
);
