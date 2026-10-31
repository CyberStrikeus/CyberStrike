import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

// These scripts exercise the public adapters with WABT-shaped responses. They
// do not establish how the real WABT release classifies the selected bytes.
cliTest.runIf(process.platform !== "win32")(
  "retains selected, candidate, and glue facts after simulated WABT rejection through CLI and stdio MCP",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-wasm-acquired-");
    const tools = join(directory, "tools");
    await mkdir(tools);
    for (const name of ["wasm-validate", "wasm-objdump", "wasm2wat"]) {
      const path = join(tools, name);
      const body =
        name === "wasm-validate"
          ? "echo 'fixture validation rejected' >&2\nexit 1"
          : "exit 0";
      await writeFile(
        path,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo '1.0.42'; exit 0; fi
${body}
`,
        { mode: 0o700 },
      );
      await chmod(path, 0o700);
    }
    const selected = join(directory, "selected.wasm");
    const candidate = join(directory, "candidate.wasm");
    const glue = join(directory, "glue.js");
    const selectedBytes = Buffer.from("0061736d01000000", "hex");
    const candidateBytes = Buffer.from("independent candidate bytes");
    const glueSource = 'fetch("./selected.wasm");';
    const environment = {
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory,
      REA_WABT_BIN_DIRECTORY: tools,
    };
    await Promise.all([
      writeFile(selected, selectedBytes),
      writeFile(candidate, candidateBytes),
      writeFile(glue, glueSource),
    ]);
    const expected = {
      artifact: {
        path: selected,
        sha256: sha256(selectedBytes),
        bytes: selectedBytes.length,
      },
      candidates: [
        {
          path: selected,
          sha256: sha256(selectedBytes),
          bytes: selectedBytes.length,
        },
        {
          path: candidate,
          sha256: sha256(candidateBytes),
          bytes: candidateBytes.length,
        },
      ],
      glue: [
        {
          artifact: {
            path: glue,
            sha256: sha256(glueSource),
            bytes: Buffer.byteLength(glueSource),
          },
          parse_status: "complete",
          references: [
            {
              value: "./selected.wasm",
              candidate_paths: [selected],
            },
          ],
        },
      ],
      validation: "rejected-by-selected-profile",
      tool_profile: { release: "1.0.42" },
      exit_code: 1,
      stderr: "fixture validation rejected\n",
    };
    const invocation = await cli.run({
      arguments: [
        "inspect-wasm-artifact",
        selected,
        "--candidate_paths",
        candidate,
        "--glue_paths",
        glue,
        "--format",
        "json",
      ],
      environment,
    });
    expect(invocation.exitCode, invocation.stderr).toBe(1);
    const cliError = analysisErrorProjectionSchema.parse(invocation.json);
    expect(cliError).toMatchObject({
      code: "invalid_request",
      details: {
        partial_observation: {
          normalized_result: expected,
        },
      },
    });

    const { client, call } = await connectLocalToolsMcp(environment);
    const response = await call("inspect_wasm_artifact", {
      path: selected,
      candidate_paths: [candidate],
      glue_paths: [glue],
    });
    const mcpError = parseMcpToolError(response).error;
    expect(mcpError.code).toBe("invalid_request");
    const partialReference = z
      .object({
        kind: z.literal("retained-evidence"),
        evidence_id: z.string(),
      })
      .parse(
        z
          .object({ partial_observation: z.unknown() })
          .passthrough()
          .parse(mcpError.details).partial_observation,
      );
    const retainedReply = await call("get_evidence_bundle", {
      detail: "complete",
    });
    expect(retainedReply.isError).not.toBe(true);
    const retainedBundle = toolContract(
      "get_evidence_bundle",
    ).outputSchema.parse(retainedReply.structuredContent).result;
    if ("kind" in retainedBundle)
      throw new Error("Expected complete retained Evidence");
    const retained = parseEvidence(
      retainedBundle.records.find(
        (record) => record.evidence_id === partialReference.evidence_id,
      ),
    );
    expect(retained.evidence_id).toBe(partialReference.evidence_id);
    expect(retained.normalized_result).toMatchObject(expected);
    await client.ping();
  },
);
