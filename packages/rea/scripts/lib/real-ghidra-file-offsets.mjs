import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../dist/domain/evidence.js";
import {
  createGhidraVerifierMcpOperations,
  resolveGhidraVerifierTimeouts,
} from "./ghidra-verifier-timeouts.mjs";
import {
  requireMcpOperationResult,
  requireMcpToolError,
  mcpTextValue,
} from "./mcp-verifier-results.mjs";

/** Exercise file coordinates through public CLI/MCP using the source-owned PE fixture. */
export async function verifyGhidraFileOffsets(
  targetPath,
  entrypoint,
  procedure,
) {
  const environment = {
    ...process.env,
    REA_ANALYSIS_PROVIDER: "ghidra",
    REA_LOG_LEVEL: "silent",
  };
  const { requestOptions } = resolveGhidraVerifierTimeouts(environment);
  const timeoutMs = requestOptions.timeout;
  const original = await readFile(targetPath);
  const workspace = await mkdtemp(join(tmpdir(), "rea-file-offsets-"));
  const runtime = join(workspace, "runtime");
  await mkdir(runtime);
  const env = {
    ...environment,
    TEMP: runtime,
    TMP: runtime,
    TMPDIR: runtime,
  };
  const client = new Client({ name: "rea-file-offsets", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env,
    stderr: "pipe",
  });
  const mcp = createGhidraVerifierMcpOperations(client, requestOptions);
  let connected = false;
  let complete = false;
  let primaryFailure;
  const call = async (name, arguments_ = {}) => {
    const result = await mcp.callTool({ name, arguments: arguments_ });
    const projected = requireMcpOperationResult(result, name);
    return ["open_binary", "binary_session", "close_binary"].includes(name)
      ? projected
      : (result.structuredContent ?? JSON.parse(mcpTextValue(result)));
  };
  try {
    await mcp.connect(transport);
    connected = true;
    await call("open_binary", { path: targetPath, provider_id: "ghidra" });
    const session = await call("binary_session");
    const mapping = parseEvidence(
      await call("address_to_file_offset", { address: procedure }),
    );
    const offset = mapping.normalized_result.file_offset;
    const coordinate = `0x${offset.toString(16)}`;
    const expected = parseEvidence(
      await call("procedure_pseudo_code", { procedure }),
    );
    const explicit = parseEvidence(
      await call("procedure_pseudo_code", {
        procedure: `file-offset:${coordinate}`,
      }),
    );
    const automatic = parseEvidence(
      await call("procedure_pseudo_code", { procedure: coordinate }),
    );
    for (const actual of [explicit, automatic]) {
      assert.equal(actual.normalized_result, expected.normalized_result);
      assert.equal(actual.raw_result.selection.file_offset, offset);
      assert.equal(actual.raw_result.selection.mapped_address, procedure);
      assert.ok(
        actual.locations.some(
          (location) =>
            location.kind === "file-offset" && location.offset === offset,
        ),
      );
    }
    const invalid = await mcp.callTool({
      name: "procedure_pseudo_code",
      arguments: { procedure: "file-offset:0x20000000000000" },
    });
    assert.equal(requireMcpToolError(invalid).code, "invalid_request");
    const unmapped = await mcp.callTool({
      name: "procedure_pseudo_code",
      arguments: { procedure: "file-offset:0x100000" },
    });
    assert.ok(
      JSON.stringify(requireMcpToolError(unmapped)).includes(
        "no loaded source mapping",
      ),
    );
    assert.equal(
      (await call("binary_session")).analysis_run.run_id,
      session.analysis_run.run_id,
    );
    const image = parseEvidence(await call("inspect_native_load_image"));
    const headerMapping = image.normalized_result.observations.mappings.find(
      (item) => item.initialized && item.file_offset === 0,
    );
    assert.ok(
      headerMapping,
      "Fixture header must have an observed source mapping",
    );
    const headerOffset = parseEvidence(
      await call("address_to_file_offset", { address: headerMapping.start }),
    );
    assert.equal(headerOffset.normalized_result.file_offset, 0);
    for (const selector of ["file-offset:0x0", "0x0"]) {
      const missing = requireMcpToolError(
        await mcp.callTool({
          name: "procedure_pseudo_code",
          arguments: { procedure: selector },
        }),
      );
      assertMissingMappedProcedure(missing, headerMapping.start);
    }
    assert.equal(
      (await call("binary_session")).analysis_run.run_id,
      session.analysis_run.run_id,
    );
    await call("close_binary");
    const cli = JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [
            entrypoint,
            "decompile",
            targetPath,
            `--file-offset=${coordinate}`,
            "--provider",
            "ghidra",
            "--json",
          ],
          { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        )
      ).stdout,
    );
    assert.equal(cli.normalized_result, explicit.normalized_result);
    assert.deepEqual(cli.locations, explicit.locations);
    const missingCli = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "decompile",
        targetPath,
        "--file-offset=0x0",
        "--provider",
        "ghidra",
        "--json",
      ],
      { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
    ).then(
      () => {
        throw new Error(
          "Mapped header bytes must not decompile as a procedure",
        );
      },
      (cause) => JSON.parse(cause.stdout),
    );
    assertMissingMappedProcedure(missingCli, headerMapping.start);
    const alias = Buffer.from(original);
    const pe = alias.readUInt32LE(0x3c);
    if (alias.readUInt16LE(pe + 6) >= 2) {
      const secondSection = pe + 24 + alias.readUInt16LE(pe + 20) + 40;
      // Both sections now carry the same original bytes at distinct virtual addresses.
      alias.writeUInt32LE(0x200, secondSection + 20);
      const ambiguousPath = join(workspace, "ambiguous.exe");
      await writeFile(ambiguousPath, alias);
      await call("open_binary", { path: ambiguousPath, provider_id: "ghidra" });
      const ambiguous = await mcp.callTool({
        name: "procedure_pseudo_code",
        arguments: { procedure: `file-offset:${coordinate}` },
      });
      assert.ok(
        JSON.stringify(requireMcpToolError(ambiguous)).includes(
          "multiple loaded mappings",
        ),
      );
      await call("close_binary");
    }
    assert.deepEqual(await readFile(targetPath), original);
    await client.close();
    connected = false;
    assert.deepEqual(await readdir(runtime), []);
    complete = true;
    return {
      cli_mcp_parity: true,
      explicit_and_numeric_offsets: true,
      invalid_and_unmapped_offsets: true,
      mapped_offset_without_procedure: true,
      ambiguous_mappings:
        alias.readUInt16LE(pe + 6) >= 2
          ? "verified"
          : "unavailable-single-section",
      source_unchanged: true,
      cleanup: "complete",
    };
  } catch (cause) {
    primaryFailure = cause;
    throw cause;
  } finally {
    const cleanupFailures = [];
    if (connected) {
      try {
        await call("close_binary");
      } catch (cause) {
        cleanupFailures.push(cause);
      }
    }
    try {
      await client.close();
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    if (cleanupFailures.length > 0) {
      process.stderr.write(
        `Retained file-offset verifier workspace: ${workspace}\n`,
      );
      throw new AggregateError(
        primaryFailure === undefined
          ? cleanupFailures
          : [primaryFailure, ...cleanupFailures],
        "File-offset verifier cleanup failed",
      );
    }
    if (complete) await rm(workspace, { recursive: true, force: true });
    else
      process.stderr.write(
        `Retained file-offset verifier workspace: ${workspace}\n`,
      );
  }
}

function assertMissingMappedProcedure(error, mappedAddress) {
  assert.equal(error.code, "invalid_request");
  const message = error.details?.issues?.[0]?.message;
  assert.equal(typeof message, "string");
  assert.ok(
    message.includes("File offset 0x0 maps to analysis address"),
    message,
  );
  assert.ok(message.includes(mappedAddress), message);
  assert.ok(message.includes("no procedure starts at or contains"), message);
  assert.ok(!message.includes("--file-offset"), message);
}
