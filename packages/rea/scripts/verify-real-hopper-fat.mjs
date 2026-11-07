import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  mcpTextValue,
  requireMcpOperationResult,
} from "./lib/mcp-verifier-results.mjs";
import { snapshotHopperRuntime } from "./lib/real-hopper-cleanup.mjs";
import { HOPPER_TARGET_LEASE_DIRECTORY } from "../dist/process/HopperLease.js";
import { parseConfig } from "../dist/config/parseConfig.js";
import {
  verifyHopperSourceBinding,
  relocateSingleFatSlice,
} from "./lib/real-hopper-source-binding.mjs";

const run = promisify(execFile);
const verifyFat64 = process.argv[2] === "--fat64";
assert.deepEqual(process.argv.slice(2), verifyFat64 ? ["--fat64"] : []);
if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
  throw new Error(
    "Hopper FAT verification requires macOS arm64 or x64 and its installed clang/lipo toolchain",
  );
const config = parseConfig(process.env);
if (!config.ok) throw config.error;
await access(config.value.hopperLauncherPath, constants.X_OK).catch((cause) => {
  throw new Error(
    `Hopper FAT verification requires the configured executable: ${config.value.hopperLauncherPath}`,
    { cause },
  );
});
const toolPaths = {};
for (const command of ["clang", "lipo"])
  toolPaths[command] = (
    await run("xcrun", ["--find", command]).catch((cause) => {
      throw new Error(`Hopper FAT verification requires ${command}`, { cause });
    })
  ).stdout.trim();
const sdk = (
  await run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).catch((cause) => {
    throw new Error(
      "Hopper FAT verification requires the installed macOS SDK",
      { cause },
    );
  })
).stdout.trim();

const directory = await realpath(await mkdtemp(join(tmpdir(), "hopper-fat-")));
const source = fileURLToPath(
  new URL("../tests/conformance/c/fixture.c", import.meta.url),
);
const arm = join(directory, "c-arm64");
const intel = join(directory, "c-x86_64");
const fat = join(directory, "c-fat");
const fat64 = join(directory, "c-fat64");
const singleFat = join(directory, "c-single-fat");
const owned = new Set();
const extraFat64 = [];
const invalidFat64 = [];
let preparedImagePath;
const before = await snapshotHopperRuntime(
  "/tmp",
  HOPPER_TARGET_LEASE_DIRECTORY,
);
const client = new Client({ name: "hopper-fat-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/main.js"],
  env: {
    ...process.env,
    REA_ANALYSIS_PROVIDER: "hopper",
    HOPPER_LOADER_ARGS_JSON: "[]",
  },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const observations = [];
const sourceBinding = [];
try {
  await run(toolPaths.clang, [
    "-isysroot",
    sdk,
    "-arch",
    "arm64",
    "-O0",
    "-fno-inline",
    source,
    "-o",
    arm,
  ]);
  await run(toolPaths.clang, [
    "-isysroot",
    sdk,
    "-arch",
    "x86_64",
    "-O0",
    "-fno-inline",
    source,
    "-o",
    intel,
  ]);
  await run(toolPaths.lipo, ["-create", arm, intel, "-output", fat]);
  if (verifyFat64)
    await run(toolPaths.lipo, [
      "-create",
      arm,
      intel,
      "-fat64",
      "-output",
      fat64,
    ]);
  await run(toolPaths.lipo, [
    "-create",
    process.arch === "arm64" ? arm : intel,
    "-output",
    singleFat,
  ]);
  if (verifyFat64) {
    const original = await readFile(fat64);
    const swapped = Buffer.from(original);
    swapped.writeUInt32BE(0xbfbafeca, 0);
    swapped.writeUInt32LE(original.readUInt32BE(4), 4);
    for (let index = 0; index < original.readUInt32BE(4); index++) {
      const offset = 8 + index * 32;
      for (const field of [0, 4, 24, 28])
        swapped.writeUInt32LE(
          original.readUInt32BE(offset + field),
          offset + field,
        );
      for (const field of [8, 16])
        swapped.writeBigUInt64LE(
          original.readBigUInt64BE(offset + field),
          offset + field,
        );
    }
    const little = join(directory, "c-fat64-little-endian");
    await writeFile(little, swapped);
    extraFat64.push(little);
    const single = join(directory, "c-single-fat64");
    await run(toolPaths.lipo, [
      "-create",
      process.arch === "arm64" ? arm : intel,
      "-fat64",
      "-output",
      single,
    ]);
    extraFat64.push(single);
    for (const [name, reason, mutate] of [
      [
        "reserved",
        /nonzero reserved field/u,
        (bytes) => bytes.writeUInt32BE(1, 36),
      ],
      [
        "range",
        /extends beyond the file/u,
        (bytes) => bytes.writeBigUInt64BE(BigInt(bytes.length), 24),
      ],
      [
        "identity",
        /disagrees with its Mach-O header/u,
        (bytes) => bytes.writeUInt32BE(bytes.readUInt32BE(12) + 1, 12),
      ],
      [
        "overlap",
        /slices overlap/u,
        (bytes) => {
          const cpu = process.arch === "arm64" ? 0x100000c : 0x1000007;
          const base = bytes.readUInt32BE(8) === cpu ? 8 : 40;
          bytes.copy(bytes, base === 8 ? 40 : 8, base, base + 32);
        },
      ],
    ]) {
      const bytes = Buffer.from(original);
      mutate(bytes);
      const path = join(directory, `c-fat64-invalid-${name}`);
      await writeFile(path, bytes);
      invalidFat64.push({ path, reason });
    }
    const hostBytes = await readFile(process.arch === "arm64" ? arm : intel);
    const secondOffset = Math.ceil((16384 + hostBytes.length) / 16384) * 16384;
    const ambiguous = Buffer.alloc(secondOffset + hostBytes.length);
    ambiguous.writeUInt32BE(0xcafebabf, 0);
    ambiguous.writeUInt32BE(2, 4);
    for (const [index, offset] of [16384, secondOffset].entries()) {
      const base = 8 + index * 32;
      ambiguous.writeUInt32BE(hostBytes.readUInt32LE(4), base);
      ambiguous.writeUInt32BE(hostBytes.readUInt32LE(8), base + 4);
      ambiguous.writeBigUInt64BE(BigInt(offset), base + 8);
      ambiguous.writeBigUInt64BE(BigInt(hostBytes.length), base + 16);
      ambiguous.writeUInt32BE(14, base + 24);
      hostBytes.copy(ambiguous, offset);
    }
    const path = join(directory, "c-fat64-ambiguous");
    await writeFile(path, ambiguous);
    invalidFat64.push({ path, reason: /selection.*ambiguous/u });
  }
  await client.connect(transport);
  assert.ok(transport.pid !== null);
  owned.add(transport.pid);
  const catalog = await client.listTools();
  const call = async (name, args = {}) => {
    const reply = await client.callTool(
      { name, arguments: args },
      { timeout: 180_000 },
    );
    const result = requireMcpOperationResult(reply, name);
    const schema = catalog.tools.find(
      (tool) => tool.name === name,
    )?.outputSchema;
    assert.ok(schema, `${name} omitted its output schema`);
    assert.equal(
      ajv.validate(schema, reply.structuredContent),
      true,
      JSON.stringify(ajv.errors),
    );
    return result;
  };
  const cliMappings = new Map();
  for (const path of [
    arm,
    intel,
    fat,
    singleFat,
    ...(verifyFat64 ? [fat64, ...extraFat64] : []),
  ]) {
    console.error(`Verifying Hopper source-file mappings for ${path}`);
    const file = await readFile(path);
    const sourceHash = createHash("sha256").update(file).digest("hex");
    await call("open_binary", { path });
    const procedures = await call("list_procedures");
    const entry = procedures.find((item) => item.value.endsWith("rea_entry"));
    assert.ok(entry, "compiler fixture omitted rea_entry");
    let entryMapping;
    for (const address of [
      entry.address,
      `0x${(BigInt(entry.address) + 1n).toString(16)}`,
    ]) {
      const mapping = await call("address_to_file_offset", { address });
      if (address === entry.address) entryMapping = mapping;
      const bytes = await call("read_bytes", { address, length: 16 });
      assert.equal(
        mapping.file_offset,
        mapping.image_base_file_offset + mapping.provider_file_offset,
      );
      assert.equal(mapping.source_path, path);
      assert.equal(bytes.complete, true);
      assert.equal(
        file
          .subarray(mapping.file_offset, mapping.file_offset + 16)
          .toString("hex"),
        bytes.bytes_hex,
      );
      if (
        path === fat ||
        path === singleFat ||
        path === fat64 ||
        extraFat64.includes(path)
      ) {
        assert.ok(
          mapping.image_base_file_offset > 0,
          "FAT mapping omitted its physical slice offset",
        );
        assert.notEqual(
          file
            .subarray(
              mapping.provider_file_offset,
              mapping.provider_file_offset + 16,
            )
            .toString("hex"),
          bytes.bytes_hex,
          "fixture did not distinguish image-relative and original-file coordinates",
        );
      } else assert.equal(mapping.image_base_file_offset, 0);
      if (path === fat || path === fat64) {
        cliMappings.set(path, { mapping, address });
      }
      observations.push({ path, address, ...mapping, matched_bytes: 16 });
    }
    if (path === fat64 || extraFat64.includes(path)) {
      const session = await call("binary_session");
      assert.equal(session.path, path);
      assert.equal(session.sha256, sourceHash);
      const profile = session.analysis_provider_binding.analysis_profile;
      assert.equal(
        profile.parameters.prepared_image.method,
        "fat64_thin_slice",
      );
      assert.equal(
        profile.parameters.prepared_image.source_offset,
        observations.at(-1).image_base_file_offset,
      );
      const document = await call("current_document");
      await call("set_comment", {
        address: entry.address,
        comment: "source-bound FAT64 preparation",
      });
      await call("open_binary", { path });
      assert.deepEqual(
        (await call("binary_session")).analysis_provider_binding
          .analysis_profile,
        profile,
      );
      assert.equal(await call("current_document"), document);
      assert.equal(
        await call("comment", { address: entry.address }),
        "source-bound FAT64 preparation",
      );
    }
    assert.equal(
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
      sourceHash,
      "native analysis modified source executable bytes",
    );
    sourceBinding.push({
      path,
      ...(await verifyHopperSourceBinding({
        client,
        call,
        path,
        file,
        address: entry.address,
        mapping: entryMapping,
        ...(path === singleFat || path.endsWith("c-single-fat64")
          ? { relocate: relocateSingleFatSlice }
          : {}),
      })),
    });
    await call("close_binary");
  }
  for (const { path, reason } of invalidFat64) {
    const reply = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    assert.equal(reply.isError, true, "malformed FAT64 unexpectedly launched");
    assert.match(mcpTextValue(reply), reason);
  }
  if (verifyFat64) {
    await call("open_binary", { path: fat64 });
    await call("list_procedures");
    const resources = [
      ...(await snapshotHopperRuntime(
        "/tmp",
        HOPPER_TARGET_LEASE_DIRECTORY,
        owned,
      )),
    ].filter((path) => !before.has(path));
    for (const root of resources) {
      const image = join(root, "image.macho");
      if (
        await access(image).then(
          () => true,
          () => false,
        )
      )
        preparedImagePath = image;
    }
    assert.ok(
      preparedImagePath,
      "prepared native image was not owned by this session",
    );
    await client.close();
    await transport.close();
    await assert.rejects(access(preparedImagePath), { code: "ENOENT" });
  }
  for (const [path, expected] of cliMappings) {
    const pending = run(
      process.execPath,
      [
        "scripts/rea.mjs",
        "address-to-file-offset",
        path,
        expected.address,
        "--provider",
        "hopper",
        "--format",
        "json",
      ],
      {
        timeout: 180_000,
        env: { ...process.env, HOPPER_LOADER_ARGS_JSON: "[]" },
      },
    );
    assert.ok(pending.child.pid !== undefined);
    owned.add(pending.child.pid);
    const cli = JSON.parse((await pending).stdout);
    assert.deepEqual(cli.normalized_result, expected.mapping);
  }
} finally {
  await client.close();
  await transport.close();
  await rm(directory, { recursive: true, force: true });
}
const retained = [
  ...(await snapshotHopperRuntime(
    "/tmp",
    HOPPER_TARGET_LEASE_DIRECTORY,
    owned,
  )),
].filter((path) => !before.has(path));
assert.deepEqual(
  retained,
  [],
  "FAT verification retained owned Hopper sessions or leases",
);
console.log(
  JSON.stringify(
    {
      observations,
      cliMcpParity: true,
      sourceBinding,
      fat64: verifyFat64 ? "verified" : "not_run",
      malformedFat64Rejected: invalidFat64.length,
      preparedImageRemovedOnMcpShutdown: preparedImagePath !== undefined,
      cleanShutdown: true,
    },
    null,
    2,
  ),
);
