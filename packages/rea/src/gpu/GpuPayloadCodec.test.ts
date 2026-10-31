import { expect, it } from "vitest";
import { deflateSync, zstdCompressSync } from "node:zlib";
import { decodeGpuPayload, decodeGpuPayloadStream } from "./GpuPayloadCodec.js";
it.each(["zlib", "zstd"] as const)(
  "requires all declared %s input bytes to belong to the codec stream",
  async (codec) => {
    const source = Buffer.from("kernel"),
      encode = codec === "zstd" ? zstdCompressSync : deflateSync,
      compressed = encode(source);
    expect(
      Buffer.compare(
        await decodeGpuPayload(compressed, codec, source.length),
        source,
      ),
    ).toBe(0);
    await expect(
      decodeGpuPayload(
        Buffer.concat([compressed, Buffer.from("junk")]),
        codec,
        source.length,
      ),
    ).rejects.toMatchObject({ kind: "malformed" });
  },
);
it.each(["zlib", "zstd"] as const)(
  "retains completed %s input accounting before trailing container bytes",
  async (codec) => {
    const source = Buffer.from("ordinary CCOB marker"),
      compressed =
        codec === "zstd"
          ? zstdCompressSync(source)
          : deflateSync(source, { level: 0 }),
      input = Buffer.concat([
        compressed,
        Buffer.from("CCOB following container"),
      ]);
    expect(await decodeGpuPayloadStream(input, codec, source.length)).toEqual({
      buffer: source,
      consumedBytes: compressed.length,
    });
    await expect(
      decodeGpuPayloadStream(compressed.subarray(0, -1), codec, source.length),
    ).rejects.toMatchObject({ kind: "malformed" });
    await expect(
      decodeGpuPayload(compressed, codec, source.length + 1),
    ).rejects.toMatchObject({ kind: "malformed" });
  },
);
