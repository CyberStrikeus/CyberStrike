import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { mcpTextValue } from "./mcp-verifier-results.mjs";

/** Exercise source replacement, removal, and restoration against a loaded native document. */
export async function verifyHopperSourceBinding({
  client,
  call,
  path,
  file,
  address,
  mapping,
  relocate,
}) {
  const originalHash = createHash("sha256").update(file).digest("hex");
  const changed = relocate === undefined ? Buffer.from(file) : relocate(file);
  if (relocate === undefined) changed[changed.length - 1] ^= 1;
  const changedHash = createHash("sha256").update(changed).digest("hex");
  const at = (delta) => `0x${(BigInt(address) + BigInt(delta)).toString(16)}`;
  const observeFailure = async (delta) => {
    const reply = await client.callTool(
      { name: "address_to_file_offset", arguments: { address: at(delta) } },
      { timeout: 180_000 },
    );
    assert.equal(
      reply.isError,
      true,
      "mapping unexpectedly accepted an unbound source",
    );
    const error = JSON.parse(mcpTextValue(reply)).error;
    const partial = error.details.partial_observation;
    assert.equal(partial.operation, "address_to_file_offset");
    assert.equal(partial.address, at(delta));
    assert.equal(
      partial.provider_file_offset,
      mapping.provider_file_offset + delta,
    );
    assert.equal(partial.original_file_offset.available, false);
    assert.equal(typeof partial.original_file_offset.reason, "string");
    assert.match(partial.provider_image_header_hex, /^[a-f0-9]{24}$/u);
    return error;
  };
  try {
    await writeFile(path, changed);
    const error = await observeFailure(2);
    assert.equal(error.code, "artifact_changed");
    assert.ok(error.details.reason.includes(originalHash));
    assert.ok(error.details.reason.includes(changedHash));
    assert.equal((await call("binary_session")).sha256, originalHash);
    assert.equal(
      (await call("read_bytes", { address: at(2), length: 1 })).bytes_hex,
      file
        .subarray(mapping.file_offset + 2, mapping.file_offset + 3)
        .toString("hex"),
    );
  } finally {
    await writeFile(path, file);
  }
  const renamed = `${path}.temporarily-moved`;
  await rename(path, renamed);
  try {
    const error = await observeFailure(3);
    assert.equal(error.code, "target_unavailable");
    assert.match(error.details.reason, /ENOENT/u);
  } finally {
    await rename(renamed, path);
  }
  await rename(path, renamed);
  try {
    await mkdir(path);
    const error = await observeFailure(4);
    assert.equal(error.code, "artifact_changed");
    assert.match(error.details.reason, /no longer a regular file/u);
  } finally {
    await rm(path, { recursive: true, force: true });
    await rename(renamed, path);
  }
  const permissionDenied = process.getuid() !== 0;
  if (permissionDenied) {
    const mode = (await stat(path)).mode & 0o777;
    try {
      await chmod(path, 0);
      const error = await observeFailure(5);
      assert.equal(error.code, "access_denied");
      assert.ok(["EACCES", "EPERM"].includes(error.details.system_code));
    } finally {
      await chmod(path, mode);
    }
  }
  for (const delta of [2, 3, 4, ...(permissionDenied ? [5] : [])]) {
    const recovered = await call("address_to_file_offset", {
      address: at(delta),
    });
    assert.equal(recovered.file_offset, mapping.file_offset + delta);
  }
  return {
    replacement: relocate === undefined ? "same_size_bytes" : "relocated_slice",
    missingSource: "verified",
    nonregularSource: "verified",
    permissionDenied: permissionDenied ? "verified" : "not_run_root",
    nativePartialEvidence: "verified",
    recovery: "verified",
  };
}

/** Relocate the sole FAT slice while retaining its exact loaded bytes and CPU identity. */
export function relocateSingleFatSlice(file) {
  const wide = file.readUInt32BE(0) === 0xcafebabf;
  assert.equal(file.readUInt32BE(4), 1);
  const offset = wide
    ? Number(file.readBigUInt64BE(16))
    : file.readUInt32BE(16);
  const size = wide ? Number(file.readBigUInt64BE(24)) : file.readUInt32BE(20);
  const relocated = Buffer.alloc(offset * 2 + size);
  file.subarray(0, offset).copy(relocated);
  file.subarray(offset, offset + size).copy(relocated, offset * 2);
  if (wide) relocated.writeBigUInt64BE(BigInt(offset * 2), 16);
  else relocated.writeUInt32BE(offset * 2, 16);
  return relocated;
}
