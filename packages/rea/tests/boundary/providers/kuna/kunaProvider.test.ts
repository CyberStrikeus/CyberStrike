import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it as test, vi } from "vitest";

import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import type { JsonValue } from "../../../../src/domain/jsonValue.js";
import type { KunaProcessLauncher } from "../../../../src/kuna/KunaCommand.js";
import type { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { AnalysisProviderRegistry } from "../../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../../src/application/binary/BinarySessionComposition.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { KunaProvider } from "../../../../src/kuna/KunaProvider.js";
import { KUNA_FUNCTION_TEXT_BYTES } from "../../../../src/kuna/KunaLimits.js";
import { KunaProjectCache } from "../../../../src/kuna/KunaProjectCache.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  fakeKunaCalls,
  setFakeKunaBehavior,
  writeFakeKuna,
} from "./fakeKuna.js";

import {
  session,
  run,
  exportsOf,
  FUNCTIONS,
  unprovenCleanupLauncher,
} from "./kunaSessionFixture.js";

const it = test.skipIf(process.platform === "win32");

it("discovers configuration without probing and admits only verified targets", async () => {
  const root = await createTestTempDirectory("rea-kuna-discovery-");
  const kuna = await writeFakeKuna(root);
  const configured = new KunaProvider({ REA_KUNA_COMMAND: kuna });

  expect(new KunaProvider({}).inspectAvailability()).toMatchObject({
    status: "unavailable",
    code: "not_configured",
  });
  expect(
    new KunaProvider({
      REA_KUNA_COMMAND: join(root, "absent"),
    }).inspectAvailability(),
  ).toMatchObject({ status: "unavailable", code: "executable_missing" });
  expect(configured.inspectAvailability()).toMatchObject({
    status: "available",
    diagnostics: { version_probed: false },
  });
  expect(await fakeKunaCalls(kuna)).toEqual([]);
  const capabilities = configured.capabilities();
  expect(capabilities.length).toBeGreaterThan(0);
  expect(
    capabilities.every(
      ({ available, cachePolicy }) => available && cachePolicy === "live",
    ),
  ).toBe(true);

  const executable = (
    format: "elf" | "mach-o" | "pe" | "mach-o-universal",
    architecture: "x86_64" | "arm64" | "arm" | "x86",
  ) =>
    ({
      path: "/tmp/fixture",
      sha256: "a".repeat(64),
      kind: "executable",
      format,
      architecture,
      availableArchitectures: [architecture],
    }) as unknown as BinaryTarget;
  expect(
    configured.inspectTargetSupport(executable("elf", "x86_64")).status,
  ).toBe("supported");
  expect(
    configured.inspectTargetSupport(executable("mach-o", "arm64")).status,
  ).toBe("supported");
  expect(
    configured.inspectTargetSupport(executable("pe", "x86_64")),
  ).toMatchObject({ status: "unsupported", code: "target_format_unsupported" });
  expect(
    configured.inspectTargetSupport(executable("mach-o-universal", "arm64")),
  ).toMatchObject({ code: "target_format_unsupported" });
  expect(
    configured.inspectTargetSupport(executable("elf", "x86")),
  ).toMatchObject({
    code: "architecture_unsupported",
  });
});

it("waits for an aborted pre-session hash before retrying its late close owner", async () => {
  const fixture = await session("rea-kuna-profile-hash-owner-");
  const binary = composeBinarySession(
    new AnalysisProviderRegistry([fixture.provider], "kuna"),
  );
  const nativeClose = OwnedFileHandle.prototype.close;
  let closeCalls = 0;
  let enteredClose!: () => void;
  let releaseClose!: () => void;
  const closeEntered = new Promise<void>((resolve) => {
    enteredClose = resolve;
  });
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      closeCalls += 1;
      if (closeCalls === 1) {
        enteredClose();
        await closeGate;
      }
      if (closeCalls <= 2)
        throw new Error("injected Kuna profile close failure");
      return nativeClose.call(this);
    });
  try {
    const controller = new AbortController();
    let previewSettled = false;
    const previewWork = binary
      .previewTarget(fixture.target, {
        signal: controller.signal,
      })
      .then((result) => {
        previewSettled = true;
        return result;
      });
    await closeEntered;
    controller.abort();
    let closeSettled = false;
    const closing = binary.close().then((result) => {
      closeSettled = true;
      return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(previewSettled).toBe(false);
    expect(closeSettled).toBe(false);
    expect(await binary.status()).toMatchObject({ cleanup_pending: true });
    releaseClose();
    const preview = await previewWork;
    expect(preview).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cleanupIncomplete: true },
    });
    if (preview.ok) throw new Error("Cancellation unexpectedly succeeded");
    expect(preview.error.cause).toBe(controller.signal.reason);
    expect(preview.error.cleanupResources).toContain(fixture.kuna);

    const firstClose = await closing;
    expect(firstClose).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(await binary.status()).toMatchObject({ cleanup_pending: true });

    close.mockRestore();
    expect(await binary.close()).toEqual({ ok: true, value: null });
    expect(await binary.status()).toMatchObject({ cleanup_pending: false });
    if (preview.ok || firstClose.ok)
      throw new Error("Cleanup unexpectedly succeeded");
    expect(preview.error.cleanupIncomplete).toBe(false);
    expect(firstClose.error.cleanupIncomplete).toBe(false);
  } finally {
    releaseClose();
    close.mockRestore();
    await binary.close();
  }
});

it("commits the observed Kuna release and digest to the analysis profile", async () => {
  const { profile, kuna } = await session("rea-kuna-profile-", {
    version: { stdout: "kuna 1.986\n" },
  });

  expect(profile).toMatchObject({
    provider: { id: "kuna", name: "Kuna", version: "1.986" },
    parameters: {
      kuna_version: "1.986",
      kuna_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      kuna_command: kuna,
      verified_release: true,
      jobs: 1,
      cache_policy: "live",
    },
  });
});

it("lists the selected document without starting target analysis", async () => {
  const { kuna, target, cacheRoot, open } = await session(
    "rea-kuna-document-metadata-",
    { project: "hang" },
  );
  const client = open();
  try {
    expect((await run(client, "list_documents")).result).toEqual([target.path]);
    expect(
      (await fakeKunaCalls(kuna)).every(({ argv }) => argv[0] === "--version"),
    ).toBe(true);
    await expect(readdir(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await client.close();
  }
});

it("answers a cold request from one function, then serves the finished export", async () => {
  const { kuna, cacheRoot, open } = await session("rea-kuna-cold-", {
    delayMs: 300,
  });
  const client = open();

  const cold = await run(client, "procedure_pseudo_code", {
    procedure: "main",
  });
  expect(cold.result).toBe(
    "int main(void) // single-function\n{\n  return 0;\n}",
  );
  expect(cold.rawResult).toMatchObject({
    source: { kind: "single-function" },
    project_export: { state: "building" },
  });
  expect(cold.limitations.at(-1)).toContain("single-function `kuna decompile`");

  // Assembly waits for the export, which then serves every later request.
  const assembly = await run(client, "procedure_assembly", {
    procedure: "0x1000",
  });
  expect(assembly.result).toBe("main:  ; 0x1000\n  00001000: c3     RET");
  const warm = await run(client, "procedure_pseudo_code", {
    procedure: "main",
  });
  expect(warm.result).toBe("int main(void)\n{\n  return 0;\n}");
  expect(warm.rawResult).toMatchObject({
    source: {
      kind: "project-export",
      directory: expect.stringContaining(join(cacheRoot, "projects")),
      file: "program.c",
      file_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    },
    project_export: { state: "ready" },
  });
  // The recorded span is exactly the function's block in the cached .c.
  const source = warm.rawResult as {
    source: { directory: string; byte_offset: number; byte_length: number };
  };
  const c = await readFile(join(source.source.directory, "program.c"));
  expect(
    c
      .subarray(
        source.source.byte_offset,
        source.source.byte_offset + source.source.byte_length,
      )
      .toString(),
  ).toBe("// Function: main @ 0x1000\nint main(void)\n{\n  return 0;\n}\n\n");
  expect(await exportsOf(kuna)).toHaveLength(1);
  expect(await client.close()).toEqual({ ok: true, value: null });

  // A new session over a warm cache never takes the single-function path.
  const again = open();
  expect(
    await run(again, "procedure_pseudo_code", { procedure: "parse" }),
  ).toMatchObject({
    result: "int parse(void)\n{\n  return 1;\n}",
    rawResult: { source: { kind: "project-export" } },
  });
  expect(
    (await fakeKunaCalls(kuna)).filter(({ argv }) => argv[0] === "decompile"),
  ).toHaveLength(1);
  await again.close();
});

it("verifies a warm export once for concurrent first requests on a fresh server", async () => {
  const { kuna, target, cacheRoot, profile, open } = await session(
    "rea-kuna-warm-concurrent-",
  );
  const builder = open();
  await run(builder, "procedure_assembly", { procedure: "main" });
  expect(await builder.close()).toEqual({ ok: true, value: null });

  const lookup = vi.spyOn(KunaProjectCache.prototype, "lookup");
  const fresh = new KunaProvider(
    { REA_KUNA_COMMAND: kuna, REA_KUNA_CACHE_DIR: cacheRoot },
    { platform: process.platform },
  ).createClient(target, profile);
  try {
    const answers = await Promise.all(
      ["main", "parse", "0x1000", "main"].map((procedure) =>
        run(fresh, "procedure_pseudo_code", { procedure }),
      ),
    );
    for (const answer of answers)
      expect(answer.rawResult).toMatchObject({
        source: { kind: "project-export" },
      });
    expect(lookup).toHaveBeenCalledTimes(1);
  } finally {
    lookup.mockRestore();
    expect(await fresh.close()).toEqual({ ok: true, value: null });
  }
});

it("lists, searches and resolves procedures from Kuna's inventory", async () => {
  const { open } = await session("rea-kuna-inventory-");
  const client = open();

  expect((await run(client, "list_procedures")).result).toEqual([
    { address: "0x1000", value: "main" },
    { address: "0x1040", value: "parse" },
    { address: "0x1080", value: "broken" },
    { address: "0x2000", value: "puts" },
  ]);
  expect(
    (await run(client, "search_procedures", { pattern: "^p", mode: "regex" }))
      .result,
  ).toEqual([
    { address: "0x1040", value: "parse" },
    { address: "0x2000", value: "puts" },
  ]);
  expect(
    (await run(client, "procedure_address", { procedure: "0X1040" })).result,
  ).toBe("0x1040");
  for (const procedure of ["missing", "0x1044"])
    expect(
      await client.execute("procedure_address", { procedure }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  await client.close();
});

it("rejects a name that identifies several entries", async () => {
  const { open } = await session("rea-kuna-ambiguous-", {
    functions: [
      { name: "init", addr: "0x1000" },
      { name: "init", addr: "0x1040" },
    ],
  });
  const client = open();

  expect(
    await client.execute("procedure_address", { procedure: "init" }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      userMessage: expect.stringContaining("0x1000, 0x1040"),
    },
  });
  await client.close();
});

it("names function entries and the data Kuna's export labels", async () => {
  const { open } = await session("rea-kuna-names-");
  const client = open();

  expect(
    (await run(client, "address_name", { address: "0x1040" })).result,
  ).toBe("parse");
  expect(
    (await run(client, "address_name", { address: "0x3000" })).result,
  ).toBe("dat_3000");
  expect(
    (await run(client, "address_name", { address: "0x3010" })).result,
  ).toBe("g_table");
  const unnamed = await run(client, "address_name", { address: "0x9999" });
  expect(unnamed.result).toBeNull();
  expect(unnamed.limitations.at(-1)).toContain("not that no symbol exists");
  await client.close();
});

it("reports a failed function and an import slot as unavailable text, not errors", async () => {
  const { open } = await session("rea-kuna-unavailable-");
  const client = open();
  await run(client, "procedure_assembly", { procedure: "main" });

  const broken = await run(client, "procedure_pseudo_code", {
    procedure: "broken",
  });
  expect(broken.result).toBeNull();
  expect(broken.limitations.at(-1)).toBe(
    "Kuna could not decompile this function: Flow exceeded maximum instructions",
  );
  const imported = await run(client, "procedure_pseudo_code", {
    procedure: "puts",
  });
  expect(imported.result).toBeNull();
  expect(
    await client.execute("procedure_assembly", { procedure: "puts" }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  await client.close();
});

it("builds a dossier with text and call relationships, leaving unsupported facets unavailable", async () => {
  const { open } = await session("rea-kuna-dossier-");
  const client = open();

  const dossier = await run(client, "analyze_function", { procedure: "main" });

  expect(dossier.rawResult).toMatchObject({
    source: {
      kind: "project-export",
      files: [
        {
          facet: "pseudocode",
          file_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        {
          facet: "assembly",
          file_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      ],
    },
  });
  const { source } = dossier.rawResult as {
    source: {
      directory: string;
      files: {
        facet: "pseudocode" | "assembly";
        file: string;
        file_sha256: string;
        byte_offset: number;
        byte_length: number;
      }[];
    };
  };
  for (const file of source.files) {
    const bytes = await readFile(join(source.directory, file.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      file.file_sha256,
    );
    const text = bytes
      .subarray(file.byte_offset, file.byte_offset + file.byte_length)
      .toString("utf8");
    const facet = (dossier.result as Record<string, JsonValue>)[file.facet];
    expect(text).toContain(Array.isArray(facet) ? facet.join("\n") : facet);
  }

  expect(dossier.result).toMatchObject({
    procedure: {
      address: "0x1000",
      name: "main",
      body: { available: false },
    },
    pseudocode: "int main(void)\n{\n  return 0;\n}",
    assembly: ["main:  ; 0x1000", "  00001000: c3     RET"],
    facet_availability: {
      pseudocode: { available: true },
      assembly: { available: true },
      callers: { available: true },
      callees: { available: true },
      references: { available: false },
      cfg: { available: false },
    },
  });
  await client.close();
});

it("rejects oversized cached text before buffering while retaining its full export", async () => {
  const { cacheRoot, open } = await session("rea-kuna-text-capacity-", {
    functions: [{ name: "main", addr: "0x1000" }],
    cPadding: KUNA_FUNCTION_TEXT_BYTES,
  });
  const client = open();
  try {
    await run(client, "procedure_assembly", { procedure: "main" });
    for (const operation of [
      "procedure_pseudo_code",
      "analyze_function",
    ] as const) {
      const result = await client.execute(operation, { procedure: "main" });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatchObject({
          _tag: "AnalysisResourceConstraintError",
          resource: "capacity",
          reportedLimits: { limit_bytes: KUNA_FUNCTION_TEXT_BYTES },
        });
    }
    const [key] = await readdir(join(cacheRoot, "projects"));
    const bytes = await readFile(
      join(cacheRoot, "projects", key ?? "", "project", "program.c"),
    );
    expect(bytes.length).toBeGreaterThan(KUNA_FUNCTION_TEXT_BYTES);
  } finally {
    await client.close();
  }
});

it("keeps answering pseudocode one function at a time when the export fails", async () => {
  const { open } = await session("rea-kuna-export-failed-", {
    project: "exit-failure",
  });
  const client = open();

  expect(
    await client.execute("procedure_assembly", { procedure: "main" }),
  ).toMatchObject({
    ok: false,
    error: {
      userMessage: expect.stringContaining(
        "not in recognized object file format",
      ),
    },
  });
  const pseudocode = await run(client, "procedure_pseudo_code", {
    procedure: "main",
  });
  expect(pseudocode.rawResult).toMatchObject({
    source: { kind: "single-function" },
  });
  expect(pseudocode.limitations.at(-1)).toContain("The project export failed");
  await client.close();
});

it("stops waiting for the export when the caller cancels, without abandoning it", async () => {
  const { open } = await session("rea-kuna-wait-cancel-", { delayMs: 1500 });
  const client = open();
  const caller = new AbortController();

  const waiting = client.execute(
    "procedure_assembly",
    { procedure: "main" },
    { signal: caller.signal },
  );
  setTimeout(() => caller.abort(), 200);
  expect(await waiting).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  // The session's export continues and serves the next request.
  expect(
    (await run(client, "procedure_assembly", { procedure: "main" })).rawResult,
  ).toMatchObject({ source: { kind: "project-export" } });
  await client.close();
});

it("stops the export it alone wanted before reporting itself closed", async () => {
  const { kuna, cacheRoot, open } = await session("rea-kuna-close-", {
    project: "hang",
  });
  const client = open();
  await run(client, "procedure_pseudo_code", { procedure: "main" });
  await expect.poll(() => exportsOf(kuna)).toHaveLength(1);
  const pid = (await exportsOf(kuna))[0]?.pid ?? 0;

  expect(await client.close()).toEqual({ ok: true, value: null });

  expect(() => process.kill(pid, 0)).toThrow();
  expect(await readdir(join(cacheRoot, "staging"))).toEqual([]);
  expect(await client.close()).toEqual({ ok: true, value: null });
  expect(
    await client.execute("procedure_pseudo_code", { procedure: "main" }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
});

it.each([false, true])(
  "drains an active single-function request before close (caller signal: %s)",
  async (withCallerSignal) => {
    const { kuna, open } = await session("rea-kuna-close-active-", {
      project: "hang",
      decompile: "hang",
    });
    const client = open();
    const caller = new AbortController();
    const request = client.execute(
      "procedure_pseudo_code",
      { procedure: "main" },
      withCallerSignal ? { signal: caller.signal } : {},
    );
    try {
      await expect
        .poll(async () =>
          (await fakeKunaCalls(kuna)).filter(
            ({ argv }) => argv[0] === "decompile",
          ),
        )
        .toHaveLength(1);
      const call = (await fakeKunaCalls(kuna)).find(
        ({ argv }) => argv[0] === "decompile",
      );
      expect(await client.close()).toEqual({ ok: true, value: null });
      expect(() => process.kill(call?.pid ?? 0, 0)).toThrow();
      expect(await request).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
    } finally {
      caller.abort();
      await request;
      await client.close();
    }
  },
);

it("refuses another document, an unsupported operation and a replaced executable", async () => {
  const { kuna, open } = await session("rea-kuna-refusals-");
  const client = open();

  expect(
    await client.execute("procedure_pseudo_code", {
      procedure: "main",
      document: "/other/program",
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  expect(await client.execute("list_segments", {})).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  await client.close();

  await appendFile(kuna, "\n// replaced\n");
  await setFakeKunaBehavior(kuna, { functions: FUNCTIONS });
  const replaced = open();
  expect(
    await replaced.execute("procedure_pseudo_code", { procedure: "main" }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      userMessage: expect.stringContaining(
        "changed after this target was opened",
      ),
    },
  });
  await replaced.close();
});

it("retains an active request's workspace when close cannot prove its stop", async () => {
  const unproven = unprovenCleanupLauncher("decompile");
  const { kuna, open } = await session(
    "rea-kuna-close-active-unproven-",
    { project: "hang", decompile: "hang" },
    {},
    unproven.launcher,
  );
  const client = open();
  const caller = new AbortController();
  const request = client.execute(
    "procedure_pseudo_code",
    { procedure: "main" },
    { signal: caller.signal },
  );
  try {
    await expect
      .poll(async () =>
        (await fakeKunaCalls(kuna)).filter(
          ({ argv }) => argv[0] === "decompile",
        ),
      )
      .toHaveLength(1);
    const closed = await client.close();
    expect(closed).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(await request).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    const input = (await fakeKunaCalls(kuna)).find(
      ({ argv }) => argv[0] === "decompile",
    )?.argv[1];
    expect(await readFile(input ?? "", "utf8")).toBe("program bytes");
  } finally {
    caller.abort();
    await request;
    unproven.release();
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
});

it("keeps reporting a failed close and succeeds once a retry proves the stop", async () => {
  const unproven = unprovenCleanupLauncher("decompile");
  const { open } = await session(
    "rea-kuna-close-retry-",
    { project: "hang", decompile: "hang" },
    { REA_KUNA_TIMEOUT_MS: "300" },
    unproven.launcher,
  );
  const client = open();

  expect(
    await client.execute("procedure_pseudo_code", { procedure: "main" }),
  ).toMatchObject({ ok: false, error: { cleanupIncomplete: true } });
  const first = await client.close();
  expect(first).toMatchObject({
    ok: false,
    error: { diagnostics: { reason: "decompile stop unproven" } },
  });
  // A retry that still cannot prove the stop keeps failing.
  expect((await client.close()).ok).toBe(false);

  unproven.release();
  expect(await client.close()).toEqual({ ok: true, value: null });
  expect(await client.close()).toEqual({ ok: true, value: null });
});

it("reports an abandoned export's unproven cleanup from close", async () => {
  const unproven = unprovenCleanupLauncher("decompile-project");
  const { kuna, open } = await session(
    "rea-kuna-close-export-",
    { project: "hang" },
    {},
    unproven.launcher,
  );
  const client = open();
  await run(client, "procedure_pseudo_code", { procedure: "main" });
  await expect.poll(() => exportsOf(kuna)).toHaveLength(1);

  expect(await client.close()).toMatchObject({
    ok: false,
    error: { diagnostics: { reason: "decompile-project stop unproven" } },
  });
  unproven.release();
  expect(await client.close()).toEqual({ ok: true, value: null });
});

it("retries the abandoned export's file cleanup before reporting close success", async () => {
  const launcher: KunaProcessLauncher = async (options) => {
    const spawned = await spawnOwnedProviderProcess(options);
    if (options.arguments[0] !== "decompile-project") return spawned;
    return {
      ...spawned,
      cleanup: async () => {
        const stopped = await cleanupOwnedProcessGroup(spawned.ownership);
        // The child is stopped, but its private input cannot yet be removed.
        await chmod(options.cwd ?? "", 0o500);
        return stopped;
      },
    };
  };
  const { kuna, cacheRoot, open } = await session(
    "rea-kuna-close-export-files-",
    { project: "hang" },
    {},
    launcher,
  );
  const client = open();
  try {
    await run(client, "procedure_pseudo_code", { procedure: "main" });
    await expect.poll(() => exportsOf(kuna)).toHaveLength(1);
    expect(await client.close()).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect((await client.close()).ok).toBe(false);
  } finally {
    const restore = async (directory: string): Promise<void> => {
      await chmod(directory, 0o700);
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isDirectory()) await restore(join(directory, entry.name));
    };
    await restore(cacheRoot);
    expect(await client.close()).toEqual({ ok: true, value: null });
  }
  expect(await readdir(join(cacheRoot, "staging"))).toEqual([]);
  expect(await readdir(join(cacheRoot, "trash"))).toEqual([]);
});

it("refuses to launch an executable replaced after the target was opened", async () => {
  const { kuna, open } = await session("rea-kuna-swapped-", {
    project: "exit-failure",
  });
  const client = open();
  await run(client, "procedure_pseudo_code", { procedure: "main" });

  await appendFile(kuna, "\n// replaced mid-session\n");
  expect(
    await client.execute("procedure_pseudo_code", { procedure: "parse" }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      userMessage: expect.stringContaining(
        "changed after this target was opened",
      ),
    },
  });
  await client.close();
});

it("recovers when another server evicts the export this session adopted", async () => {
  const { cacheRoot, open } = await session("rea-kuna-evicted-");
  const client = open();
  await run(client, "procedure_assembly", { procedure: "main" });
  const [key] = await readdir(join(cacheRoot, "projects"));
  await mkdir(join(cacheRoot, "trash"), { recursive: true });
  await rename(
    join(cacheRoot, "projects", key ?? ""),
    join(cacheRoot, "trash", "elsewhere"),
  );

  // Pseudocode falls back while the export rebuilds; assembly waits for it.
  const pseudocode = await run(client, "procedure_pseudo_code", {
    procedure: "parse",
  });
  expect(pseudocode.result).toContain("parse");
  const assembly = await run(client, "procedure_assembly", {
    procedure: "parse",
  });
  expect(assembly.rawResult).toMatchObject({
    source: { kind: "project-export" },
  });
  expect(await readdir(join(cacheRoot, "projects"))).toEqual([key]);
  await client.close();
});

it("reports a failed export as failed rather than building", async () => {
  const { open } = await session("rea-kuna-failed-state-", {
    project: "exit-failure",
  });
  const client = open();
  await client.execute("procedure_assembly", { procedure: "main" });

  expect(
    (await run(client, "procedure_pseudo_code", { procedure: "main" }))
      .rawResult,
  ).toMatchObject({
    project_export: {
      state: "failed",
      reason: expect.stringContaining("not in recognized object file format"),
    },
  });
  await client.close();
});

it.each([
  {
    name: "export deadline",
    behavior: { project: "hang" } as const,
    environment: { REA_KUNA_PROJECT_TIMEOUT_MS: "300" },
    cause: "AnalysisTimeoutError",
    next: "To retry, set REA_KUNA_PROJECT_TIMEOUT_MS above 300 ms or raise REA_KUNA_JOBS in the environment that starts REA. REA reads Kuna settings when it starts, so restart REA, then reopen the target.",
    details: {
      timeout_ms: 300,
      captured_output: { truncated: expect.any(Boolean) },
    },
  },
  {
    name: "Kuna failure",
    behavior: { project: "exit-failure" } as const,
    environment: {},
    cause: "ProviderAdapterError",
    next: "To retry, resolve the reported failure, then reopen the target.",
    details: { captured_output: { exit_code: 1 } },
  },
  {
    name: "cache capacity",
    behavior: { asmPadding: 2 * 1024 ** 2 },
    environment: { REA_KUNA_CACHE_MAX_BYTES: String(1024 ** 2) },
    cause: "AnalysisResourceConstraintError",
    next: "Raise REA_KUNA_CACHE_MAX_BYTES above the export size, or analyze this target with another provider. REA reads Kuna settings when it starts, so restart REA, then reopen the target.",
    details: {
      resource: "capacity",
      reported_limits: {
        cache_max_bytes: 1024 ** 2,
        export_bytes: expect.any(Number),
      },
    },
  },
  {
    // A fixed output buffer is no setting, so no restart is suggested.
    name: "fixed output buffer",
    behavior: { project: "noisy" } as const,
    environment: {},
    cause: "AnalysisResourceConstraintError",
    next: "REA buffers at most 8388608 bytes of kuna decompile-project output, so repeating this request for this target fails the same way. Use another provider for it.",
    details: {
      resource: "memory",
      reported_limits: { output_limit_bytes: 8 * 1024 ** 2 },
    },
  },
])(
  "reports a failed export as not retryable in its session ($name)",
  async ({ behavior, environment, cause, next, details }) => {
    const { open } = await session(
      "rea-kuna-export-unavailable-",
      behavior,
      environment,
    );
    const client = open();
    try {
      for (const operation of [
        "procedure_assembly",
        "analyze_function",
      ] as const) {
        const result = await client.execute(operation, { procedure: "main" });
        if (result.ok) throw new Error(`${operation} unexpectedly succeeded`);
        expect(result.error).toMatchObject({
          _tag: "AnalysisCapabilityUnavailableError",
          retryable: false,
        });
        expect(result.error.userMessage?.endsWith(next)).toBe(true);
        const failure = result.error.cause as AnalysisError;
        expect(failure._tag).toBe(cause);
        // Callers see only the top-level projection; the export failure's own
        // projected code and details travel whole inside it.
        const exported = projectAnalysisError(failure);
        const projected = projectAnalysisError(result.error);
        expect(projected).toMatchObject({
          code: "capability_unavailable",
          retryable: false,
          details: {
            diagnostics: {
              export_error: cause,
              export_code: exported.code,
              export_details: exported.details,
            },
          },
        });
        expect(exported.details).toMatchObject(details);
      }
    } finally {
      expect(await client.close()).toEqual({ ok: true, value: null });
    }
  },
);

it("lets one caller stop waiting for the shared inventory without failing another", async () => {
  const { open } = await session("rea-kuna-shared-inventory-", {
    inventoryDelayMs: 700,
  });
  const client = open();
  const first = new AbortController();

  const cancelled = client.execute(
    "list_procedures",
    {},
    { signal: first.signal },
  );
  const waiting = client.execute("search_procedures", { pattern: "main" });
  setTimeout(() => first.abort(), 100);

  expect(await cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(await waiting).toMatchObject({
    ok: true,
    value: { result: [{ address: "0x1000", value: "main" }] },
  });
  await client.close();
});

it("leaves no private copy behind when workspace setup fails", async () => {
  const { target, open } = await session("rea-kuna-workspace-leak-", {
    project: "hang",
  });
  const runtime = await createTestTempDirectory("rea-kuna-runtime-");
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = runtime;
  try {
    const client = open();
    // A vanished target makes the copy itself throw mid-setup.
    await rename(target.path, `${target.path}.moved`);

    expect(
      await client.execute("procedure_pseudo_code", { procedure: "main" }),
    ).toMatchObject({ ok: false });
    expect(await readdir(runtime)).toEqual([]);
    expect(await client.close()).toEqual({ ok: true, value: null });
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
});

it.each([
  ["c", "overwrite"],
  ["c", "replace"],
  ["asm", "overwrite"],
  ["asm", "replace"],
] as const)(
  "rebuilds a changed %s export (%s) before producing dossier Evidence",
  async (extension, mutation) => {
    const { open, provider, kuna } = await session(
      "rea-kuna-export-integrity-",
    );
    const client = open();
    try {
      const first = await run(client, "analyze_function", {
        procedure: "main",
      });
      const source = (
        first.rawResult as {
          source: {
            directory: string;
            files: { file: string; file_sha256: string }[];
          };
        }
      ).source;
      const selected = source.files.find(({ file }) =>
        file.endsWith(`.${extension}`),
      );
      if (selected === undefined) throw new Error("Missing exported facet");
      const path = join(source.directory, selected.file);
      const original = await readFile(path, "utf8");
      const edited =
        extension === "c"
          ? original.replace("return 0", "return 9")
          : original.replace("RET", "NOP");
      expect(edited).not.toBe(original);
      expect(Buffer.byteLength(edited)).toBe(Buffer.byteLength(original));
      if (mutation === "replace") {
        await writeFile(`${path}.replacement`, edited);
        await rename(`${path}.replacement`, path);
      } else await writeFile(path, edited);
      const recovered = await run(client, "analyze_function", {
        procedure: "main",
      });
      const recoveredSource = (recovered.rawResult as { source: typeof source })
        .source;
      for (const file of recoveredSource.files) {
        const bytes = await readFile(
          join(recoveredSource.directory, file.file),
        );
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          file.file_sha256,
        );
      }
      expect(recovered.result).toEqual(first.result);
      expect(
        (await fakeKunaCalls(kuna)).filter(
          ({ argv }) => argv[0] === "decompile-project",
        ),
      ).toHaveLength(2);
    } finally {
      expect(await client.close()).toMatchObject({ ok: true });
      expect(await provider.closeOwnedResources()).toMatchObject({ ok: true });
    }
  },
);
