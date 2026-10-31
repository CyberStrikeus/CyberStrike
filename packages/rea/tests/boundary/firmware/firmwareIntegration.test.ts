import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, it as test, vi } from "vitest";
import {
  firmwareFixture,
  assertFirmwareCleanup,
} from "../../fixtures/firmware/provider.js";
import { firmwareResultSchemas } from "../../../src/domain/firmware/firmwareAnalysis.js";
import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import { FIRMWARE_LIMITS } from "../../../src/firmware/FirmwareRelease.js";
import { FirmwareProvider } from "../../../src/firmware/FirmwareProvider.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { SafeOutputTreeCreationFailure } from "../../../src/artifacts/SafeOutputTreeCreationFailure.js";

// Assert recovery behavior through the public reference table, while keeping
// row identity expectations independent of the instruction's digest.
const gapsWithContinuations = (
  result: ReturnType<typeof firmwareResultSchemas.extract_firmware.parse>,
) => {
  const instructions = new Map(
    result.extraction_continuations.map(({ id, instruction }) => [
      id,
      instruction,
    ]),
  );
  return result.extraction_gaps.map(({ continuation_id, ...gap }) => {
    const instruction = instructions.get(continuation_id);
    if (instruction === undefined)
      throw new Error("Missing recovery instruction");
    return { ...gap, continuation: instruction };
  });
};

const directoryCloseFailure = vi.hoisted(() => ({
  mode: "off" as "off" | "transient" | "persistent",
  attempts: 0,
  parent: "",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (
        directoryCloseFailure.mode !== "off" &&
        String(args[0]) === directoryCloseFailure.parent &&
        (await handle.stat()).isDirectory()
      ) {
        const close = handle.close.bind(handle);
        let attempted = false;
        handle.close = async () => {
          directoryCloseFailure.attempts += 1;
          if (
            directoryCloseFailure.mode === "persistent" ||
            (directoryCloseFailure.mode === "transient" && !attempted)
          ) {
            attempted = true;
            throw new Error("injected published directory close failure");
          }
          await close();
        };
      }
      return handle;
    },
  };
});

const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);

const it = test.skipIf(process.platform !== "linux");

it("keeps cleanup-failure state local to the selected factory instance", async () => {
  const failed = await firmwareFixture("cleanup-failure");
  const healthy = await firmwareFixture();
  const failure = await failed.service.execute("inspect_firmware_regions", {
    path: failed.path,
  });
  expect(failure).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const result = await healthy.service.execute("inspect_firmware_regions", {
    path: healthy.path,
  });
  expect(result.ok).toBe(true);
  await assertFirmwareCleanup(healthy.launches);
});

it("binds region observations to exact bytes and preserves provider-reported uncertainty", async () => {
  const fixture = await firmwareFixture();
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.inspect_firmware_regions.parse(
    result.value.normalized_result,
  );
  expect(normalized.engine).toMatchObject({
    name: "binwalk",
    version: "3.1.0",
    executable_path: fixture.commands.binwalk,
  });
  expect(normalized.regions[0]).toMatchObject({
    offset: 2,
    reported_size: 4,
    size_basis: "provider_reported_validation_unknown",
  });
  expect(result.value.subject?.local_path).toBe(fixture.path);
  expect(result.value.subject?.format).toBe("file");
  expect(result.value.raw_result).toMatchObject({
    report: [{ Analysis: { file_map: [{ id: "hit" }] } }],
  });
  expect(fixture.launches[1]?.args).toEqual(
    expect.arrayContaining([
      `--as=${String(FIRMWARE_LIMITS.addressSpaceBytes)}:${String(FIRMWARE_LIMITS.addressSpaceBytes)}`,
      "--threads",
      "1",
    ]),
  );
  await assertFirmwareCleanup(fixture.launches);
});

it.each(["wrong-input", "bounds"])(
  "rejects a mismatched or out-of-bounds inspection: %s",
  async (mode) => {
    const fixture = await firmwareFixture(mode);
    const result = await fixture.service.execute("inspect_firmware_regions", {
      path: fixture.path,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
    await assertFirmwareCleanup(fixture.launches);
  },
);

it("extracts a selected interval with verified file identity and parent-byte lineage", async () => {
  const fixture = await firmwareFixture();
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
    range: { offset: 2, length: 4 },
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(normalized.engine).toMatchObject({
    name: "unblob",
    version: "26.6.4",
    executable_path: fixture.commands.unblob,
  });
  expect(normalized.selection).toMatchObject({ offset: 2, length: 4 });
  expect(normalized.files[0]).toMatchObject({
    relative_path: "rootfs/config",
    size: 14,
    original_file_range: null,
    runtime_address: null,
  });
  expect(normalized.chunks[0]?.root_file_range).toEqual({
    offset: 2,
    length: 4,
  });
  expect(normalized.derivations[0]).toMatchObject({
    parent_path: "$input",
    child_path: "$output/rootfs/config",
    handler: "gzip",
    parent_file_range: { offset: 0, length: 4 },
  });
  expect(await readFile(normalized.files[0]?.path ?? "", "utf8")).toBe(
    "firmware=true\n",
  );
  expect(fixture.launches[1]?.args).toEqual(
    expect.arrayContaining(["--process-num", "1", "--randomness-depth", "0"]),
  );
  expect(fixture.launches[1]?.args).not.toContain("--no-sandbox");
  await assertFirmwareCleanup(fixture.launches);
});

it("retains a setup-failed publication tree for provider cleanup retry", async () => {
  const fixture = await firmwareFixture();
  const createTree = SafeOutputTree.create.bind(SafeOutputTree);
  let cleanupAttempts = 0;
  let retained: AnalysisError | undefined;
  const create = vi
    .spyOn(SafeOutputTree, "create")
    .mockImplementationOnce(async (outputRoot, platform) => {
      const tree = await createTree(outputRoot, platform);
      const rollbackTree = tree.rollback.bind(tree);
      vi.spyOn(tree, "rollback").mockImplementation(async () => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1)
          throw new Error("injected first cleanup failure");
        return rollbackTree();
      });
      throw new SafeOutputTreeCreationFailure(
        new Error("injected post-acquisition setup failure"),
        tree,
      );
    });
  try {
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      range: { offset: 2, length: 4 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: expect.arrayContaining([fixture.output]),
      },
    });
    if (result.ok) throw new Error("Expected retained publication cleanup");
    retained = result.error;
    expect(projectAnalysisError(retained).code).toBe("cleanup_incomplete");
    expect(JSON.stringify(projectAnalysisError(retained))).toContain(
      "injected post-acquisition setup failure",
    );
    await expect(access(fixture.output)).resolves.toBeUndefined();
  } finally {
    create.mockRestore();
  }
  await fixture.close();
  expect(cleanupAttempts).toBe(2);
  expect(retained?.cleanupIncomplete).toBe(false);
  await expect(access(fixture.output)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("returns firmware output after a transient published-directory close failure", async () => {
  const fixture = await firmwareFixture();
  const closeFailure = injectPublishedDirectoryCloseFailure(false);
  try {
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      range: { offset: 2, length: 4 },
    });
    if (!result.ok) throw result.error;
    const normalized = firmwareResultSchemas.extract_firmware.parse(
      result.value.normalized_result,
    );
    expect(normalized.output_directory).toBe(fixture.output);
    expect(await readFile(normalized.files[0]?.path ?? "", "utf8")).toBe(
      "firmware=true\n",
    );
    expect(closeFailure.attempts()).toBeGreaterThanOrEqual(2);
  } finally {
    closeFailure.restore();
  }
});

it("retains the complete firmware result when published output cleanup stays uncertain", async () => {
  const fixture = await firmwareFixture();
  let retained: AnalysisError | undefined;
  const closeFailure = injectPublishedDirectoryCloseFailure(true);
  try {
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      range: { offset: 2, length: 4 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        partialObservation: {
          kind: "firmware",
          result: {
            output_directory: fixture.output,
            files: [
              expect.objectContaining({
                relative_path: "rootfs/config",
                size: 14,
              }),
            ],
          },
        },
      },
    });
    if (result.ok) throw new Error("Expected unresolved descriptor cleanup");
    expect(result.error).toBeInstanceOf(AnalysisError);
    retained = result.error;
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        partial_observation: {
          kind: "firmware",
          result: { output_directory: fixture.output },
        },
      },
    });
    expect(await readFile(`${fixture.output}/rootfs/config`, "utf8")).toBe(
      "firmware=true\n",
    );
    expect(closeFailure.attempts()).toBeGreaterThanOrEqual(2);
  } finally {
    closeFailure.restore();
  }
  await fixture.close();
  expect(retained?.cleanupIncomplete).toBe(false);
  expect(await readFile(`${fixture.output}/rootfs/config`, "utf8")).toBe(
    "firmware=true\n",
  );
});

it("shares recovery prose across distinct unknown chunk identities", async () => {
  const fixture = await firmwareFixture("many-unknown");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(normalized.extraction_gaps).toHaveLength(1000);
  expect(
    new Set(normalized.extraction_gaps.map(({ provider_id }) => provider_id))
      .size,
  ).toBe(1000);
  expect(normalized.extraction_continuations).toHaveLength(1);
  const [instruction] = normalized.extraction_continuations;
  expect(instruction?.instruction).toContain("inspect_firmware_regions");
  expect(
    normalized.extraction_gaps.every(
      (gap) => gap.continuation_id === instruction?.id,
    ),
  ).toBe(true);
});

it("retains a task dependency failure when the producer names no executable", async () => {
  const fixture = await firmwareFixture("unnamed-dependency");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual([
    {
      kind: "missing-extractor-dependency",
      input_path: "$input",
      relative_path: null,
      handler: null,
      provider_id: null,
      range: null,
      root_file_range: null,
      dependencies: [],
      continuation: expect.stringContaining("identity is unavailable"),
    },
  ]);
});

it("preserves an unnamed dependency failure on its owning chunk", async () => {
  const fixture = await firmwareFixture("unnamed-chunk-dependency");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual([
    {
      kind: "missing-extractor-dependency",
      input_path: "$input",
      relative_path: null,
      handler: "gzip",
      provider_id: "gzip-id",
      range: { offset: 0, length: 18 },
      root_file_range: { offset: 0, length: 18 },
      dependencies: [],
      continuation: expect.stringContaining("identity is unavailable"),
    },
  ]);
});

it("routes a nested unknown chunk through its published child", async () => {
  const fixture = await firmwareFixture("nested-unknown");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "unknown-chunk-handler",
        input_path: "$output/rootfs/config",
        provider_id: "unknown-id",
        range: { offset: 0, length: 14 },
        root_file_range: null,
        continuation: expect.stringContaining(
          "published child named by this gap's input_path",
        ),
      }),
    ]),
  );
  expect(gapsWithContinuations(normalized)[0]?.continuation).toContain(
    "only if Binwalk is configured with REA_BINWALK_COMMAND",
  );
  expect(gapsWithContinuations(normalized)[0]?.continuation).toContain(
    "unavailable without configured Binwalk",
  );
});

it("retains every eligible child in a maximum-depth continuation", async () => {
  const fixture = await firmwareFixture("depth-reentry");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
    max_depth: 10,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  const gap = gapsWithContinuations(normalized).find(
    ({ kind, input_path }) =>
      kind === "depth-limited" && input_path === "$output/rootfs/config",
  );
  expect(gap?.continuation).toContain(
    JSON.stringify(`${fixture.output}/rootfs/config/inner.gz`),
  );
  expect(gap?.continuation).toContain(
    JSON.stringify(`${fixture.output}/rootfs/config/second.gz`),
  );
});

it("withholds the nested rerun advice when the published child exceeds the input limit", async () => {
  const fixture = await firmwareFixture("nested-unknown-oversized");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual([
    {
      kind: "unknown-chunk-handler",
      input_path: "$output/rootfs/config",
      relative_path: null,
      handler: null,
      provider_id: "unknown-id",
      range: { offset: 0, length: 14 },
      root_file_range: null,
      dependencies: [],
      continuation: expect.stringContaining(
        "cannot accept it as a fresh input",
      ),
    },
  ]);
});

it.each([
  ["depth", 10, "rerun extract_firmware"],
  ["depth-orphan", 10, "cannot be restarted"],
] as const)(
  "bounds the maximum-depth continuation by a usable published child (%s)",
  async (mode, maxDepth, expected) => {
    const fixture = await firmwareFixture(mode);
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      max_depth: maxDepth,
    });
    if (!result.ok) throw result.error;
    const normalized = firmwareResultSchemas.extract_firmware.parse(
      result.value.normalized_result,
    );
    expect(normalized.depth_limited_paths.length).toBeGreaterThan(0);
    expect(
      gapsWithContinuations(normalized).filter(
        (gap) => gap.kind === "depth-limited",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "depth-limited",
          continuation: expect.stringContaining(expected),
        }),
      ]),
    );
  },
);

it("reports a failed multi-file stage as an extractor-failure gap", async () => {
  const fixture = await firmwareFixture("multi-file-failure");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "extractor-failure",
        input_path: "$input",
        handler: "tar",
        provider_id: "mf-id",
        range: null,
        root_file_range: null,
      }),
    ]),
  );
});

it.each(["task-error", "task-warning"])(
  "preserves standalone diagnostic recovery without inventing stage ownership: %s",
  async (mode) => {
    const fixture = await firmwareFixture(mode);
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (!result.ok) throw result.error;
    const normalized = firmwareResultSchemas.extract_firmware.parse(
      result.value.normalized_result,
    );
    const failures = gapsWithContinuations(normalized).filter(
      (gap) => gap.kind === "extractor-failure",
    );
    expect(normalized.diagnostics).toContainEqual(
      expect.objectContaining({
        input_path: "$input",
        report: expect.objectContaining({
          __typename__:
            mode === "task-error"
              ? "UnknownError"
              : "ExtractCommandFailedReport",
        }),
      }),
    );
    if (mode === "task-error") {
      expect(failures).toEqual([
        expect.objectContaining({
          input_path: "$input",
          handler: null,
          provider_id: null,
          range: null,
          root_file_range: null,
          dependencies: [],
          continuation: expect.stringContaining("diagnostics"),
        }),
      ]);
    } else expect(failures).toEqual([]);
    await assertFirmwareCleanup(fixture.launches);
  },
);

it("retains independent failures beside dependencies at each extraction owner", async () => {
  const fixture = await firmwareFixture("mixed-failures");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  const gaps = gapsWithContinuations(normalized);
  expect(gaps).toHaveLength(4);
  for (const provider_id of ["gzip-id", "mixed-id"]) {
    const owned = gaps.filter((gap) => gap.provider_id === provider_id);
    expect(owned.map((gap) => gap.kind).sort()).toEqual([
      "extractor-failure",
      "missing-extractor-dependency",
    ]);
    for (const gap of owned) {
      expect(gap.input_path).toBe("$input");
      expect(gap.range).toEqual(
        provider_id === "mixed-id" ? null : normalized.chunks[0]?.range,
      );
    }
  }
  expect(normalized.chunks[0]?.extraction_failed).toBe(true);
  await assertFirmwareCleanup(fixture.launches);
});

it("carries the owning multi-file stage on a task-level dependency gap", async () => {
  const fixture = await firmwareFixture("multi-file-dependency");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!result.ok) throw result.error;
  const normalized = firmwareResultSchemas.extract_firmware.parse(
    result.value.normalized_result,
  );
  expect(gapsWithContinuations(normalized)).toEqual([
    {
      kind: "missing-extractor-dependency",
      input_path: "$input",
      relative_path: null,
      handler: "squashfs",
      provider_id: "sq-id",
      range: null,
      root_file_range: null,
      dependencies: ["sasquatch"],
      continuation: expect.stringContaining("installs nothing"),
    },
  ]);
  expect(normalized.diagnostics).toEqual([
    expect.objectContaining({ stage: "squashfs" }),
  ]);
});

const injectPublishedDirectoryCloseFailure = (persistent: boolean) => {
  directoryCloseFailure.attempts = 0;
  const commit = SafeOutputTree.prototype.commit;
  const spy = vi
    .spyOn(SafeOutputTree.prototype, "commit")
    .mockImplementation(async function (this: SafeOutputTree) {
      directoryCloseFailure.mode = persistent ? "persistent" : "transient";
      // Only the parent descriptor closes after the publication cutoff. A
      // child/root close failure aborts sync before output becomes published.
      directoryCloseFailure.parent = dirname(this.outputRoot);
      await commit.call(this);
    });
  return {
    attempts: () => directoryCloseFailure.attempts,
    restore: () => {
      directoryCloseFailure.mode = "off";
      directoryCloseFailure.parent = "";
      spy.mockRestore();
    },
  };
};

it.each(["depth", "dependency", "link"])(
  "reports partial extraction for %s without losing inline results",
  async (mode) => {
    const fixture = await firmwareFixture(mode);
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (!result.ok) throw result.error;
    const normalized = firmwareResultSchemas.extract_firmware.parse(
      result.value.normalized_result,
    );
    expect(normalized.coverage).toBe("partial");
    expect(normalized.files).toHaveLength(1);
    if (mode === "depth")
      expect(normalized.depth_limited_paths).toEqual(["$output/rootfs/config"]);
    if (mode === "depth")
      expect(gapsWithContinuations(normalized)).toEqual([
        {
          kind: "depth-limited",
          input_path: "$output/rootfs/config",
          relative_path: null,
          handler: null,
          provider_id: null,
          range: null,
          root_file_range: null,
          dependencies: [],
          continuation: expect.stringMatching(
            /max_depth.*fresh output_directory/u,
          ),
        },
      ]);
    if (mode === "dependency")
      expect(normalized.diagnostics).toEqual([
        {
          input_path: "$input",
          stage: "gzip",
          missing_dependencies: ["sasquatch"],
          report: {
            __typename__: "ExtractorDependencyNotFoundReport",
            severity: "ERROR",
            dependencies: ["sasquatch"],
          },
        },
      ]);
    if (mode === "dependency")
      expect(gapsWithContinuations(normalized)).toEqual([
        {
          kind: "missing-extractor-dependency",
          input_path: "$input",
          relative_path: null,
          handler: "gzip",
          provider_id: "gzip-id",
          range: { offset: 0, length: 18 },
          root_file_range: { offset: 0, length: 18 },
          dependencies: ["sasquatch"],
          continuation: expect.stringContaining("installs nothing"),
        },
      ]);
    const linkLimitation = expect.stringContaining(
      "Unblob rewrites absolute targets relative to the extraction root",
    );
    if (mode === "link")
      expect(result.value.limitations).toContainEqual(linkLimitation);
    else expect(result.value.limitations).not.toContainEqual(linkLimitation);
    if (mode === "link") {
      expect(normalized.unpublished_entries).toEqual([
        {
          relative_path: "escape",
          kind: "symlink",
          link_target: "/etc/passwd",
          link_target_hex: Buffer.from("/etc/passwd", "utf8").toString("hex"),
        },
      ]);
      expect(gapsWithContinuations(normalized)).toEqual([
        {
          kind: "unpublished-entry",
          input_path: "$output/escape",
          relative_path: "escape",
          handler: null,
          provider_id: null,
          range: null,
          root_file_range: null,
          dependencies: [],
          continuation: expect.stringContaining("metadata"),
        },
      ]);
      await expect(access(`${fixture.output}/escape`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await assertFirmwareCleanup(fixture.launches);
  },
);

it("distinguishes a real output file named $input from the selected original", async () => {
  const fixture = await firmwareFixture("reserved-name");
  const outcome = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (!outcome.ok) throw outcome.error;
  const result = firmwareResultSchemas.extract_firmware.parse(
    outcome.value.normalized_result,
  );
  expect(result.files[0]?.relative_path).toBe("$input");
  expect(result.derivations[0]).toMatchObject({
    parent_path: "$input",
    child_path: "$output/$input",
  });
  expect(await readFile(`${fixture.output}/$input`, "utf8")).toBe(
    "firmware=true\n",
  );
  await assertFirmwareCleanup(fixture.launches);
});

it.each(["hash", "malformed", "budget", "missing-file"])(
  "rejects invalid or over-budget extraction and rolls back output: %s",
  async (mode) => {
    const fixture = await firmwareFixture(mode);
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      ...(mode === "budget" ? { max_output_bytes: 1000 } : {}),
    });
    expect(result.ok).toBe(false);
    await expect(access(fixture.output)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await assertFirmwareCleanup(fixture.launches);
  },
);

it("preserves existing output and rejects invalid intervals before invoking extraction", async () => {
  const fixture = await firmwareFixture();
  await mkdir(fixture.output);
  await writeFile(`${fixture.output}/existing`, "keep");
  const existing = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  expect(existing.ok).toBe(false);
  expect(await readFile(`${fixture.output}/existing`, "utf8")).toBe("keep");
  const previous = fixture.launches.length;
  const invalid = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: `${fixture.output}-invalid-range`,
    range: { offset: 100, length: 1 },
  });
  expect(invalid).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  if (invalid.ok) throw new Error("Expected out-of-file-range rejection");
  expect(projectAnalysisError(invalid.error)).toMatchObject({
    details: { issues: [{ path: ["range"], reason: "out_of_range" }] },
  });
  expect(fixture.launches).toHaveLength(previous);
  await assertFirmwareCleanup(fixture.launches);
});

it("retains startup stderr when Unblob exits 1 without a report", async () => {
  const fixture = await firmwareFixture("startup");
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  if (result.ok) throw new Error("Expected startup failure");
  const details = {
    diagnostics: {
      stderr: expect.stringContaining("Landlock sandbox is not available"),
      exit_code: 1,
    },
  };
  expect(projectAnalysisError(result.error)).toMatchObject({ details });
  expect(
    delivery.toCallToolResult(result, toolContract("extract_firmware"))
      .structuredContent,
  ).toMatchObject({ error: { details } });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      diagnostics: {
        exit_code: 1,
        stderr: expect.stringContaining("Landlock sandbox is not available"),
        report_state: "missing",
      },
    },
  });
  await expect(access(fixture.output)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await assertFirmwareCleanup(fixture.launches);
});

it.each([
  { operation: "inspect_firmware_regions", engine: "binwalk" },
  { operation: "extract_firmware", engine: "unblob" },
] as const)(
  "keeps $engine's missing report after exit 0 distinct from an empty result",
  async ({ operation, engine }) => {
    const fixture = await firmwareFixture("missing-report");
    const result = await fixture.service.execute(operation, {
      path: fixture.path,
      ...(operation === "extract_firmware"
        ? { output_directory: fixture.output }
        : {}),
    });
    if (result.ok) throw new Error("Expected missing-report failure");
    const error = {
      code: "unreadable_output",
      retryable: false,
      message: expect.stringContaining("not an empty or complete result"),
      details: {
        reason: `${engine} exited 0 without a usable report: Report was not created`,
        diagnostics: {
          report_state: "missing",
          report_path: expect.stringMatching(/report\.json$/),
          command: expect.any(String),
          args: expect.any(Array),
          exit_code: 0,
          signal: null,
          stderr: "Producer forgot its report\n",
        },
      },
      remediation: {
        action: expect.stringContaining("did not retry or substitute"),
      },
    };
    expect(projectAnalysisError(result.error)).toMatchObject(error);
    expect(projectAnalysisError(result.error).message).not.toContain(
      "rea doctor",
    );
    expect(
      delivery.toCallToolResult(result, toolContract(operation))
        .structuredContent,
    ).toMatchObject({ error });
    await assertFirmwareCleanup(fixture.launches);
  },
);

it("cancels an owned active process and permits the next queued operation", async () => {
  const fixture = await firmwareFixture("stall");
  const controller = new AbortController();
  const pending = fixture.service.execute(
    "inspect_firmware_regions",
    { path: fixture.path },
    { signal: controller.signal },
  );
  await expect.poll(() => fixture.launches.length).toBe(2);
  controller.abort();
  expect(await pending).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  const cancelled = await fixture.service.execute(
    "inspect_firmware_regions",
    { path: fixture.path },
    { signal: AbortSignal.abort() },
  );
  expect(cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(fixture.launches).toHaveLength(2);
  await assertFirmwareCleanup(fixture.launches);
});

it("cancels a waiting request promptly while keeping later launches behind the active operation", async () => {
  const fixture = await firmwareFixture("stall");
  const activeController = new AbortController();
  const active = fixture.service.execute(
    "inspect_firmware_regions",
    { path: fixture.path },
    { signal: activeController.signal },
  );
  await expect.poll(() => fixture.launches.length).toBe(2);
  const queuedController = new AbortController();
  const queued = fixture.service.execute(
    "inspect_firmware_regions",
    { path: fixture.path },
    { signal: queuedController.signal },
  );
  queuedController.abort();
  expect(await queued).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(fixture.launches).toHaveLength(2);
  activeController.abort();
  expect((await active).ok).toBe(false);
  await assertFirmwareCleanup(fixture.launches);
});

it("retains an uncertain worker's workspace and blocks later launches", async () => {
  const fixture = await firmwareFixture("cleanup-failure");
  const first = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const workspace = fixture.launches[0]?.cwd;
  expect(workspace).toBeDefined();
  if (workspace === undefined) throw new Error("Expected retained workspace");
  await access(workspace);
  const originalLaunches = [...fixture.launches];
  const next = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  expect(next).toMatchObject({ ok: false, error: { cleanupIncomplete: true } });
  expect(fixture.launches).toEqual(originalLaunches);
  await access(workspace);
  fixture.restoreCleanup();
  const resumed = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  if (!resumed.ok) throw resumed.error;
  expect(resumed.value.subject?.local_path).toBe(fixture.path);
  await assertFirmwareCleanup(fixture.launches);
});

it("accepts another build on the verified release line and reports it", async () => {
  const fixture = await firmwareFixture("normal", "binwalk 3.1.2");
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  if (!result.ok) throw result.error;
  expect(result.value.provider.version).toBe("3.1.2");
  expect(result.value.limitations.join("\n")).toContain(
    "verified against 3.1.0",
  );
  expect(result.value.normalized_result).toMatchObject({
    engine: { version: "3.1.2" },
  });
  await assertFirmwareCleanup(fixture.launches);
});

it("names the accepted release line when the banner is another line", async () => {
  const fixture = await firmwareFixture("normal", "binwalk 3.2.0");
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining("Binwalk 3.1.x"),
    },
  });
  await assertFirmwareCleanup(fixture.launches);
});

it("rejects absent or unsupported engines without installing anything", async () => {
  const missing = await new FirmwareAnalysisService(
    new FirmwareProvider({}),
  ).execute("inspect_firmware_regions", { path: "/tmp/unused" });
  expect(missing).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  const fixture = await firmwareFixture("version");
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  await assertFirmwareCleanup(fixture.launches);
});
