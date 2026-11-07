import { setImmediate } from "node:timers/promises";

import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "../ArtifactReader.js";
import {
  NODE_SEA_ASSET_COUNT,
  NODE_SEA_ASSET_NAME_BYTES,
  NODE_SEA_BAD_MAGIC,
  NODE_SEA_EMPTY_CODE_PATH,
  NODE_SEA_FUSE_CONFLICT,
  NODE_SEA_FUSE_ABSENT,
  NODE_SEA_FUSE_UNSET,
  NODE_SEA_MAGIC,
  NODE_SEA_TRAILING_BYTES,
  NODE_SEA_TRUNCATED,
  NODE_SEA_UNKNOWN_EXTENSION,
  NODE_SEA_UNKNOWN_FLAGS,
  decodeNodeSeaBlob,
  nodeSeaAssetCollision,
  observeNodeSeaFuseMatches,
} from "./NodeSeaBlob.js";
import { buildNodeSeaBlob } from "./NodeSea.fixture.js";

const header = (flags: number, extension = 1): Buffer => {
  const bytes = Buffer.alloc(9);
  bytes.writeUInt32LE(NODE_SEA_MAGIC, 0);
  bytes.writeUInt32LE(flags, 4);
  bytes[8] = extension;
  return bytes;
};

it("rejects a blob that ends before the magic", async () => {
  await expect(decodeNodeSeaBlob(Buffer.from([0x20, 0xda]))).rejects.toThrow(
    NODE_SEA_TRUNCATED,
  );
});

it("rejects a blob whose magic is not 0x143da20", async () => {
  await expect(decodeNodeSeaBlob(Buffer.alloc(9))).rejects.toThrow(
    NODE_SEA_BAD_MAGIC,
  );
});

it("rejects a header that ends before the extension byte", async () => {
  await expect(decodeNodeSeaBlob(header(0).subarray(0, 8))).rejects.toThrow(
    NODE_SEA_TRUNCATED,
  );
});

it("rejects unknown flag bits", async () => {
  await expect(decodeNodeSeaBlob(header(1 << 5))).rejects.toThrow(
    NODE_SEA_UNKNOWN_FLAGS,
  );
});

it("rejects an unknown exec argv extension", async () => {
  await expect(decodeNodeSeaBlob(header(0, 9))).rejects.toThrow(
    NODE_SEA_UNKNOWN_EXTENSION,
  );
});

it("rejects an empty code path", async () => {
  await expect(
    decodeNodeSeaBlob(buildNodeSeaBlob({ codePath: "" })),
  ).rejects.toThrow(NODE_SEA_EMPTY_CODE_PATH);
});

it("rejects a truncated length-prefixed field", async () => {
  const bytes = Buffer.concat([header(0), Buffer.alloc(4)]);
  await expect(decodeNodeSeaBlob(bytes)).rejects.toThrow(NODE_SEA_TRUNCATED);
});

it("rejects colliding asset names", async () => {
  await expect(
    decodeNodeSeaBlob(
      buildNodeSeaBlob({
        assets: [
          { name: "shared", body: "one" },
          { name: "shared", body: "two" },
        ],
      }),
    ),
  ).rejects.toThrow(nodeSeaAssetCollision("shared"));
});

it("retains an empty asset key as a raw Node SEA key", async () => {
  const decoded = await decodeNodeSeaBlob(
    buildNodeSeaBlob({ assets: [{ name: "", body: "value" }] }),
  );
  expect(decoded.assets).toMatchObject([{ name: "", range: { length: 5 } }]);
});

const limitOf = async (bytes: Buffer): Promise<ArtifactReaderFailure> => {
  try {
    await decodeNodeSeaBlob(bytes);
  } catch (cause) {
    if (cause instanceof ArtifactReaderFailure) return cause;
    throw cause;
  }
  throw new Error("expected a limit failure");
};

it("refuses an asset table over its count bound before creating records", async () => {
  const prefix = buildNodeSeaBlob({ assets: [{ name: "a", body: "" }] });
  const count = Buffer.alloc(8);
  count.writeBigUInt64LE(100_001n);
  // Replace the declared count; the bound is checked before the table length.
  const bytes = Buffer.concat([prefix.subarray(0, -25), count]);
  const failure = await limitOf(bytes);
  expect(failure).toMatchObject({
    reason: "limit",
    message: NODE_SEA_ASSET_COUNT,
  });
});

it("refuses asset names over the decoded name budget", async () => {
  const name = "n".repeat(4 * 1024 * 1024 + 1);
  const failure = await limitOf(
    buildNodeSeaBlob({
      assets: [
        { name: `a${name}`, body: "" },
        { name: `b${name}`, body: "" },
      ],
    }),
  );
  expect(failure).toMatchObject({
    reason: "limit",
    message: NODE_SEA_ASSET_NAME_BYTES,
  });
});

it("rejects non-zero trailing bytes and keeps zero padding", async () => {
  const padded = buildNodeSeaBlob({ trailing: Buffer.alloc(8) });
  expect((await decodeNodeSeaBlob(padded)).codePath).toBe("sea.js");
  const dirty = Buffer.concat([padded, Buffer.from([1])]);
  await expect(decodeNodeSeaBlob(dirty)).rejects.toThrow(
    NODE_SEA_TRAILING_BYTES,
  );
});

it("decodes flags, the main script, code cache, assets, and exec argv", async () => {
  const decoded = await decodeNodeSeaBlob(
    buildNodeSeaBlob({
      codePath: "app/main.js",
      main: "console.log(1)\n",
      codeCache: Buffer.from([1, 2, 3]),
      assets: [{ name: "pkg/data.txt", body: "asset" }],
      execArgv: ["--no-warnings", ""],
      disableExperimentalSeaWarning: true,
      execArgvExtension: 2,
    }),
  );
  expect(decoded).toMatchObject({
    flags: (1 << 0) | (1 << 2) | (1 << 3) | (1 << 4),
    disableExperimentalSeaWarning: true,
    useSnapshot: false,
    useCodeCache: true,
    includeAssets: true,
    includeExecArgv: true,
    execArgvExtension: "cli",
    codePath: "app/main.js",
    execArgv: ["--no-warnings", ""],
    assets: [{ name: "pkg/data.txt" }],
  });
  expect(decoded.mainScript?.length).toBe(
    Buffer.byteLength("console.log(1)\n"),
  );
  expect(decoded.snapshot).toBeNull();
  expect(decoded.codeCache?.length).toBe(3);
});

it("treats the body as a snapshot when that flag is set", async () => {
  const decoded = await decodeNodeSeaBlob(
    buildNodeSeaBlob({
      codePath: "sea.js",
      snapshot: Buffer.from("snap"),
    }),
  );
  expect(decoded.useSnapshot).toBe(true);
  expect(decoded.mainScript).toBeNull();
  expect(decoded.snapshot?.length).toBe(4);
});

it("reports an absent, unset, set, or conflicting fuse sentinel", () => {
  expect(observeNodeSeaFuseMatches([])).toMatchObject({
    fuseState: "absent",
    fuseSentinel: null,
    fuseContradiction: NODE_SEA_FUSE_ABSENT,
  });
  const unset = `NODE_SEA_FUSE_${"a".repeat(32)}:0`;
  expect(observeNodeSeaFuseMatches([unset, unset])).toMatchObject({
    fuseState: "unset",
    fuseSentinel: unset,
    fuseContradiction: NODE_SEA_FUSE_UNSET,
  });
  const set = `NODE_SEA_FUSE_${"b".repeat(32)}:1`;
  expect(observeNodeSeaFuseMatches([set])).toMatchObject({
    fuseState: "set",
    fuseSentinel: set,
    fuseContradiction: null,
  });
  expect(observeNodeSeaFuseMatches([unset, set])).toMatchObject({
    fuseState: "conflicting",
    fuseSentinel: null,
    fuseContradiction: NODE_SEA_FUSE_CONFLICT,
  });
});

it.each([
  [
    "assets",
    () =>
      buildNodeSeaBlob({
        assets: Array.from({ length: 1024 }, (_, index) => ({
          name: `asset-${String(index)}`,
          body: "",
        })),
      }),
  ],
  [
    "exec arguments",
    () =>
      buildNodeSeaBlob({
        execArgv: Array.from({ length: 1024 }, () => "--no-warnings"),
      }),
  ],
  [
    "zero padding",
    () => buildNodeSeaBlob({ trailing: Buffer.alloc(1024 * 1024) }),
  ],
] as const)("observes cancellation while decoding %s", async (_name, build) => {
  const bytes = build();
  const controller = new AbortController();
  const reason = { stage: "decoding" };
  const pending = decodeNodeSeaBlob(bytes, controller.signal);
  // Let a batch run; cancellation must be observed before the whole table or
  // padding scan finishes, without relying on elapsed-time assertions.
  await setImmediate();
  controller.abort(reason);
  await expect(pending).rejects.toMatchObject({
    reason: "cancelled",
    cause: reason,
  });
});

it("preserves cancellation before decoding even a malformed blob", async () => {
  const reason = { stage: "before decoding" };
  await expect(
    decodeNodeSeaBlob(Buffer.alloc(0), AbortSignal.abort(reason)),
  ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
});
