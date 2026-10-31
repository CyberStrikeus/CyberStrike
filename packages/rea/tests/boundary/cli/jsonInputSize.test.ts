import { constants } from "node:buffer";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "rejects malformed oversized input through CLI and Evidence readers",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-json-string-limit-");
    const input = join(root, "oversized.json");
    const file = await open(input, "wx");
    try {
      // Sparse zero bytes are valid UTF-8. Both streaming readers reject
      // their invalid JSON syntax without assembling a whole-document string.
      await file.truncate(constants.MAX_STRING_LENGTH + 1);
    } finally {
      await file.close();
    }
    // Run readers sequentially in owned child processes, releasing each large
    // read buffer when its process exits instead of retaining it in Vitest.
    const result = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
    });
    expect(result.json).toMatchObject({
      code: "invalid_request",
      input_path: input,
      input_reason: "invalid-json",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");

    const evidence = await processes.run(process.execPath, [
      "--input-type=module",
      "-e",
      `import { readJsonFile } from "./dist/application/JsonFiles.js";
       import { projectAnalysisError } from "./dist/domain/analysisErrorProjection.js";
       const result = await readJsonFile(process.argv[1]);
       console.log(JSON.stringify(result.ok ? result : projectAnalysisError(result.error)));`,
      input,
    ]);
    expect(JSON.parse(evidence.stdout)).toMatchObject({
      code: "evidence_integrity_mismatch",
      details: {
        operation: "read",
        reason: "invalid-json",
        path: input,
      },
    });
    expect(evidence.stderr).toBe("");
    expect(evidence.exitCode).toBe(0);
  },
);

cliTest(
  "traces valid Evidence beyond the whole-document string limit",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-json-streamed-evidence-");
    const source = join(root, "application");
    await mkdir(source);
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        name: "streamed-evidence",
        type: "module",
        main: "entry.mjs",
      }),
    );
    await writeFile(
      join(source, "entry.mjs"),
      'export const observed = "source-owned";',
    );
    const application = await cli.run({
      arguments: [
        "analyze-javascript-application",
        source,
        "--artifact-format",
        "directory",
        "--json",
      ],
    });
    expect(application.exitCode).toBe(0);
    const request = JSON.stringify({
      application: application.json,
      seed: { kind: "module", value: "entry.mjs", match: "contains" },
      direction: "incoming",
    });
    const input = join(root, "trace.json");
    await writeFile(input, request);
    const ordinary = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
    });
    expect(ordinary.exitCode).toBe(0);
    const file = await open(input, "a");
    try {
      const whitespace = Buffer.alloc(1024 * 1024, 0x20);
      let remaining =
        constants.MAX_STRING_LENGTH + 1 - Buffer.byteLength(request);
      while (remaining > 0) {
        const length = Math.min(remaining, whitespace.length);
        await file.writeFile(whitespace.subarray(0, length));
        remaining -= length;
      }
    } finally {
      await file.close();
    }
    const streamed = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
    });
    expect(streamed.exitCode).toBe(0);
    expect(streamed.json).toEqual(ordinary.json);
    expect(streamed.stderr).toBe("");
  },
);

cliTest(
  "returns a typed container assembly constraint and allows a following read",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-json-container-headroom-");
    const input = join(root, "containers.json");
    const following = join(root, "following.json");
    const file = await open(input, "wx");
    try {
      await file.writeFile("[");
      const chunk = Buffer.from("[],".repeat(65_536));
      for (let index = 0; index < 128; index++) await file.writeFile(chunk);
      await file.writeFile("null]");
    } finally {
      await file.close();
    }
    await writeFile(following, '{"after":true}');
    const result = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
      environment: { NODE_OPTIONS: "--max-old-space-size=768" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: {
          input_path: input,
          projected_value_bytes: expect.any(Number),
          assembly_headroom_bytes: expect.any(Number),
        },
      },
    });
    const evidence = await processes.run(process.execPath, [
      "--max-old-space-size=768",
      "--input-type=module",
      "-e",
      `import { readJsonFile } from "./dist/application/JsonFiles.js";
       import { projectAnalysisError } from "./dist/domain/analysisErrorProjection.js";
       const large = await readJsonFile(process.argv[1]);
       const following = await readJsonFile(process.argv[2]);
       console.log(JSON.stringify({large: large.ok ? large : projectAnalysisError(large.error), following}));`,
      input,
      following,
    ]);
    expect(evidence.exitCode).toBe(0);
    expect(evidence.stderr).toBe("");
    expect(JSON.parse(evidence.stdout)).toMatchObject({
      large: {
        code: "resource_constraint",
        details: { reported_limits: { input_path: input } },
      },
      following: { ok: true, value: { after: true } },
    });
  },
);

cliTest(
  "returns a typed string assembly constraint under a bounded heap",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-json-string-headroom-");
    const input = join(root, "long-string.json");
    const file = await open(input, "wx");
    try {
      await file.writeFile('"');
      const chunk = Buffer.alloc(1024 * 1024, 0x78);
      let remaining = constants.MAX_STRING_LENGTH + 1;
      while (remaining > 0) {
        const length = Math.min(remaining, chunk.length);
        await file.writeFile(chunk.subarray(0, length));
        remaining -= length;
      }
      await file.writeFile('"');
    } finally {
      await file.close();
    }
    const result = await cli.run({
      arguments: ["trace-application-feature", input, "--json"],
      environment: { NODE_OPTIONS: "--max-old-space-size=768" },
    });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      code: "resource_constraint",
      input_path: input,
      input_reason: "too-large",
      details: { resource: "memory" },
      remediation: {
        action: expect.stringContaining("re-analyze a smaller selection"),
      },
    });
    const evidence = await processes.run(process.execPath, [
      "--max-old-space-size=768",
      "--input-type=module",
      "-e",
      `import { readJsonFile } from "./dist/application/JsonFiles.js";
       import { projectAnalysisError } from "./dist/domain/analysisErrorProjection.js";
       const result = await readJsonFile(process.argv[1]);
       console.log(JSON.stringify(result.ok ? result : projectAnalysisError(result.error)));`,
      input,
    ]);
    expect(JSON.parse(evidence.stdout)).toMatchObject({
      code: "resource_constraint",
      details: { operation: "read_evidence_file", resource: "memory" },
    });
    expect(evidence.stderr).toBe("");
    expect(evidence.exitCode).toBe(0);
  },
);
