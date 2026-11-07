import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { SafeOutputTreeCreationFailure } from "../../../src/artifacts/SafeOutputTreeCreationFailure.js";
import { javascriptRecoveryResultSchema } from "../../../src/domain/javascript/javascriptRecovery.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { RECOVERY_LIMITS } from "../../../src/javascript/recovery/WakaruRelease.js";
import {
  assertRecoveryCleanup,
  recoveryFixture,
} from "../../fixtures/javascript-recovery/provider.js";
import { readWithoutFifoWriter } from "../../fixtures/fifoInput.js";
import { injectPublishedDirectoryCloseFailure } from "../../support/publishedDirectoryCloseFailure.js";

const registerRecoveryProvenanceCases = () => {
  it("publishes exact bytes and mappings with source identity and no runtime-equivalence claim", async () => {
    const fixture = await recoveryFixture();
    const result = await fixture.service.recover({
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (!result.ok) throw result.error;
    expect(parseEvidence(result.value)).toEqual(result.value);
    const value = javascriptRecoveryResultSchema.parse(
      result.value.normalized_result,
    );
    expect(value).toMatchObject({
      status: "complete",
      total: 1,
      failed: 0,
      runtime_equivalence: "unknown",
      analysis_input: {
        input_path: join(fixture.output, "modules"),
        format: "directory",
      },
    });
    expect(value.source.path).toBe(fixture.path);
    expect(value.additional_sources).toBeUndefined();
    expect(value.source.published_copy.sha256).toBe(value.source.sha256);
    expect(value.modules[0]?.provenance.byte_ranges).toEqual([
      { start: 0, end: value.source.bytes },
    ]);
    expect(value.engine.executed_source_revision).toBeNull();
    expect(await readFile(value.source.published_copy.path, "utf8")).toBe(
      "module.exports = 42;",
    );
    expect(result.value.confidence).toBe("derived");
    await assertRecoveryCleanup(fixture.launches);
  });

  it.each([
    "missing-provenance",
    "malformed-report",
    "duplicate",
    "missing-file",
    "escaping",
    "extra-file",
    "symlink",
    "directory-symlink",
    "bad-map",
    "source-mismatch",
    "overflow-range",
    "extra-provenance",
    "snapshot-change",
    "source-change",
    "engine-change",
    "startup-error",
  ])(
    "rejects %s, rolls back publication and cleans its processes",
    async (mode) => {
      const fixture = await recoveryFixture(mode);
      const result = await fixture.service.recover({
        path: fixture.path,
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected boundary failure");
      const error = projectAnalysisError(result.error);
      if (mode === "source-change" || mode === "engine-change") {
        expect(error.code).toBe("artifact_changed");
        expect(error.details).toMatchObject({
          operation: "recover_javascript_sources",
          path:
            mode === "source-change"
              ? fixture.path
              : join(fixture.root, "fixture-wakaru"),
        });
      } else {
        expect(
          ["execution_failure", "unreadable_output"],
          JSON.stringify(error),
        ).toContain(error.code);
      }
      expect(error.details).toBeDefined();
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await assertRecoveryCleanup(fixture.launches);
    },
  );

  it("rejects byte ranges splitting a UTF-8 code point", async () => {
    const fixture = await recoveryFixture("utf8-range", "🎯");
    const result = await fixture.service.recover({
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (result.ok) throw new Error("expected invalid UTF-8 boundary");
    expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
      "UTF-8 byte range",
    );
    await assertRecoveryCleanup(fixture.launches);
  });
};

const registerRecoveryReleaseAndPartialCases = () => {
  it("accepts a later release on the verified major line with additive report fields", async () => {
    const fixture = await recoveryFixture("additive");
    const result = await fixture.service.recover({
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (!result.ok) throw result.error;
    const value = javascriptRecoveryResultSchema.parse(
      result.value.normalized_result,
    );
    expect(value).toMatchObject({
      status: "complete",
      engine: { version: "1.99.0" },
      modules: [{ reported_status: "future_status" }],
    });
    expect(result.value.provider.version).toBe("1.99.0");
    expect(
      value.limitations.some((limitation) =>
        limitation.includes("This session uses Wakaru 1.99.0"),
      ),
    ).toBe(true);
    expect(JSON.parse(await readFile(value.report.path, "utf8"))).toMatchObject(
      {
        future_report_field: { nested: true },
        warnings: [{ code: "W001" }],
      },
    );
    expect(value.warnings).toEqual([
      {
        filename: "module.js",
        kind: "notice",
        is_error: false,
        message: "future warning",
      },
    ]);
    await assertRecoveryCleanup(fixture.launches);
  });

  it("retains valid partial output and exact failure diagnostics", async () => {
    const fixture = await recoveryFixture("partial");
    const result = await fixture.service.recover({
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (!result.ok) throw result.error;
    const value = javascriptRecoveryResultSchema.parse(
      result.value.normalized_result,
    );
    expect(value).toMatchObject({
      status: "partial",
      failed: 1,
      warnings: [{ is_error: true, kind: "parse_error" }],
    });
    expect(value.modules).toHaveLength(1);
    await assertRecoveryCleanup(fixture.launches);
  });
};

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru recovery boundary",
  () => {
    registerRecoveryProvenanceCases();
    registerRecoveryReleaseAndPartialCases();
  },
);

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru recovery lifecycle",
  () => {
    it("rejects an existing output without modifying it or launching recovery", async () => {
      const fixture = await recoveryFixture();
      await mkdir(fixture.output);
      await writeFile(join(fixture.output, "keep.txt"), "keep");
      const result = await fixture.service.recover({
        path: fixture.path,
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected existing-output rejection");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: ["output_directory"] }] },
      });
      expect(await readFile(join(fixture.output, "keep.txt"), "utf8")).toBe(
        "keep",
      );
      expect(fixture.launches).toHaveLength(0);
    });

    it("cancels an active recovery and verifies owned cleanup", async () => {
      const fixture = await recoveryFixture("hang");
      const controller = new AbortController();
      const resultPromise = fixture.service.recover(
        { path: fixture.path, output_directory: fixture.output },
        { signal: controller.signal },
      );
      const deadline = Date.now() + 10000;
      while (true) {
        const run = fixture.launches[1];
        if (
          run?.cwd !== undefined &&
          (await access(join(run.cwd, "recovery-started")).then(
            () => true,
            () => false,
          ))
        )
          break;
        if (Date.now() > deadline)
          throw new Error("fixture recovery did not start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      const result = await resultPromise;
      if (result.ok) throw new Error("expected cancellation");
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await assertRecoveryCleanup(fixture.launches);
    });

    it("reports cleanup failure and retains the workspace named by the error", async () => {
      const fixture = await recoveryFixture("cleanup-failure");
      const result = await fixture.service.recover({
        path: fixture.path,
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected cleanup failure");
      expect(projectAnalysisError(result.error).code).toBe(
        "cleanup_incomplete",
      );
      expect(result.error).toMatchObject({
        diagnostics: { reason: "injected cleanup refusal" },
      });
      const launch = fixture.launches[0];
      if (launch?.cwd === undefined)
        throw new Error("missing process ownership");
      await expect(access(launch.cwd)).resolves.toBeUndefined();
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("rejects an incompatible engine with its observed version", async () => {
      const fixture = await recoveryFixture("wrong-version");
      const result = await fixture.service.recover({
        path: fixture.path,
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected version failure");
      expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
        "wakaru 0.0.0",
      );
      expect(projectAnalysisError(result.error).code).toBe(
        "capability_unavailable",
      );
      await assertRecoveryCleanup(fixture.launches);
    });
  },
);

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru publication ownership",
  () => {
    it("retains a setup-failed publication tree for provider cleanup retry", async () => {
      const fixture = await recoveryFixture();
      const createTree = SafeOutputTree.create.bind(SafeOutputTree);
      let cleanupAttempts = 0;
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
        const result = await fixture.service.recover({
          path: fixture.path,
          output_directory: fixture.output,
        });
        if (result.ok) throw new Error("expected setup failure");
        expect(projectAnalysisError(result.error).code).toBe(
          "cleanup_incomplete",
        );
        expect(result.error).toMatchObject({
          diagnostics: {
            cleanup_failures: [
              {
                resource: fixture.output,
                reason: "injected first cleanup failure",
              },
            ],
          },
        });
        await expect(access(fixture.output)).resolves.toBeUndefined();
      } finally {
        create.mockRestore();
      }
      if (fixture.provider.close === undefined)
        throw new Error("Expected Wakaru cleanup capability");
      await fixture.provider.close();
      expect(cleanupAttempts).toBe(2);
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("returns completed recovery when retry closes a descriptor after commit", async () => {
      const fixture = await recoveryFixture();
      const failure = await injectPublishedDirectoryCloseFailure(
        fixture.output,
      );
      try {
        const result = await fixture.service.recover({
          path: fixture.path,
          output_directory: fixture.output,
        });
        if (!result.ok) throw result.error;
        const published = javascriptRecoveryResultSchema.parse(
          result.value.normalized_result,
        );
        expect(failure.wasInjected()).toBe(true);
        expect(failure.owners).toHaveLength(2);
        expect(failure.owners[1]).toBe(failure.owners[0]);
        expect(failure.owners[0]?.handle.fd).toBe(-1);
        await expect(access(published.manifest.path)).resolves.toBeUndefined();
        expect(published.source.published_copy.path).toContain(fixture.output);
      } finally {
        failure.allowCleanup();
        try {
          await fixture.provider.close?.();
        } finally {
          failure.restore();
        }
      }
      await assertRecoveryCleanup(fixture.launches);
    });

    it("retains published recovery and its result while cleanup remains unresolved", async () => {
      const fixture = await recoveryFixture();
      const failure = await injectPublishedDirectoryCloseFailure(
        fixture.output,
        true,
      );
      try {
        const result = await fixture.service.recover({
          path: fixture.path,
          output_directory: fixture.output,
        });
        if (result.ok) throw new Error("Expected unresolved cleanup");
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(result.error.partialObservation).toMatchObject({
          kind: "javascript-recovery",
          result: {
            source: {
              published_copy: {
                path: expect.stringContaining(fixture.output),
              },
            },
            manifest: { path: expect.stringContaining(fixture.output) },
          },
        });
        await expect(
          access(join(fixture.output, "manifest.json")),
        ).resolves.toBeUndefined();
        expect(failure.wasInjected()).toBe(true);
        expect(failure.owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
        if (fixture.provider.close === undefined)
          throw new Error("Expected Wakaru cleanup capability");
        failure.allowCleanup();
        await fixture.provider.close();
        expect(failure.owners.length).toBeGreaterThan(1);
        expect(
          failure.owners.every((owner) => owner === failure.owners[0]),
        ).toBe(true);
        expect(failure.owners[0]?.handle.fd).toBe(-1);
      } finally {
        failure.allowCleanup();
        try {
          await fixture.provider.close?.();
        } finally {
          failure.restore();
        }
      }
      await expect(
        access(join(fixture.output, "manifest.json")),
      ).resolves.toBeUndefined();
      await assertRecoveryCleanup(fixture.launches);
    });
  },
);

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru selected input layout",
  () => {
    it("preserves selected source identities and layout through a symlink followed by ..", async () => {
      const fixture = await recoveryFixture();
      await mkdir(join(fixture.root, "target/child"), { recursive: true });
      await symlink("target/child", join(fixture.root, "link"));
      const selected = `${fixture.root}/link/../selected.js`;
      await writeFile(selected, "export const selected = true;\n");
      const result = await fixture.service.recover({
        path: selected,
        additional_paths: [fixture.path],
        output_directory: fixture.output,
      });
      if (!result.ok) throw result.error;
      const value = javascriptRecoveryResultSchema.parse(
        result.value.normalized_result,
      );
      const sources = [value.source, ...(value.additional_sources ?? [])];
      expect(sources.map(({ path }) => path)).toEqual([selected, fixture.path]);
      expect(sources.map(({ published_copy }) => published_copy.path)).toEqual([
        join(fixture.output, "inputs/target/selected.js"),
        join(fixture.output, "inputs/selected.js"),
      ]);
      expect(await readFile(sources[0]!.published_copy.path, "utf8")).toBe(
        "export const selected = true;\n",
      );
      expect(await readFile(sources[1]!.published_copy.path, "utf8")).toBe(
        "module.exports = 42;",
      );
      expect(result.value.parameters).toMatchObject({
        path: selected,
        additional_paths: [fixture.path],
      });
      expect(result.value.subject).toMatchObject({
        local_path: selected,
        digest: { sha256: sources[0]!.sha256 },
      });
      for (const [index, module] of value.modules.entries())
        expect(module.provenance).toMatchObject({
          original_path: sources[index]!.path,
          original_sha256: sources[index]!.sha256,
        });
      await assertRecoveryCleanup(fixture.launches);
    });
  },
);

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru multi-input ownership",
  () => {
    it.each(["cafe\u0301.js", "chunk\\name.js"])(
      "rejects an unpublishable native filename %s before launching",
      async (name) => {
        const fixture = await recoveryFixture();
        const additional = join(fixture.root, name);
        await writeFile(additional, "export const value = 1;");
        const result = await fixture.service.recover({
          path: fixture.path,
          additional_paths: [additional],
          output_directory: fixture.output,
        });
        if (result.ok)
          throw new Error("expected unsupported input-layout failure");
        expect(projectAnalysisError(result.error).code).toBe("invalid_request");
        expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
          "Cannot preserve selected input path",
        );
        expect(fixture.launches).toHaveLength(0);
        await expect(access(fixture.output)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(additional, "utf8")).toBe(
          "export const value = 1;",
        );
      },
    );
    it("keeps separate snapshots, per-file ranges and relative paths for same-named inputs", async () => {
      const fixture = await recoveryFixture(
        "normal",
        "import './nested/selected.js';\n",
      );
      const nested = join(fixture.root, "nested");
      await mkdir(nested);
      const additional = join(nested, "selected.js");
      const content = "export const target = '🎯';\n";
      await writeFile(additional, content);
      const result = await fixture.service.recover({
        path: fixture.path,
        additional_paths: [additional],
        output_directory: fixture.output,
      });
      if (!result.ok) throw result.error;
      const value = javascriptRecoveryResultSchema.parse(
        result.value.normalized_result,
      );
      const sources = [value.source, ...(value.additional_sources ?? [])];
      expect(sources.map((source) => source.path)).toEqual([
        fixture.path,
        additional,
      ]);
      expect(sources.map((source) => source.published_copy.path)).toEqual([
        join(fixture.output, "inputs/selected.js"),
        join(fixture.output, "inputs/nested/selected.js"),
      ]);
      expect(await readFile(sources[1]!.published_copy.path, "utf8")).toBe(
        content,
      );
      expect(result.value.subject?.digest.sha256).toBe(value.source.sha256);
      for (const [index, module] of value.modules.entries()) {
        const source = sources[index]!;
        expect(source.published_copy.sha256).toBe(source.sha256);
        expect(module.provenance).toMatchObject({
          reported_input: source.snapshot_path,
          original_path: source.path,
          original_sha256: source.sha256,
          byte_ranges: [{ start: 0, end: source.bytes }],
          context_byte_ranges: [{ start: 0, end: source.bytes }],
        });
      }
      const manifest = JSON.parse(await readFile(value.manifest.path, "utf8"));
      expect(manifest.additional_sources).toEqual(value.additional_sources);
      await assertRecoveryCleanup(fixture.launches);
    });

    it.each([
      "secondary-foreign",
      "secondary-overflow",
      "secondary-utf8",
      "secondary-change",
      "redistribute",
    ])("rejects %s against its own source and rolls back", async (mode) => {
      const fixture = await recoveryFixture(mode, "a");
      const additional = join(fixture.root, "chunk.js");
      await writeFile(additional, mode === "secondary-utf8" ? "🎯" : "bc");
      const result = await fixture.service.recover({
        path: fixture.path,
        additional_paths: [additional],
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected per-source validation failure");
      const code = projectAnalysisError(result.error).code;
      if (mode === "secondary-change" || mode === "redistribute")
        expect(code).toBe("artifact_changed");
      else expect(["execution_failure", "unreadable_output"]).toContain(code);
      const reason =
        mode === "secondary-foreign"
          ? "does not bind the selected input snapshot"
          : mode === "redistribute" || mode === "secondary-change"
            ? "Original input changed"
            : "Invalid half-open UTF-8 byte range";
      expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
        reason,
      );
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await assertRecoveryCleanup(fixture.launches);
    });

    it("rejects aggregate input overflow before launching the engine", async () => {
      const fixture = await recoveryFixture("normal", "a");
      const additional = join(fixture.root, "chunk.js");
      const handle = await open(additional, "wx");
      try {
        await handle.truncate(RECOVERY_LIMITS.inputBytes);
      } finally {
        await handle.close();
      }
      const result = await fixture.service.recover({
        path: fixture.path,
        additional_paths: [additional],
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected aggregate capacity failure");
      expect(projectAnalysisError(result.error).code).toBe(
        "resource_constraint",
      );
      expect(fixture.launches).toHaveLength(0);
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("rejects non-UTF-8 input before launching recovery", async () => {
      const fixture = await recoveryFixture();
      await writeFile(fixture.path, Buffer.from([0xff, 0xfe]));
      const result = await fixture.service.recover({
        path: fixture.path,
        output_directory: fixture.output,
      });
      if (result.ok) throw new Error("expected malformed source failure");
      expect(projectAnalysisError(result.error).code).toBe("invalid_request");
      expect(fixture.launches).toHaveLength(0);
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  },
);

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "Wakaru input admission",
  () => {
    it("rejects a named pipe without waiting for a writer or launching recovery", async () => {
      const fixture = await recoveryFixture();
      const fifoPath = join(dirname(fixture.path), "pipe.js");
      await promisify(execFile)("mkfifo", [fifoPath]);
      const outcome = await readWithoutFifoWriter(fifoPath, () =>
        fixture.service.recover({
          path: fifoPath,
          output_directory: fixture.output,
        }),
      );
      if (outcome.state !== "completed")
        throw new Error("Recovery input read waited for a FIFO writer");
      if (outcome.result.ok) throw new Error("expected non-regular input");
      expect(projectAnalysisError(outcome.result.error).code).toBe(
        "invalid_request",
      );
      expect(fixture.launches).toHaveLength(0);
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  },
);
