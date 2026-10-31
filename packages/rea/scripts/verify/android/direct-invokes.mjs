import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { hashAndroidFile } from "./digest.mjs";

/** The public result keeps one using node and exposes its two raw DEX invokes. */
export const verifyAndroidDirectInvokes = async ({
  apk,
  dexEntry,
  repository,
  entrypoint,
  environment,
  execute,
}) => {
  const digest = await hashAndroidFile(apk);
  const check = (value) => {
    const evidence = parseEvidence(value);
    assert.equal(evidence.subject.digest.sha256, digest);
    assert.equal(evidence.operation, "trace_android_references");
    const result = evidence.normalized_result;
    assert.equal(result.class_name, "fixture.Target");
    assert.equal(result.method_name, "mark");
    assert.equal(result.dex_descriptor, "()V");
    assert.equal(result.reference_unit, "using_node");
    assert.equal(result.total, 1);
    assert.equal(result.references.length, 1);
    const source = result.references[0];
    assert.equal(source.reported_full_name, "fixture.Caller.twice");
    assert.deepEqual(
      source.direct_invokes.map((site) => site.dex_code_unit_offset),
      [0, 3],
    );
    for (const site of source.direct_invokes) {
      assert.equal(site.dex_entry, dexEntry);
      assert.equal(site.source_raw_method_id, "fixture.Caller.twice()V");
      assert.equal(site.opcode, "INVOKE_STATIC");
    }
    assert.equal(
      source.direct_invokes[0].dex_method_index,
      source.direct_invokes[1].dex_method_index,
    );
    return evidence;
  };
  const cliResponse = await execute(
    process.execPath,
    [
      entrypoint,
      "trace-android-references",
      apk,
      "fixture.Target",
      "--method-name",
      "mark",
      "--format",
      "json",
    ],
    {
      cwd: repository,
      env: environment,
      timeout: 150_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const cli = check(JSON.parse(cliResponse.stdout));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    cwd: repository,
    env: environment,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({
    name: "rea-real-android-direct-invokes",
    version: "1",
  });
  try {
    await client.connect(transport, { timeout: 30_000 });
    const response = await client.callTool(
      {
        name: "trace_android_references",
        arguments: {
          path: apk,
          class_name: "fixture.Target",
          method_name: "mark",
        },
      },
      { timeout: 150_000 },
    );
    assert.notEqual(response.isError, true, JSON.stringify(response));
    const mcp = check(response.structuredContent);
    assert.deepEqual(mcp.normalized_result, cli.normalized_result);
    assert.deepEqual(mcp.parameters, cli.parameters);
    assert.deepEqual(mcp.provider, cli.provider);
  } catch (cause) {
    process.stderr.write(stderr);
    throw cause;
  } finally {
    await client.close();
  }
  assert.equal(
    await hashAndroidFile(apk),
    digest,
    "Static inspection changed fixture bytes",
  );
  console.log(
    `PASS real CLI/MCP direct-invoke offsets from ${dexEntry}, parity and unchanged APK`,
  );
};
