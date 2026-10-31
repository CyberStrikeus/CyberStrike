import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { FINALIZED_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCapture.fixture.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  CAPTURE_SKIP_REASON,
  itWithCaptureCapability,
} from "./processCaptureCapability.js";

const exec = promisify(execFile);

const captureViaCli = async (scenario: Record<string, unknown>) => {
  const scenarioPath = join(
    await createTestTempDirectory("rea-fs-scenario-"),
    "scenario.json",
  );
  await writeFile(scenarioPath, JSON.stringify(scenario));
  const { stdout } = await exec(process.execPath, [
    "scripts/rea.mjs",
    "capture-process",
    scenarioPath,
    "--format",
    "json",
  ]);
  return parseEvidence(JSON.parse(stdout));
};

const callCaptureViaMcp = async (scenario: Record<string, unknown>) => {
  const session = createTestBinarySession(() => {
    throw new Error("Process capture must not launch a binary provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "filesystem-coverage", version: "1" },
  });
  const result = await client.callTool({
    name: "capture_process_scenario",
    arguments: scenario,
  });
  await client.ping();
  return result;
};

const captureViaMcp = async (scenario: Record<string, unknown>) => {
  const result = await callCaptureViaMcp(scenario);
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return parseEvidence(result.structuredContent);
};

it
  .skipIf(
    CAPTURE_SKIP_REASON ||
      process.platform === "win32" ||
      process.getuid?.() === 0,
  )
  .for(["cli", "mcp"] as const)(
  "preserves selected-root permission denial and earlier snapshot facts through %s",
  { timeout: 20_000 },
  async (adapter, context) => {
    const root = await createTestTempDirectory("rea-fs-root-denial-adapter-");
    const denied = join(root, "denied");
    const selected = join(denied, "unobserved");
    const healthy = join(root, "healthy.txt");
    const launched = join(root, "launched.txt");
    const bytes = "retained before denied root";
    await mkdir(denied);
    await writeFile(healthy, bytes);
    await chmod(denied, 0);
    try {
      const lookup = await lstat(selected).catch((cause: unknown) => cause);
      if (
        lookup instanceof Error &&
        "code" in lookup &&
        lookup.code === "ENOENT"
      ) {
        context.skip("The host does not enforce directory search denial.");
        return;
      }
      if (!(lookup instanceof Error) || !("code" in lookup))
        throw new Error("Expected a native selected-root lookup failure");
      expect(["EACCES", "EPERM"]).toContain(lookup.code);
      const scenario = {
        executable: process.execPath,
        arguments: [
          "-e",
          "require('node:fs').writeFileSync('launched.txt','ran')",
        ],
        working_directory: root,
        filesystem_observation_paths: [healthy, selected],
      };
      let output;
      if (adapter === "cli") {
        const failure = await captureViaCli(scenario).catch(
          (cause: unknown) => cause,
        );
        if (
          !(failure instanceof Error) ||
          !("stdout" in failure) ||
          typeof failure.stdout !== "string"
        )
          throw new Error("Expected the CLI to refuse capture before launch");
        output = analysisCliErrorEnvelopeSchema.parse(
          JSON.parse(failure.stdout),
        );
      } else {
        const response = await callCaptureViaMcp(scenario);
        output = parseMcpToolError(response).error;
      }
      expect(output).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        details: {
          operation: "capture_process_scenario",
          path: selected,
          system_code: lookup.code,
          boundary: "filesystem-read",
          partial_observation: {
            observations: {
              target_pid: { state: "unavailable" },
              filesystem_snapshots: {
                before: {
                  state: "available",
                  value: {
                    files: [
                      expect.objectContaining({
                        path: "root_0:.",
                        sha256: createHash("sha256")
                          .update(bytes)
                          .digest("hex"),
                      }),
                    ],
                    completeRoots: ["root_0"],
                    coverage: {
                      enumeration_truncated: true,
                      enumeration_omissions: [
                        {
                          path: "root_1:.",
                          reason: "entry_unavailable",
                          system_code: lookup.code,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(output).toMatchObject({
        remediation: { action: expect.stringContaining("read access") },
      });
      await expect(lstat(launched)).rejects.toMatchObject({ code: "ENOENT" });
      await chmod(denied, 0o700);
      const evidence = await (
        adapter === "cli" ? captureViaCli : captureViaMcp
      )(scenario);
      expect(
        parseProcessCapture(evidence.normalized_result).exit,
      ).toMatchObject({
        code: 0,
        reason: "exited",
      });
      expect(await readFile(launched, "utf8")).toBe("ran");
    } finally {
      await chmod(denied, 0o700);
    }
  },
);

it("documents a finalization scenario and exit record that match the contract", async () => {
  const document = await readFile("docs/process-capture.md", "utf8");
  const blocks = [
    ...(document.split("### Finalization interval")[1] ?? "").matchAll(
      /```json\n([\s\S]*?)\n```/gu,
    ),
  ].map((match) => match[1]);
  const [scenario, exit] = blocks;
  if (scenario === undefined || exit === undefined)
    throw new Error("Missing finalization examples");

  expect(
    processScenarioSchema.parse(JSON.parse(scenario)).finalization_ms,
    "the documented scenario is accepted and carries the interval",
  ).toBe(1_500);
  expect(
    JSON.parse(exit),
    "the documented exit record is the canonical finalized example",
  ).toEqual(FINALIZED_PROCESS_CAPTURE_EXAMPLE.exit);
});

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "hashes the documented complete report despite omitted terminal output through %s",
  async (adapter) => {
    const document = await readFile("docs/process-capture.md", "utf8");
    const example = document
      .split("## Hash a report independently of terminal output")[1]
      ?.match(/```json\n([\s\S]*?)\n```/u)?.[1];
    if (example === undefined)
      throw new Error("Missing report capture example");
    const scenario = processScenarioSchema.parse(JSON.parse(example));
    const root = await createTestTempDirectory("rea-full-report-adapter-");
    const evidence = await (adapter === "cli" ? captureViaCli : captureViaMcp)({
      ...scenario,
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [join(root, "reports")],
    });
    const capture = parseProcessCapture(evidence.normalized_result);
    const bytes = await readFile(join(root, "reports", "final.json"));
    expect(JSON.parse(bytes.toString())).toEqual({
      status: "complete",
      data: "X".repeat(131072),
    });
    expect(bytes.length).toBeGreaterThan(scenario.limits.output_bytes);
    expect(capture.files_after).toContainEqual(
      expect.objectContaining({
        path: "root_0:final.json",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
    expect(capture.truncation_details.filesystem_after).toMatchObject({
      enumeration_truncated: false,
      hash_budget_bytes: scenario.limits.file_bytes,
      hashed_bytes: bytes.length,
      hash_omissions: [],
    });
    expect(capture.truncation_details.raw_terminal.retained_bytes).toBeLessThan(
      capture.truncation_details.raw_terminal.observed_bytes,
    );
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "accounts for exact cumulative hash budgets independently at each %s checkpoint",
  async (adapter) => {
    const runCapture = adapter === "cli" ? captureViaCli : captureViaMcp;
    for (const shortfall of [0, 1]) {
      const root = await createTestTempDirectory("rea-report-cumulative-");
      const periodic = Buffer.from('{"status":"running"}');
      const final = Buffer.from('{"status":"complete"}');
      await writeFile(join(root, "periodic.json"), periodic);
      const budget = periodic.length + final.length - shortfall;
      const evidence = await runCapture({
        executable: process.execPath,
        arguments: [
          "-e",
          "require('node:fs').writeFileSync('final.json','{\"status\":\"complete\"}')",
        ],
        working_directory: root,
        filesystem_observation_paths: [root],
        limits: { output_bytes: 1, file_bytes: budget },
      });
      const capture = parseProcessCapture(evidence.normalized_result);
      expect(capture.truncation_details.filesystem_before).toMatchObject({
        hashed_bytes: periodic.length,
        hash_omissions: [],
      });
      expect(capture.files_after).toContainEqual(
        expect.objectContaining({
          path: "root_0:final.json",
          sha256: createHash("sha256").update(final).digest("hex"),
        }),
      );
      expect(capture.truncation_details.filesystem_after).toMatchObject({
        enumeration_truncated: false,
        hashed_bytes: final.length + (shortfall === 0 ? periodic.length : 0),
        hash_omissions:
          shortfall === 0
            ? []
            : [
                {
                  path: "root_0:periodic.json",
                  reason: "file_bytes_budget",
                  remaining_budget_bytes: periodic.length - 1,
                },
              ],
      });
      expect(
        capture.files_after.find(({ path }) => path === "root_0:periodic.json")
          ?.sha256,
      ).toBe(
        shortfall === 0
          ? createHash("sha256").update(periodic).digest("hex")
          : null,
      );
    }
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "reports unknown absence instead of deletion in truncated %s capture Evidence",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-fs-coverage-adapter-");
    await writeFile(join(root, "z.txt"), "unchanged");
    const scenario = {
      executable: process.execPath,
      // Delete the known file and overflow the remaining directory capacity.
      // Incomplete enumeration still cannot prove its absence, regardless of
      // which new entry the filesystem returns first.
      arguments: [
        "-e",
        "const fs=require('node:fs');fs.unlinkSync('z.txt');fs.writeFileSync('a.txt','added');fs.writeFileSync('b.txt','added');",
      ],
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { files: 2 },
    };
    const evidence = await (adapter === "cli" ? captureViaCli : captureViaMcp)(
      scenario,
    );
    const capture = parseProcessCapture(evidence.normalized_result);
    expect(capture.truncated).toBe(true);
    await expect(readFile(join(root, "z.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      capture.filesystem_effects.find(({ path }) => path === "root_0:z.txt")
        ?.status,
    ).toBe("unknown");
    expect(
      capture.filesystem_checkpoints
        .find(({ name }) => name === "after_settlement")
        ?.effects.find(({ path }) => path === "root_0:z.txt")?.status,
    ).toBe("unknown");
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "reports unknown content after a same-size rewrite without digests through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-fs-content-adapter-");
    const file = join(root, "changed.txt");
    await writeFile(file, "before");
    const scenario = {
      executable: process.execPath,
      arguments: [
        "-e",
        "require('node:fs').writeFileSync('changed.txt','after!')",
      ],
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { file_bytes: 1 },
    };
    const evidence = await (adapter === "cli" ? captureViaCli : captureViaMcp)(
      scenario,
    );
    const capture = parseProcessCapture(evidence.normalized_result);
    expect(await readFile(file, "utf8")).toBe("after!");
    const effect = capture.filesystem_effects.find(
      ({ path }) => path === "root_0:changed.txt",
    );
    expect(effect).toMatchObject({
      status: "unknown",
      reason: expect.any(String),
      before: { size: 6, sha256: null },
      after: { size: 6, sha256: null },
    });
    if (effect?.status !== "unknown")
      throw new Error("Expected unknown file contents");
    expect(
      capture.filesystem_checkpoints.find(
        ({ name }) => name === "after_settlement",
      )?.effects,
    ).toContainEqual(effect);
    expect(capture.residual_unknowns).toContainEqual({
      scope: "filesystem",
      reason: effect.reason,
    });
    expect(capture.limitations).toContain(effect.reason);
    expect(
      capture.truncation_details.filesystem_after.enumeration_truncated,
    ).toBe(false);
    expect(compareProcessCaptures(capture, capture).filesystem).toBe("unknown");
  },
  20_000,
);

it.skipIf(CAPTURE_SKIP_REASON || process.platform === "win32")(
  "keeps unfollowed descendant absence unknown through MCP Evidence and comparison",
  async () => {
    const root = await createTestTempDirectory("rea-fs-symlink-adapter-");
    const target = await createTestTempDirectory(
      "rea-fs-symlink-adapter-target-",
    );
    await mkdir(join(root, "subtree"));
    await writeFile(join(root, "subtree", "z.txt"), "unchanged");
    await writeFile(join(target, "z.txt"), "unchanged");
    await writeFile(join(root, "removed.txt"), "removed");
    const evidence = await captureViaMcp({
      executable: process.execPath,
      arguments: [
        "-e",
        "const fs=require('node:fs');fs.rmSync('subtree',{recursive:true});fs.symlinkSync(process.argv[1],'subtree');fs.unlinkSync('removed.txt');",
        target,
      ],
      working_directory: root,
      filesystem_observation_paths: [root],
    });
    const capture = parseProcessCapture(evidence.normalized_result);
    expect(await readFile(join(root, "subtree", "z.txt"), "utf8")).toBe(
      "unchanged",
    );
    expect(
      capture.filesystem_effects.find(
        ({ path }) => path === "root_0:subtree/z.txt",
      )?.status,
    ).toBe("unknown");
    expect(
      capture.filesystem_effects.find(
        ({ path }) => path === "root_0:removed.txt",
      )?.status,
    ).toBe("deleted");
    expect(capture.residual_unknowns).toContainEqual({
      scope: "filesystem",
      reason: expect.any(String),
    });
    expect(compareProcessCaptures(capture, capture).filesystem).toBe("unknown");
  },
  20_000,
);

it
  .skipIf(CAPTURE_SKIP_REASON || process.platform === "win32")
  .each(["cli", "mcp"] as const)(
  "retains stable root and nested symlink uncertainty with known sibling effects through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-fs-stable-link-adapter-");
    const reports = join(root, "real", "reports");
    await mkdir(reports, { recursive: true });
    await symlink("real/reports", join(root, "link"));
    await writeFile(join(root, "removed.txt"), "known sibling");
    const evidence = await (adapter === "cli" ? captureViaCli : captureViaMcp)({
      executable: process.execPath,
      arguments: [
        "-e",
        "const fs=require('node:fs');fs.writeFileSync('link/final.txt','done');fs.unlinkSync('removed.txt');",
      ],
      working_directory: root,
      filesystem_observation_paths: [join(root, "link"), reports, root],
    });
    const capture = parseProcessCapture(evidence.normalized_result);
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(await readFile(join(reports, "final.txt"), "utf8")).toBe("done");
    for (const path of ["root_0:.", "root_2:link"])
      expect(capture.filesystem_effects).toContainEqual(
        expect.objectContaining({
          path,
          status: "unchanged",
          after: expect.objectContaining({
            type: "symlink",
            symlink_target: "real/reports",
          }),
        }),
      );
    expect(capture.filesystem_effects).toContainEqual(
      expect.objectContaining({
        path: "root_2:removed.txt",
        status: "deleted",
      }),
    );
    expect(capture.filesystem_effects).toContainEqual(
      expect.objectContaining({
        path: "root_1:final.txt",
        status: "created",
        after: expect.objectContaining({
          sha256: createHash("sha256").update("done").digest("hex"),
        }),
      }),
    );
    expect(
      capture.files_after.some(({ path }) => path === "root_0:final.txt"),
    ).toBe(false);
    for (const phase of ["filesystem_before", "filesystem_after"] as const)
      expect(capture.truncation_details[phase]).toMatchObject({
        enumeration_truncated: true,
        enumeration_reasons: ["symlink_not_followed"],
        enumeration_omissions: ["root_0:.", "root_2:link"].map((path) => ({
          path,
          reason: "symlink_not_followed",
          system_code: null,
        })),
      });
    expect(capture.residual_unknowns).toContainEqual({
      scope: "filesystem",
      reason: expect.stringContaining("symlink_not_followed"),
    });
    expect(compareProcessCaptures(capture, capture).filesystem).toBe("unknown");
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "observes absence when selected roots lose their directory ancestor through %s",
  async (adapter) => {
    const runCapture = adapter === "cli" ? captureViaCli : captureViaMcp;
    // A non-directory ancestor proves that no entry exists below it, for an
    // initially absent root and through a symlink to a regular file alike.
    for (const replacement of [
      "fs.writeFileSync('state','regular file');",
      "fs.writeFileSync('target','regular file');fs.symlinkSync('target','state');",
    ]) {
      const root = await createTestTempDirectory("rea-fs-obstructed-root-");
      await mkdir(join(root, "state"));
      const evidence = await runCapture({
        executable: process.execPath,
        arguments: [
          "-e",
          `const fs=require('node:fs');fs.renameSync('state','saved-state');${replacement}`,
        ],
        working_directory: root,
        filesystem_observation_paths: [
          join(root, "state", "reports"),
          join(root, "state"),
        ],
      });
      const capture = parseProcessCapture(evidence.normalized_result);
      expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
      expect(capture.filesystem_effects).toEqual([
        expect.objectContaining({
          path: "root_1:.",
          status: "modified",
          before: expect.objectContaining({ type: "directory" }),
        }),
      ]);
      const symlink = replacement.includes("symlinkSync");
      expect(capture.truncation_details.filesystem_after).toMatchObject({
        enumeration_truncated: symlink,
        enumeration_omissions: symlink
          ? [
              {
                path: "root_1:.",
                reason: "symlink_not_followed",
                system_code: null,
              },
            ]
          : [],
      });
    }
  },
  20_000,
);

it
  .skipIf(
    CAPTURE_SKIP_REASON ||
      process.platform === "win32" ||
      process.getuid?.() === 0,
  )
  .each(["cli", "mcp"] as const)(
  "keeps roots behind a newly unsearchable ancestor unobserved through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-fs-denied-root-");
    await mkdir(join(root, "state"));
    await writeFile(join(root, "state", "present.json"), "payload");
    await symlink("state", join(root, "alias"));
    try {
      const evidence = await (
        adapter === "cli" ? captureViaCli : captureViaMcp
      )({
        executable: process.execPath,
        arguments: ["-e", "require('node:fs').chmodSync('state',0)"],
        working_directory: root,
        filesystem_observation_paths: [
          join(root, "state", "present.json"),
          join(root, "state", "absent.json"),
          join(root, "alias", "present.json"),
        ],
      });
      const capture = parseProcessCapture(evidence.normalized_result);
      expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
      // A denied lookup is not absence: the observed file's fate stays
      // unknown, and each affected root records why it is incomplete.
      expect(capture.filesystem_effects).toEqual(
        ["root_0:.", "root_2:."].map((path) =>
          expect.objectContaining({
            path,
            status: "unknown",
            before: expect.objectContaining({ type: "file" }),
            after: null,
          }),
        ),
      );
      expect(capture.truncation_details.filesystem_after).toMatchObject({
        enumeration_truncated: true,
        enumeration_reasons: ["entry_unavailable"],
        enumeration_omissions: ["root_0:.", "root_1:.", "root_2:."].map(
          (path) => ({
            path,
            reason: "entry_unavailable",
            system_code: "EACCES",
          }),
        ),
      });
    } finally {
      await chmod(join(root, "state"), 0o700);
    }
  },
  20_000,
);

itWithCaptureCapability(
  "retains raw symlink target mutations through the real capture CLI",
  { timeout: 20_000 },
  async () => {
    const root = await createTestTempDirectory("rea-symlink-byte-cli-");
    await symlink(Buffer.from([0x61, 0xff]), join(root, "link"));
    const evidence = await captureViaCli({
      executable: process.execPath,
      arguments: [
        "-e",
        "const fs=require('node:fs');fs.unlinkSync('link');fs.symlinkSync(Buffer.from([0x61,0xfe]),'link')",
      ],
      working_directory: root,
      filesystem_observation_paths: [root],
      timeout_ms: 5000,
    });
    const capture = parseProcessCapture(evidence.normalized_result);
    expect(
      capture.files_before.find(({ path }) => path === "root_0:link"),
    ).toMatchObject({ symlink_target: null, symlink_target_hex: "61ff" });
    expect(
      capture.files_after.find(({ path }) => path === "root_0:link"),
    ).toMatchObject({ symlink_target: null, symlink_target_hex: "61fe" });
    expect(
      capture.filesystem_effects.find(({ path }) => path === "root_0:link")
        ?.status,
    ).toBe("modified");
  },
);
