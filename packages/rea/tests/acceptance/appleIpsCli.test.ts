import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  appleIpsBytes,
  appleIpsRosettaBytes,
} from "../fixtures/binaryDiagnostics/appleIps.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "decodes escape-dense IPS text within the selected Node heap",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-ips-escaped-");
    const path = join(root, "escaped.ips");
    const name = "\n".repeat(7_500_000);
    await writeFile(
      path,
      `{"bug_type":"309"}\n${JSON.stringify({ procName: name, threads: [], usedImages: [] })}`,
    );
    const result = await cli.run({
      arguments: [
        "inspect-apple-ips",
        path,
        "--max-file-bytes",
        "16777216",
        "--json",
      ],
      environment: { NODE_OPTIONS: "--max-old-space-size=256" },
      timeoutMs: 30000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_apple_ips").outputSchema.parse(
      result.json,
    );
    const actual = evidence.normalized_result.process.name;
    expect(actual?.length).toBe(name.length);
    expect(
      createHash("sha256")
        .update(actual ?? "")
        .digest("hex"),
    ).toBe(createHash("sha256").update(name).digest("hex"));
    expect(evidence.normalized_result.coverage.status).toBe("complete");
  },
  45000,
);

cliTest(
  "reports Apple IPS crash facts through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-ips-cli-");
    const path = join(root, "report.ips");
    await writeFile(path, appleIpsBytes());
    const constrained = await cli.run({
      arguments: [
        "inspect-apple-ips",
        path,
        "--max-integer-text-bytes",
        "1",
        "--json",
      ],
    });
    expect(constrained.exitCode, constrained.stderr).toBe(1);
    expect(constrained.json).toMatchObject({
      code: "resource_constraint",
      remediation: {
        action: expect.stringContaining("max_integer_text_bytes"),
      },
      details: {
        reported_limits: { boundary: "integer_text", maximum: 1 },
      },
    });
    const result = await cli.run({
      arguments: ["inspect-apple-ips", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_apple_ips").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.metadata.bug_type).toBe("309");
    expect(evidence.normalized_result.exception?.type).toBe("EXC_BAD_ACCESS");
    expect(evidence.normalized_result.images[0]?.uuid).toBe(
      "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    );
  },
);

cliTest(
  "preserves empty IPS source text through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-ips-empty-");
    const path = join(root, "empty.ips");
    await writeFile(
      path,
      '{"bug_type":"309","":0}\n{"procName":"","osVersion":"","threads":[{"threadState":{"":0},"frames":[{"symbol":""}]}],"usedImages":[{"arch":"","uuid":"","path":""}],"":0}',
    );
    const cliReply = await cli.run({
      arguments: ["inspect-apple-ips", path, "--json"],
    });
    expect(cliReply.exitCode, cliReply.stderr).toBe(0);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const mcpReply = await call("inspect_apple_ips", { path });
    expect(mcpReply.isError, JSON.stringify(mcpReply.content)).not.toBe(true);
    for (const reply of [cliReply.json, mcpReply.structuredContent]) {
      const report =
        toolContract("inspect_apple_ips").outputSchema.parse(
          reply,
        ).normalized_result;
      expect(report.metadata.unlisted_keys).toEqual([""]);
      expect(report.unlisted_body_keys).toEqual([""]);
      expect(report.process.name).toBe("");
      expect(report.process.os_version).toEqual({ form: "text", text: "" });
      expect(report.threads[0]?.registers[0]?.name).toBe("");
      expect(report.threads[0]?.frames[0]?.recorded_symbol).toBe("");
      expect(report.images[0]).toMatchObject({
        arch: "",
        uuid: null,
        uuid_unknown: true,
        path: "",
      });
      expect(report.coverage.type_mismatches).toContainEqual(
        expect.objectContaining({
          path: "body.usedImages[0].uuid",
          recorded_value: "",
        }),
      );
      expect(report.classification.status).toBe("unclassified");
    }
  },
);

cliTest(
  "keeps producer-shaped Rosetta registers through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-ips-rosetta-");
    const path = join(root, "translated.ips");
    await writeFile(path, appleIpsRosettaBytes());
    const cliReply = await cli.run({
      arguments: ["inspect-apple-ips", path, "--json"],
    });
    expect(cliReply.exitCode, cliReply.stderr).toBe(0);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const mcpReply = await call("inspect_apple_ips", { path });
    expect(mcpReply.isError, JSON.stringify(mcpReply.content)).not.toBe(true);
    for (const reply of [cliReply.json, mcpReply.structuredContent]) {
      const report =
        toolContract("inspect_apple_ips").outputSchema.parse(
          reply,
        ).normalized_result;
      expect(report.threads[0]?.state_flavor).toBe("x86_THREAD_STATE");
      expect(report.threads[0]?.registers.map(({ name }) => name)).toEqual([
        "rbp",
        "r12",
        "rosetta.tmp2",
        "rosetta.tmp1",
        "rosetta.tmp0",
        "rbx",
      ]);
      expect(report.threads[0]?.registers[2]?.value.decimal).toBe(
        "140706223703876",
      );
      expect(report.coverage).toMatchObject({
        status: "complete",
        registers: 6,
        type_mismatches: [],
      });
    }

    const malformedPath = join(root, "translated-malformed.ips");
    await writeFile(malformedPath, appleIpsRosettaBytes("invalid"));
    const malformedReply = await cli.run({
      arguments: ["inspect-apple-ips", malformedPath, "--json"],
    });
    expect(malformedReply.exitCode, malformedReply.stderr).toBe(0);
    const malformed = toolContract("inspect_apple_ips").outputSchema.parse(
      malformedReply.json,
    ).normalized_result;
    expect(malformed.coverage).toMatchObject({
      status: "partial",
      registers: 5,
      type_mismatches: [
        {
          path: "body.threads[0].threadState.rosetta.tmp1.value",
          expected: "integer",
          observed: "string",
        },
      ],
    });
    expect(malformed.threads[0]?.registers.at(-1)?.name).toBe("rbx");
  },
);

cliTest(
  "resolves a relative IPS path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-ips-cli-rel-");
    await writeFile(join(root, "report.ips"), appleIpsBytes());
    const result = await cli.run({
      arguments: ["inspect-apple-ips", "report.ips", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_apple_ips").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.process.name).toBe("rea-crash-fixture");
    expect(evidence.subject?.local_path).toBe(join(root, "report.ips"));
  },
);

cliTest("reports a truncated IPS as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-apple-ips-cli-bad-");
  const path = join(root, "broken.ips");
  await writeFile(path, appleIpsBytes({ truncateBody: true }));
  const result = await cli.run({
    arguments: ["inspect-apple-ips", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_apple_ips" },
  });
});
