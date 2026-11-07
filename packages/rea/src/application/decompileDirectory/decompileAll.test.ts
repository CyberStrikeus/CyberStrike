import {
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";

import {
  createAnalysisExecution,
  type AnalysisOperation,
  type AnalysisOperationPort,
} from "../AnalysisProvider.js";
import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { EnhancedTools } from "../EnhancedTools.js";
import { DecompileExport } from "./exportTree.js";
import { ExportResources } from "./exportResources.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../../filesystem/OwnedStagedOutput.js";
import {
  composedLimitationBudget,
  createWorkflowEvidence,
  executeComposedWorkflow,
} from "../WorkflowEvidence.js";
import { toolContract } from "../../contracts/toolContracts.js";
import {
  DECOMPILE_DIRECTORY_INDEX_NAME,
  DECOMPILE_DIRECTORY_JOURNAL_NAME,
  decompileDirectoryIndexSchema,
  decompileJournalLineSchema,
} from "../../contracts/decompileDirectory.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { createEvidence } from "../../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok } from "../../domain/result.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };
const profile = createAnalysisProfile(provider, { decompiler: "fixture" });
const otherProfile = createAnalysisProfile(provider, { decompiler: "other" });
const targetSha = "ab".repeat(32);
const sentinel = "UNIQUE_PSEUDO_SENTINEL */";

interface Procedure {
  readonly address: string;
  readonly name: string;
}

interface RecordedCall {
  readonly operation: AnalysisOperation;
  readonly procedure: unknown;
  readonly origin: unknown;
}

const subject = {
  path: "/tmp/fixture",
  sha256: targetSha,
  format: "elf" as const,
  architecture: "x86_64" as const,
};

const infoFor = (
  address: string,
  ranges: readonly { readonly start: string; readonly end: string }[] = [
    { start: address, end: address },
  ],
) => {
  const nonContiguous = ranges.length > 1;
  const total = ranges.reduce((sum, range) => {
    const start = BigInt(range.start);
    const end = BigInt(range.end);
    return sum + Number(end - start + 1n);
  }, 0);
  const span = nonContiguous
    ? Number(
        BigInt(ranges.at(-1)?.end ?? address) -
          BigInt(ranges[0]?.start ?? address) +
          1n,
      )
    : total;
  return {
    name: "fixture",
    entrypoint: address,
    basicblock_count: 1,
    length: total,
    signature: null,
    locals: [],
    classification: null,
    body: {
      available: true as const,
      provenance: "fixture",
      ranges,
      total_bytes: total,
      span_bytes: span,
      non_contiguous: nonContiguous,
      contains_entry: true,
    },
  };
};

/** procedure_info for an import: Ghidra reports an observed body with no ranges. */
const externalInfoFor = (address: string) => ({
  ...infoFor(address),
  basicblock_count: 0,
  length: 0,
  classification: {
    external: true,
    thunk: false,
    thunk_target: null,
    provenance: "fixture",
  },
  body: {
    available: true as const,
    provenance: "fixture",
    ranges: [],
    total_bytes: 0,
    span_bytes: 0,
    non_contiguous: false,
    contains_entry: false,
  },
});

const harness = (options?: {
  readonly procedures?: readonly Procedure[];
  readonly fail?: Readonly<
    Record<string, "error" | "timeout" | "empty" | "null">
  >;
  readonly info?: "ok" | "unavailable" | "error";
  readonly subject?: boolean;
  readonly mismatch?: string;
  readonly unprofiled?: string;
  readonly foreignTarget?: string;
  /** Per-address caveats, as Ghidra reports terminal calls. */
  readonly addressCaveats?: boolean;
  /** Addresses procedure_info classifies as external, as Ghidra does for imports. */
  readonly external?: readonly string[];
}) => {
  const procedures = options?.procedures ?? [
    { address: "0x3000", name: "Bar::late" },
    { address: "0x1000", name: "Foo::main" },
    { address: "0x2000", name: "Foo::helper" },
  ];
  const calls: RecordedCall[] = [];
  const port: AnalysisOperationPort = {
    execute: (operation, parameters, execution) => {
      calls.push({
        operation,
        procedure: parameters.procedure,
        origin: execution?.selectorOrigin,
      });
      if (operation === "list_procedures")
        return Promise.resolve(
          ok(
            createAnalysisExecution(
              procedures.map((procedure) => ({
                address: procedure.address,
                value: procedure.name,
              })),
              provider,
              {
                analysisProfile: profile,
                ...(options?.subject === false ? {} : { subject }),
              },
            ),
          ),
        );
      if (operation === "procedure_info") {
        if (options?.info === "unavailable")
          return Promise.resolve(
            err(
              new AnalysisCapabilityUnavailableError(
                provider.id,
                operation,
                "no body",
              ),
            ),
          );
        if (options?.info === "error")
          return Promise.resolve(err(new AnalysisInputError(operation)));
        const address = String(parameters.procedure);
        const info =
          options?.external?.includes(address) === true
            ? externalInfoFor(address)
            : infoFor(address);
        return Promise.resolve(
          ok(
            createAnalysisExecution(info, provider, {
              analysisProfile: profile,
              ...(options?.addressCaveats === true
                ? { limitations: [`info caveat at ${address}`] }
                : {}),
            }),
          ),
        );
      }
      if (operation === "procedure_pseudo_code") {
        const address = String(parameters.procedure);
        const failure = options?.fail?.[address];
        if (failure === "timeout")
          return Promise.resolve(err(new AnalysisTimeoutError(operation, 1)));
        if (failure === "error")
          return Promise.resolve(err(new AnalysisInputError(operation)));
        if (failure === "empty")
          return Promise.resolve(
            ok(
              createAnalysisExecution("", provider, {
                analysisProfile: profile,
              }),
            ),
          );
        if (failure === "null")
          return Promise.resolve(
            ok(
              createAnalysisExecution(null, provider, {
                analysisProfile: profile,
              }),
            ),
          );
        const selected = options?.mismatch === address ? otherProfile : profile;
        return Promise.resolve(
          ok(
            createAnalysisExecution(`int fn(void) { ${sentinel} }`, provider, {
              ...(options?.unprofiled === address
                ? {}
                : { analysisProfile: selected }),
              ...(options?.foreignTarget === address
                ? { subject: { ...subject, sha256: "cd".repeat(32) } }
                : {}),
              limitations: [
                "terminal call may cut the body",
                ...(options?.addressCaveats === true
                  ? [`terminal call at ${address}`]
                  : []),
              ],
            }),
          ),
        );
      }
      return Promise.resolve(err(new AnalysisInputError(operation)));
    },
  };
  return { calls, port, tools: new EnhancedTools(port), procedures };
};

const run = (
  tools: EnhancedTools,
  directory: string,
  input: Readonly<Record<string, JsonValue>> = {},
  signal?: AbortSignal,
) =>
  tools.execute(
    "decompile_all",
    { output_directory: directory, ...input },
    signal,
  );

const of = (calls: readonly RecordedCall[], operation: AnalysisOperation) =>
  calls.filter((call) => call.operation === operation);

const useOutputDirectory = (): (() => string) => {
  let parent = "";
  beforeEach(async () => {
    parent = await createTestTempDirectory("rea-decompile-all-");
  });
  return () => join(parent, "out");
};

describe("decompile_all manifest", () => {
  const directory = useOutputDirectory();

  it("writes every function, keeps pseudocode out of the manifest, and records identity", async () => {
    const { calls, tools } = harness();
    const result = await run(tools, directory());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: {
        selected: 3,
        excluded: 0,
        requested: 3,
        written: 3,
        failed: 0,
        skipped: 0,
        remaining: 0,
      },
      target_sha256: targetSha,
      analysis_profile_digest: profile.digest,
      provider,
      layout: "address",
      layout_status: "address",
      failures: [],
    });
    expect(JSON.stringify(result.value)).not.toContain(sentinel);
    const text = await readFile(
      join(directory(), "functions/0x1000.c"),
      "utf8",
    );
    expect(
      text.startsWith(
        "// rea decompile_all\n// name: Foo::main\n// address: 0x1000\n",
      ),
    ).toBe(true);
    expect(text).toContain("// range: 0x1000-0x1000 inclusive");
    expect(text).toContain("// limitations: terminal call may cut the body");
    expect(text.slice(text.indexOf("\n\n") + 2)).toBe(
      `int fn(void) { ${sentinel} }`,
    );
    const index = await readFile(
      join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
      "utf8",
    );
    const journal = await readFile(
      join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME),
      "utf8",
    );
    expect(index).not.toContain(sentinel);
    expect(journal).not.toContain(sentinel);
    expect(
      decompileDirectoryIndexSchema.safeParse(JSON.parse(index)).success,
    ).toBe(true);
    expect(
      of(calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x1000", "0x2000", "0x3000"]);
    expect(
      of(calls, "list_procedures").every((call) => call.origin === "provider"),
    ).toBe(true);
    const evidence = createWorkflowEvidence({
      target: undefined,
      operation: "decompile_all",
      parameters: { output_directory: directory() },
      result: result.value,
      upstreamProfile: profile,
      upstreamLimitations: [],
    });
    expect(evidence.evidence_id.length).toBeGreaterThan(0);
    expect(
      toolContract("decompile_all").outputSchema.safeParse(evidence).success,
    ).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(sentinel);
  });

  it("records one decompiler failure without aborting or writing that file", async () => {
    const { tools } = harness({
      fail: { "0x2000": "error", "0x3000": "timeout" },
    });
    const result = await run(tools, directory());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { written: 1, failed: 2, requested: 3 },
    });
    const failures = (
      result.value as { failures: { address: string; code: string }[] }
    ).failures;
    expect(failures.map((failure) => failure.code).sort()).toEqual(
      ["deadline", "invalid_request"].sort(),
    );
    await expect(
      readFile(join(directory(), "functions/0x2000.c")),
    ).rejects.toThrow();
    await expect(
      readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).resolves.toContain(sentinel);
  });
});

describe("decompile_all external functions", () => {
  const directory = useOutputDirectory();

  it("reports an external function as external without requesting its pseudocode", async () => {
    const { calls, tools } = harness({ external: ["0x2000"] });
    const result = await run(tools, directory());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { requested: 3, written: 2, failed: 0, external: 1 },
      failures: [],
    });
    expect(
      of(calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).not.toContain("0x2000");
    await expect(
      readFile(join(directory(), "functions/0x2000.c")),
    ).rejects.toThrow();
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(index.functions.find((entry) => entry.address === "0x2000")).toEqual(
      {
        address: "0x2000",
        name: "Foo::helper",
        status: "external",
        body: { available: true, ranges: [], non_contiguous: false },
      },
    );
  });

  it("skips a recorded external function on resume without asking the provider again", async () => {
    const { calls, tools } = harness({ external: ["0x1000", "0x2000"] });
    expect((await run(tools, directory())).ok).toBe(true);
    calls.length = 0;
    const resumed = await run(tools, directory(), { resume: true, limit: 1 });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    // A limit below the external count still finishes: nothing remains.
    expect(resumed.value).toMatchObject({
      counts: { requested: 0, skipped: 3, remaining: 0, external: 0 },
    });
    expect(of(calls, "procedure_info")).toEqual([]);
    expect(of(calls, "procedure_pseudo_code")).toEqual([]);
  });

  it("reports a conflicting file at a written function's path when a resume finds it external", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    await writeFile(join(directory(), "functions/0x2000.c"), "replaced\n");

    const resumed = await run(
      harness({ external: ["0x2000"] }).tools,
      directory(),
      { resume: true },
    );

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { requested: 1, skipped: 2, failed: 1, external: 0 },
      failures: [{ address: "0x2000", code: "output_exists" }],
    });
  });

  it("resumes an import recorded as invalid pseudocode by an earlier version as external", async () => {
    const before = harness({ fail: { "0x2000": "null" } });
    expect((await run(before.tools, directory())).ok).toBe(true);
    const journal = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    const text = await readFile(journal, "utf8");
    expect(text).toContain('"no_pseudocode"');
    // The journal an earlier version wrote for the same import.
    await writeFile(
      journal,
      text.replace(
        /"code":"no_pseudocode","message":"[^"]*"/u,
        '"code":"invalid_pseudocode","message":"The provider returned pseudocode that is not text."',
      ),
    );

    const after = harness({ external: ["0x2000"] });
    const resumed = await run(after.tools, directory(), { resume: true });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { requested: 1, skipped: 2, failed: 0, external: 1 },
      failures: [],
    });
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(
      index.functions.find((entry) => entry.address === "0x2000")?.status,
    ).toBe("external");
  });

  it.each([
    ["a failure", '"failure":{"code":"x","message":"x"},'],
    ["a file path", '"relative_path":"functions/0x2000.c",'],
    ["a checksum", `"sha256":"${"cd".repeat(32)}",`],
  ])(
    "refuses to resume a journal whose external record carries %s",
    async (_, field) => {
      const { tools } = harness({ external: ["0x2000"] });
      expect((await run(tools, directory())).ok).toBe(true);
      const journal = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
      const text = await readFile(journal, "utf8");
      await writeFile(
        journal,
        text.replace('"status":"external",', `"status":"external",${field}`),
      );

      const resumed = await run(tools, directory(), { resume: true });

      expect(resumed.ok).toBe(false);
      if (resumed.ok) return;
      expect(resumed.error).toBeInstanceOf(AnalysisInputError);
      if (resumed.error instanceof AnalysisInputError)
        expect(resumed.error.userMessage).toContain("not a compatible export");
    },
  );

  it("reports a null pseudocode result as no pseudocode, not as text of the wrong type", async () => {
    const { tools } = harness({ fail: { "0x2000": "null" } });
    const result = await run(tools, directory());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { written: 2, failed: 1, external: 0 },
      failures: [{ address: "0x2000", code: "no_pseudocode" }],
    });
  });
});

describe("decompile_all resume", () => {
  const directory = useOutputDirectory();

  it("refuses an existing directory until resume matches, then skips verified files", async () => {
    const first = harness();
    const created = await run(first.tools, directory());
    expect(created.ok).toBe(true);
    const again = harness();
    const refused = await run(again.tools, directory());
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBeInstanceOf(AnalysisInputError);
    expect(refused.error.userMessage).toContain("already exists");
    expect(of(again.calls, "list_procedures")).toHaveLength(0);

    const resumed = harness();
    const second = await run(resumed.tools, directory(), { resume: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toMatchObject({
      counts: { written: 0, skipped: 3, failed: 0, requested: 0 },
      resume: true,
    });
    expect(of(resumed.calls, "procedure_pseudo_code")).toHaveLength(0);
  });

  it("does not rewrite a conflicting file and retries a missing one", async () => {
    const { tools } = harness();
    expect((await run(tools, directory())).ok).toBe(true);
    const file = join(directory(), "functions/0x1000.c");
    await writeFile(file, "tampered");
    await rm(join(directory(), "functions/0x2000.c"));
    const next = harness();
    const resumed = await run(next.tools, directory(), { resume: true });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { written: 1, failed: 1, skipped: 1 },
    });
    expect(await readFile(file, "utf8")).toBe("tampered");
    expect(
      of(next.calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x2000"]);
    const failures = (
      resumed.value as { failures: { address: string; code: string }[] }
    ).failures;
    expect(failures).toEqual([
      expect.objectContaining({ address: "0x1000", code: "output_exists" }),
    ]);
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(
      index.functions.find((record) => record.address === "0x1000")?.body,
    ).toEqual({
      available: true,
      ranges: [{ start: "0x1000", end: "0x1000" }],
      non_contiguous: false,
    });
  });

  it("refuses resume for a different target digest or a damaged journal", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    const journalPath = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    const original = await readFile(journalPath, "utf8");
    const damaged = original.replace(targetSha, "cd".repeat(32));
    await writeFile(journalPath, damaged);
    const mismatched = await run(harness().tools, directory(), {
      resume: true,
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok)
      expect(mismatched.error.userMessage).toContain("does not match");

    await writeFile(journalPath, `${original}not-json\n`);
    const broken = await run(harness().tools, directory(), { resume: true });
    expect(broken.ok).toBe(false);
    if (!broken.ok)
      expect(broken.error.userMessage).toContain("not a compatible export");
    expect(
      await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).toContain(sentinel);
  });
});

describe("decompile_all filters and layout", () => {
  const directory = useOutputDirectory();

  it("filters by name, namespace, and address and reports the excluded count", async () => {
    const { tools } = harness();
    const result = await run(tools, directory(), {
      name: "helper",
      namespace: "Foo::",
      address_start: "0x1500",
      address_end: "0x2500",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { selected: 1, excluded: 2, written: 1 },
    });
    expect(
      await readFile(join(directory(), "functions/0x2000.c"), "utf8"),
    ).toContain("Foo::helper");
  });

  it("stops at a limit and continues in address order on resume", async () => {
    const first = harness();
    const limited = await run(first.tools, directory(), { limit: 1 });
    expect(limited.ok).toBe(true);
    if (!limited.ok) return;
    expect(limited.value).toMatchObject({
      counts: { written: 1, remaining: 2, skipped: 0 },
    });
    expect(
      of(first.calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x1000"]);

    const second = harness();
    const resumed = await run(second.tools, directory(), {
      resume: true,
      limit: 1,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { written: 1, skipped: 1, remaining: 1 },
    });
    expect(
      of(second.calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x2000"]);
  });

  it("reports dwarf layout unavailable and still uses address file names", async () => {
    const { tools } = harness();
    const result = await run(tools, directory(), { layout: "dwarf" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      layout: "dwarf",
      layout_status: "debug_layout_unavailable",
    });
    const limitations = (
      result.value as { limitations: string[] }
    ).limitations.join("\n");
    expect(limitations).toContain("unavailable");
    expect(
      await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).toContain(sentinel);
    const names = await readFile(
      join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
      "utf8",
    );
    expect(names).not.toContain("Foo/");
  });

  it("keeps a non-contiguous procedure_info body in the file header", async () => {
    const procedures = [{ address: "0x1000", name: "main" }];
    const calls: RecordedCall[] = [];
    const port: AnalysisOperationPort = {
      execute: (operation, parameters) => {
        calls.push({
          operation,
          procedure: parameters.procedure,
          origin: undefined,
        });
        if (operation === "list_procedures")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                procedures.map((procedure) => ({
                  address: procedure.address,
                  value: procedure.name,
                })),
                provider,
                { analysisProfile: profile, subject },
              ),
            ),
          );
        if (operation === "procedure_info")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                infoFor("0x1000", [
                  { start: "0x1000", end: "0x1007" },
                  { start: "0x1010", end: "0x1017" },
                ]),
                provider,
                { analysisProfile: profile },
              ),
            ),
          );
        return Promise.resolve(
          ok(
            createAnalysisExecution(
              `int main(void) { ${sentinel} }`,
              provider,
              { analysisProfile: profile },
            ),
          ),
        );
      },
    };
    const result = await new EnhancedTools(port).execute("decompile_all", {
      output_directory: directory(),
    });
    expect(result.ok).toBe(true);
    const text = await readFile(
      join(directory(), "functions/0x1000.c"),
      "utf8",
    );
    expect(text).toContain("// range: 0x1000-0x1007 inclusive");
    expect(text).toContain("// range: 0x1010-0x1017 inclusive");
    expect(text).toContain("// non_contiguous: true");
  });

  it("still writes when procedure_info is unavailable and does not ask again", async () => {
    const { calls, tools } = harness({ info: "unavailable" });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ counts: { written: 3, failed: 0 } });
    expect(
      (result.value as { limitations: string[] }).limitations.join("\n"),
    ).toContain("procedure_info");
    expect(of(calls, "procedure_info")).toHaveLength(1);
    expect(
      await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).toContain("// body: unavailable");
  });
});

describe("decompile_all partial results", () => {
  const directory = useOutputDirectory();

  it("caps inline failures and keeps the rest in the index", async () => {
    const procedures = Array.from({ length: 33 }, (_, index) => ({
      address: `0x${(index + 1).toString(16)}`,
      name: `fn${index.toString(16)}`,
    }));
    const { tools } = harness({
      procedures,
      fail: Object.fromEntries(
        procedures.map((procedure) => [procedure.address, "error" as const]),
      ),
    });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { failed: 33, written: 0 },
    });
    const shown = (result.value as { failures: unknown[] }).failures;
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(32);
    expect(result.value).toMatchObject({ failures_omitted: 33 - shown.length });
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(
      index.functions.filter((record) => record.status === "failed"),
    ).toHaveLength(33);
    expect(JSON.stringify(index)).not.toContain(sentinel);
  });

  it("leaves committed files in place when the caller cancels", async () => {
    const controller = new AbortController();
    const procedures = [
      { address: "0x1000", name: "first" },
      { address: "0x2000", name: "second" },
    ];
    const port: AnalysisOperationPort = {
      execute: (operation, parameters) => {
        if (
          operation === "procedure_pseudo_code" &&
          parameters.procedure === "0x2000"
        )
          controller.abort();
        if (operation === "list_procedures")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                procedures.map((procedure) => ({
                  address: procedure.address,
                  value: procedure.name,
                })),
                provider,
                { analysisProfile: profile, subject },
              ),
            ),
          );
        if (operation === "procedure_info")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                infoFor(String(parameters.procedure)),
                provider,
                { analysisProfile: profile },
              ),
            ),
          );
        return Promise.resolve(
          ok(
            createAnalysisExecution(
              "int cancelled(void) { return 1; }",
              provider,
              { analysisProfile: profile, limitations: [] },
            ),
          ),
        );
      },
    };
    const result = await new EnhancedTools(port).execute(
      "decompile_all",
      { output_directory: directory() },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    await expect(
      readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).resolves.toContain("int cancelled(void)");
    await expect(
      readFile(join(directory(), "functions/0x2000.c")),
    ).rejects.toThrow();
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(index.functions.map((record) => record.address)).toEqual(["0x1000"]);
    const next = harness({ procedures });
    const resumed = await run(next.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({ counts: { written: 1, skipped: 1 } });
    expect(
      of(next.calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x2000"]);
  });

  it("rejects an inverted address range before creating a directory or calling a provider", async () => {
    const { calls, tools } = harness();
    const result = await run(tools, directory(), {
      address_start: "ram:0x20",
      address_end: "ram:0x10",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.userMessage).toContain("before address start");
    expect(calls).toHaveLength(0);
    await expect(readFile(directory())).rejects.toThrow();
  });
});

describe("decompile_all caller coordinates", () => {
  const directory = useOutputDirectory();
  it("accepts uppercase caller coordinates and retains address-space identity", async () => {
    const { tools } = harness({
      info: "unavailable",
      procedures: [
        { address: "RAM%3Aoverlay:0xabcd", name: "in_range" },
        { address: "ram%3Aoverlay:0xabcd", name: "other_space" },
        { address: "RAM%3Aoverlay:0xabce", name: "past_end" },
      ],
    });
    const result = await run(tools, directory(), {
      address_start: "RAM%3aoverlay:0X00ABCD",
      address_end: "RAM%3Aoverlay:0xABCD",
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toMatchObject({
        counts: { selected: 1, excluded: 2, written: 1 },
      });
  });
});

describe("decompile_all duplicate-address labels", () => {
  const directory = useOutputDirectory();
  it("checks later labels before coalescing a selected address", async () => {
    const { tools } = harness({
      procedures: [
        { address: "0x1000", name: "Other::original" },
        { address: "0x1000", name: "Chosen::alias" },
        { address: "0x1000", name: "Chosen::alias_again" },
        { address: "0x2000", name: "Other::helper" },
      ],
    });
    const result = await run(tools, directory(), {
      name: "alias",
      namespace: "Chosen::",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { selected: 1, excluded: 1, written: 1 },
    });
    expect(
      await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).toContain("// name: Chosen::alias\n");
  });
});

describe("decompile_all portable function paths", () => {
  const directory = useOutputDirectory();
  const procedures = [
    { address: "RAM%3Aoverlay:0xabcd", name: "upper_space" },
    { address: "ram%3Aoverlay:0xabcd", name: "lower_space" },
  ];
  it("exports distinct case-sensitive address spaces using case-insensitive-unique filenames", async () => {
    const { tools } = harness({ procedures, info: "unavailable" });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { selected: 2, written: 2, failed: 0 },
    });
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    const names = index.functions.map((record) =>
      record.relative_path!.toLowerCase(),
    );
    expect(new Set(names).size).toBe(2);
    expect(index.functions.map((record) => record.address)).toEqual(
      procedures.map((row) => row.address),
    );
    const resumed = await run(tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
    if (resumed.ok)
      expect(resumed.value).toMatchObject({
        counts: { skipped: 2, written: 0, failed: 0 },
      });
  });
  it("refuses legacy journal paths that alias under portable filename rules", async () => {
    const { tools } = harness({ procedures, info: "unavailable" });
    expect((await run(tools, directory())).ok).toBe(true);
    const journalPath = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    const lines = (await readFile(journalPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    lines[2].relative_path = lines[1].relative_path.toLowerCase();
    await writeFile(
      journalPath,
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    const refused = await run(tools, directory(), { resume: true });
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.error.userMessage).toContain("compatible export");
  });
});

describe("decompile_all identity and recovery", () => {
  const directory = useOutputDirectory();

  it("records an empty target digest and refuses to resume an unknown target", async () => {
    const { tools } = harness({ subject: false });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ target_sha256: null });
    expect(
      (result.value as { limitations: string[] }).limitations.join("\n"),
    ).toContain("SHA-256");
    const other = harness({ subject: false });
    const resumed = await run(other.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(false);
    if (!resumed.ok)
      expect(resumed.error.userMessage).toContain("target SHA-256");
    expect(of(other.calls, "procedure_pseudo_code")).toHaveLength(0);
  });

  it("does not accept a decompiler observation without the export's profile or for another target", async () => {
    const { tools } = harness({
      unprofiled: "0x2000",
      foreignTarget: "0x3000",
    });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ counts: { written: 1, failed: 2 } });
    expect((result.value as { failures: unknown[] }).failures).toEqual([
      expect.objectContaining({ address: "0x2000", code: "profile_changed" }),
      expect.objectContaining({ address: "0x3000", code: "target_changed" }),
    ]);
  });

  it("refuses to resume an export whose analysis profile is unknown", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    const journalPath = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    const original = await readFile(journalPath, "utf8");
    await writeFile(
      journalPath,
      original.replace(
        `"analysis_profile_digest":"${profile.digest}"`,
        `"analysis_profile_digest":null`,
      ),
    );
    const next = harness();
    const resumed = await run(next.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(false);
    if (!resumed.ok)
      expect(resumed.error.userMessage).toContain("analysis profile digest");
    expect(of(next.calls, "procedure_pseudo_code")).toHaveLength(0);
  });

  it("refuses resume when the output directory does not exist", async () => {
    const { calls, tools } = harness();
    const result = await run(tools, directory(), { resume: true });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.userMessage).toContain("existing export directory");
    expect(calls).toHaveLength(0);
    await expect(
      readFile(join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME)),
    ).rejects.toThrow();
  });

  it("exports addressed rows and counts inventory rows without an address", async () => {
    const { tools } = harness({
      procedures: [
        { address: "", name: "ghost" },
        { address: "0x1000", name: "main" },
      ],
    });
    const result = await run(tools, directory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      counts: { selected: 1, written: 1, failed: 0 },
    });
    expect(
      (result.value as { limitations: string[] }).limitations.join("\n"),
    ).toContain("1 inventory row(s) had no address");
  });

  it("resumes after a torn final journal line and keeps the journal parseable", async () => {
    const first = harness();
    expect((await run(first.tools, directory(), { limit: 1 })).ok).toBe(true);
    const journalPath = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    await writeFile(
      journalPath,
      `${await readFile(journalPath, "utf8")}{"kind":"function","name":"é\u00e9`,
    );
    const stray = join(directory(), ".tmp-0123456789abcdef.c");
    await writeFile(stray, "not owned by this run");
    const resumed = await run(harness().tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { written: 2, skipped: 1, failed: 0 },
    });
    const text = await readFile(journalPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.trimEnd().split("\n"))
      expect(
        decompileJournalLineSchema.safeParse(JSON.parse(line)).success,
      ).toBe(true);
    // A file is not this export's just because its name looks like a temporary.
    await expect(readFile(stray, "utf8")).resolves.toBe(
      "not owned by this run",
    );
  });
});

describe("decompile_all untrusted directory and provider facts", () => {
  const directory = useOutputDirectory();

  it("refuses a journal that is a symlink and leaves its target unchanged", async () => {
    expect((await run(harness().tools, directory(), { limit: 1 })).ok).toBe(
      true,
    );
    const journalPath = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
    const outside = join(directory(), "..", "outside.jsonl");
    const torn = `${await readFile(journalPath, "utf8")}{"kind":"func`;
    await writeFile(outside, torn);
    await rm(journalPath);
    await symlink(outside, journalPath);
    const next = harness();
    const resumed = await run(next.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(false);
    expect(of(next.calls, "procedure_pseudo_code")).toHaveLength(0);
    expect(await readFile(outside, "utf8")).toBe(torn);
  });

  it("does not take body ranges from procedure_info for another entry point", async () => {
    const port: AnalysisOperationPort = {
      execute: (operation) => {
        if (operation === "list_procedures")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                [{ address: "0x1000", value: "main" }],
                provider,
                { analysisProfile: profile, subject },
              ),
            ),
          );
        if (operation === "procedure_info")
          return Promise.resolve(
            ok(
              createAnalysisExecution(infoFor("0x9000"), provider, {
                analysisProfile: profile,
              }),
            ),
          );
        return Promise.resolve(
          ok(
            createAnalysisExecution(
              `int main(void) { ${sentinel} }`,
              provider,
              {
                analysisProfile: profile,
              },
            ),
          ),
        );
      },
    };
    const result = await new EnhancedTools(port).execute("decompile_all", {
      output_directory: directory(),
    });
    expect(result.ok).toBe(true);
    const text = await readFile(
      join(directory(), "functions/0x1000.c"),
      "utf8",
    );
    expect(text).toContain("// body: unavailable");
    expect(text).not.toContain("0x9000");
  });

  it("keeps a function's file name after a failed retry that recorded no path", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    await rm(join(directory(), "functions/0x1000.c"));
    const failing = harness({ fail: { "0x1000": "timeout" } });
    expect((await run(failing.tools, directory(), { resume: true })).ok).toBe(
      true,
    );
    const retried = await run(harness().tools, directory(), { resume: true });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value).toMatchObject({ counts: { written: 1, skipped: 2 } });
    await expect(
      readFile(join(directory(), "functions/0x1000.c"), "utf8"),
    ).resolves.toContain(sentinel);
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(
      index.functions.find((record) => record.address === "0x1000")
        ?.relative_path,
    ).toBe("functions/0x1000.c");
  });

  it("tries functions not yet attempted before retrying recorded failures", async () => {
    const failing = { fail: { "0x1000": "timeout" as const } };
    expect(
      (await run(harness(failing).tools, directory(), { limit: 1 })).ok,
    ).toBe(true);
    const next = harness(failing);
    const resumed = await run(next.tools, directory(), {
      resume: true,
      limit: 1,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(
      of(next.calls, "procedure_pseudo_code").map((call) => call.procedure),
    ).toEqual(["0x2000"]);
    expect(resumed.value).toMatchObject({
      counts: { written: 1, failed: 0, remaining: 2 },
    });
  });
});

describe("decompile_all journal recovery", () => {
  const directory = useOutputDirectory();

  const indexRecord = async (address: string) =>
    decompileDirectoryIndexSchema
      .parse(
        JSON.parse(
          await readFile(
            join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
            "utf8",
          ),
        ),
      )
      .functions.find((record) => record.address === address);

  it("keeps a written file's checksum through a read error and skips it once readable", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    const file = join(directory(), "functions/0x1000.c");
    const original = await readFile(file);
    const written = await indexRecord("0x1000");
    // A directory in the file's place makes the read fail without being absent.
    await rm(file);
    await mkdir(file);
    const blocked = await run(harness().tools, directory(), { resume: true });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.value).toMatchObject({
      counts: { failed: 1, skipped: 2, written: 0 },
      failures: [
        expect.objectContaining({ address: "0x1000", code: "output_io" }),
      ],
    });
    expect((await indexRecord("0x1000"))?.status).toBe("failed");

    await rm(file, { recursive: true });
    await writeFile(file, original);
    const next = harness();
    const recovered = await run(next.tools, directory(), { resume: true });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value).toMatchObject({
      counts: { failed: 0, skipped: 3, written: 0 },
    });
    expect(of(next.calls, "procedure_pseudo_code")).toHaveLength(0);
    expect(await indexRecord("0x1000")).toEqual(written);
  });

  it("bounds per-function provider caveats in the answer and keeps each in its file", async () => {
    const procedures = Array.from({ length: 20 }, (_, index) => ({
      address: `0x${(0x1000 + index * 0x10).toString(16)}`,
      name: `fn_${index}`,
    }));
    const { port } = harness({ procedures, addressCaveats: true });
    const composed = await executeComposedWorkflow(
      port,
      (observed) =>
        new EnhancedTools(observed).execute("decompile_all", {
          output_directory: directory(),
        }),
      composedLimitationBudget("decompile_all"),
    );
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const { limitations } = composed.value;
    // The shared caveat is kept; 39 per-address caveats collapse to a count.
    expect(limitations).toHaveLength(9);
    expect(limitations).toContainEqual(
      expect.stringContaining("terminal call may cut the body"),
    );
    expect(limitations.at(-1)).toBe(
      "33 per-item provider limitation observations were omitted from this answer; each function's record in decompile-index.json keeps the caveats of the observations it used.",
    );
    const last = await readFile(
      join(directory(), "functions/0x1130.c"),
      "utf8",
    );
    expect(last).toContain("info caveat at 0x1130");
    expect(last).toContain("terminal call at 0x1130");
  });

  it("keeps the caveats each attempt used in its index record", async () => {
    const { tools } = harness({
      addressCaveats: true,
      fail: { "0x1000": "timeout", "0x2000": "empty" },
    });
    expect((await run(tools, directory())).ok).toBe(true);
    expect((await indexRecord("0x1000"))?.limitations).toEqual([
      "info caveat at 0x1000",
    ]);
    // The fixture's empty pseudocode observation reports no caveats.
    expect((await indexRecord("0x2000"))?.limitations).toEqual([
      "info caveat at 0x2000",
    ]);
    expect((await indexRecord("0x3000"))?.limitations).toEqual([
      "info caveat at 0x3000",
      "terminal call may cut the body",
      "terminal call at 0x3000",
    ]);
  });

  it("keeps caveats beyond the header's length cap in the index", async () => {
    const caveats = Array.from(
      { length: 40 },
      (_, index) =>
        `terminal call at 0x${(0x1000 + index).toString(16)} ${"x".repeat(150)}`,
    );
    const port: AnalysisOperationPort = {
      execute: (operation) =>
        Promise.resolve(
          ok(
            operation === "list_procedures"
              ? createAnalysisExecution(
                  [{ address: "0x1000", value: "large" }],
                  provider,
                  { analysisProfile: profile, subject },
                )
              : operation === "procedure_info"
                ? createAnalysisExecution(infoFor("0x1000"), provider, {
                    analysisProfile: profile,
                  })
                : createAnalysisExecution(
                    `int large(void) { ${sentinel} }`,
                    provider,
                    {
                      analysisProfile: profile,
                      limitations: caveats,
                    },
                  ),
          ),
        ),
    };
    const result = await new EnhancedTools(port).execute("decompile_all", {
      output_directory: directory(),
    });
    expect(result.ok).toBe(true);
    const header = await readFile(
      join(directory(), "functions/0x1000.c"),
      "utf8",
    );
    expect(header).toContain("// limitations_truncated: true");
    expect(header).not.toContain(caveats.at(-1));
    expect((await indexRecord("0x1000"))?.limitations).toEqual(caveats);
  });
});

describe("decompile_all late cancellation", () => {
  const directory = useOutputDirectory();
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports cancellation when the caller aborts while the index is written", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const writeIndex = DecompileExport.prototype.writeIndex;
    vi.spyOn(DecompileExport.prototype, "writeIndex").mockImplementation(
      function (this: DecompileExport, input) {
        controller.abort(reason);
        return writeIndex.call(this, input);
      },
    );
    const result = await run(
      harness().tools,
      directory(),
      {},
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    // Finalization still completed, so the export resumes without new work.
    vi.restoreAllMocks();
    const next = harness();
    const resumed = await run(next.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
    expect(of(next.calls, "procedure_pseudo_code")).toHaveLength(0);
  });

  it("keeps an index failure primary when the caller also aborts", async () => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError("decompile_all", "index failed");
    vi.spyOn(DecompileExport.prototype, "writeIndex").mockImplementation(() => {
      controller.abort(new Error("caller stopped"));
      return Promise.resolve(err(failure));
    });
    const result = await run(
      harness().tools,
      directory(),
      {},
      controller.signal,
    );
    expect(result).toEqual(err(failure));
  });
});

describe("decompile_all cancelled publish loop", () => {
  const directory = useOutputDirectory();
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stopReason = new Error("caller stopped");

  /** A port that aborts the caller's signal once the first function is decompiled. */
  const abortAfterFirst = (controller: AbortController) => {
    const { port } = harness();
    const stopping: AnalysisOperationPort = {
      execute: async (operation, parameters, execution) => {
        const result = await port.execute(operation, parameters, execution);
        if (operation === "procedure_pseudo_code") controller.abort(stopReason);
        return result;
      },
    };
    return new EnhancedTools(stopping);
  };

  it("keeps an index failure primary when cancellation stops the publish loop", async () => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError("decompile_all", "index failed");
    vi.spyOn(DecompileExport.prototype, "writeIndex").mockResolvedValue(
      err(failure),
    );
    const result = await run(
      abortAfterFirst(controller),
      directory(),
      {},
      controller.signal,
    );
    expect(result).toEqual(err(failure));
  });

  it("keeps a journal close failure primary when cancellation stops the publish loop", async () => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError("decompile_all", "close failed");
    const close = DecompileExport.prototype.close;
    vi.spyOn(DecompileExport.prototype, "close").mockImplementation(
      async function (this: DecompileExport) {
        await close.call(this);
        return err(failure);
      },
    );
    const result = await run(
      abortAfterFirst(controller),
      directory(),
      {},
      controller.signal,
    );
    expect(result).toEqual(err(failure));
  });

  it("reports the caller's reason when cancellation stops the publish loop and finalization succeeds", async () => {
    const controller = new AbortController();
    const result = await run(
      abortAfterFirst(controller),
      directory(),
      {},
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(stopReason);
  });

  it("reports the caller's reason when procedure_info returns its own cancellation as the caller aborts", async () => {
    const controller = new AbortController();
    const { port } = harness();
    const cancelling: AnalysisOperationPort = {
      execute: (operation, parameters, execution) => {
        if (operation !== "procedure_info")
          return port.execute(operation, parameters, execution);
        controller.abort(stopReason);
        return Promise.resolve(
          err(
            new AnalysisCancelledError("procedure_info", {
              cause: new Error("provider session stopped"),
            }),
          ),
        );
      },
    };
    const result = await run(
      new EnhancedTools(cancelling),
      directory(),
      {},
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(stopReason);
  });

  it("keeps a provider's own cancellation primary when the caller did not abort", async () => {
    const { port } = harness();
    const providerCancelled = new AnalysisCancelledError(
      "procedure_pseudo_code",
      { cause: new Error("provider session stopped") },
    );
    const cancelling: AnalysisOperationPort = {
      execute: (operation, parameters, execution) =>
        operation === "procedure_pseudo_code"
          ? Promise.resolve(err(providerCancelled))
          : port.execute(operation, parameters, execution),
    };
    vi.spyOn(DecompileExport.prototype, "writeIndex").mockResolvedValue(
      err(new AnalysisOutputError("decompile_all", "index failed")),
    );
    const result = await run(
      new EnhancedTools(cancelling),
      directory(),
      {},
      new AbortController().signal,
    );
    expect(result).toEqual(err(providerCancelled));
  });
});

describe("decompile_all output directory lease", () => {
  const directory = useOutputDirectory();

  /** A port that holds the first decompile until the test lets it finish. */
  const heldAtFirstDecompile = () => {
    const { port } = harness();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = (): void => undefined;
    const reachedFirst = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let held = false;
    const holding: AnalysisOperationPort = {
      execute: async (operation, parameters, execution) => {
        if (operation === "procedure_pseudo_code" && !held) {
          held = true;
          reached();
          await released;
        }
        return port.execute(operation, parameters, execution);
      },
    };
    return { tools: new EnhancedTools(holding), reachedFirst, release };
  };

  it("refuses a second run on a directory another run is exporting, then resumes after it", async () => {
    const first = heldAtFirstDecompile();
    const exporting = run(first.tools, directory());
    await first.reachedFirst;

    const competing = harness();
    const refused = await run(competing.tools, directory(), { resume: true });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // Busy is retryable once the holder finishes, unlike invalid input.
    expect(refused.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(refused.error).toMatchObject({
      resource: "capacity",
      retryable: true,
      reportedLimits: { holder_process_id: process.pid },
    });
    // The refused run neither decompiled nor appended to the journal.
    expect(of(competing.calls, "procedure_pseudo_code")).toHaveLength(0);

    first.release();
    const exported = await exporting;
    expect(exported.ok).toBe(true);
    const journal = (
      await readFile(
        join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME),
        "utf8",
      )
    )
      .trimEnd()
      .split("\n");
    expect(journal).toHaveLength(4);

    // The lease ends with the run, and the next run sees every record.
    const next = harness();
    const resumed = await run(next.tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({ counts: { skipped: 3, written: 0 } });
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(index.functions.map((record) => record.status)).toEqual([
      "written",
      "written",
      "written",
    ]);
  });

  it("releases the lease when a resume is refused before any work", async () => {
    expect((await run(harness().tools, directory())).ok).toBe(true);
    const foreign = harness({ subject: false });
    const refused = await run(foreign.tools, directory(), { resume: true });
    expect(refused.ok).toBe(false);
    const resumed = await run(harness().tools, directory(), { resume: true });
    expect(resumed.ok).toBe(true);
  });
});

describe("decompile_all repeated output failures", () => {
  const directory = useOutputDirectory();

  const procedures = Array.from({ length: 8 }, (_, index) => ({
    address: `0x${(0x1000 + index * 0x10).toString(16)}`,
    name: `${"long-name".repeat(400)}_${index.toString()}`,
  }));

  /** Put a directory where each listed function's file was, so reading it fails. */
  const blockFiles = async (addresses: readonly string[]) => {
    for (const address of addresses) {
      const file = join(directory(), `functions/${address}.c`);
      await rm(file);
      await mkdir(file);
    }
  };

  it("stops after five consecutive output_io failures and keeps what it recorded", async () => {
    expect((await run(harness({ procedures }).tools, directory())).ok).toBe(
      true,
    );
    await blockFiles(procedures.slice(0, 7).map(({ address }) => address));
    const next = harness({ procedures });
    const stopped = await run(next.tools, directory(), { resume: true });
    expect(stopped.ok).toBe(false);
    if (stopped.ok) return;
    expect(stopped.error).toBeInstanceOf(AnalysisOutputError);
    expect(stopped.error.userMessage).toContain(
      "Stopped after 5 function files in a row could not be written or read",
    );
    expect(stopped.error.diagnostics).toMatchObject({
      attempted: 5,
      failed: 5,
      consecutive_output_io: 5,
    });
    expect(
      Buffer.byteLength(JSON.stringify(stopped.error.diagnostics)),
    ).toBeLessThan(4_096);
    // The index was still written and records the five failures; the sixth
    // and seventh blocked functions were not attempted.
    const index = decompileDirectoryIndexSchema.parse(
      JSON.parse(
        await readFile(
          join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
          "utf8",
        ),
      ),
    );
    expect(
      index.functions
        .filter((record) => record.failure?.code === "output_io")
        .map((record) => record.address),
    ).toEqual(procedures.slice(0, 5).map(({ address }) => address));
    expect(
      index.functions.find(
        (record) => record.address === procedures[5]?.address,
      )?.status,
    ).toBe("written");
  });

  it("does not stop when a verified file interrupts the failures", async () => {
    expect((await run(harness({ procedures }).tools, directory())).ok).toBe(
      true,
    );
    // Four failures, one verified file, then three more failures.
    await blockFiles(
      [0, 1, 2, 3, 5, 6, 7].map((index) => procedures[index]?.address ?? ""),
    );
    const resumed = await run(harness({ procedures }).tools, directory(), {
      resume: true,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value).toMatchObject({
      counts: { failed: 7, skipped: 1, remaining: 0 },
    });
  });
});

describe("decompile_all provider cleanup ownership", () => {
  const directory = useOutputDirectory();
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["procedure_info", false],
    ["procedure_info", true],
    ["procedure_pseudo_code", false],
    ["procedure_pseudo_code", true],
  ] as const)(
    "retains %s cleanup and committed work with caller aborted=%s",
    async (operation, abort) => {
      const { port } = harness();
      const controller = new AbortController();
      const cause = new Error("provider cleanup stopped");
      const callerReason = new Error("caller stopped");
      const partial = createEvidence(subject, provider, {
        operation,
        parameters: { procedure: "0x2000" },
        result:
          operation === "procedure_info"
            ? infoFor("0x2000")
            : "int partial(void) {}",
        analysisProfile: profile,
        confidence: "observed",
      });
      const failure = new AnalysisCancelledError(operation, {
        cause,
        partialObservation: partial,
        capturedOutput: {
          stdout: "retained provider output",
          stderr: "",
          truncated: false,
        },
        cleanup: {
          reason: "descriptor close denied",
          resources: ["provider descriptor"],
        },
      });
      const lease = new AnalysisCleanupLease(
        async () => undefined,
        ["provider descriptor"],
      );
      lease.bindCleanupError(failure);
      const observed: AnalysisOperation[] = [];
      const failing: AnalysisOperationPort = {
        execute: (selected, parameters, options) => {
          observed.push(selected);
          if (selected === operation && parameters.procedure === "0x2000") {
            if (abort) controller.abort(callerReason);
            return Promise.resolve(err(failure));
          }
          return port.execute(selected, parameters, options);
        },
      };
      const result = await run(
        new EnhancedTools(failing),
        directory(),
        {},
        controller.signal,
      );
      expect(result).toEqual(err(failure));
      expect(failure.cause).toBe(cause);
      if (abort) {
        expect(failure.secondaryFailures).toHaveLength(1);
        expect(failure.secondaryFailures[0]).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(failure.secondaryFailures[0]?.cause).toBe(callerReason);
      } else expect(failure.secondaryFailures).toHaveLength(0);
      expect(failure.partialObservation).toBe(partial);
      expect(failure.capturedOutput?.stdout).toBe("retained provider output");
      expect(failure.cleanupIncomplete).toBe(true);
      expect(observed.at(-1)).toBe(operation);
      const index = decompileDirectoryIndexSchema.parse(
        JSON.parse(
          await readFile(
            join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
            "utf8",
          ),
        ),
      );
      expect(index.functions).toHaveLength(1);
      expect(index.functions[0]).toMatchObject({
        address: "0x1000",
        status: "written",
      });
      await expect(
        readFile(join(directory(), "functions", "0x1000.c"), "utf8"),
      ).resolves.toContain(sentinel);
      await lease.release();
      expect(failure.cleanupIncomplete).toBe(false);
    },
  );
});

describe("decompile_all mixed cleanup ownership", () => {
  const directory = useOutputDirectory();
  afterEach(() => vi.restoreAllMocks());

  it("waits for both provider and journal cleanup owners after mixed finalization failures", async () => {
    const { port } = harness();
    const providerFailure = new AnalysisOutputError(
      "procedure_info",
      "provider cleanup failed",
      {
        cleanup: {
          reason: "provider close denied",
          resources: ["provider descriptor"],
        },
      },
    );
    const closeFailure = new AnalysisOutputError(
      "decompile_all",
      "journal cleanup failed",
      {
        cleanup: {
          reason: "journal close denied",
          resources: ["journal descriptor"],
        },
      },
    );
    const providerLease = new AnalysisCleanupLease(
      async () => undefined,
      ["provider descriptor"],
    );
    const journalLease = new AnalysisCleanupLease(
      async () => undefined,
      ["journal descriptor"],
    );
    providerLease.bindCleanupError(providerFailure);
    journalLease.bindCleanupError(closeFailure);
    const close = DecompileExport.prototype.close;
    vi.spyOn(DecompileExport.prototype, "close").mockImplementation(
      async function (this: DecompileExport) {
        await close.call(this);
        return err(closeFailure);
      },
    );
    const failing: AnalysisOperationPort = {
      execute: (operation, parameters, options) =>
        operation === "procedure_info"
          ? Promise.resolve(err(providerFailure))
          : port.execute(operation, parameters, options),
    };
    const result = await run(new EnhancedTools(failing), directory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cleanupPrimary).toBe(providerFailure);
    expect(result.error.cleanupResources).toEqual(
      expect.arrayContaining(["provider descriptor", "journal descriptor"]),
    );
    await journalLease.release();
    expect(closeFailure.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(true);
    await providerLease.release();
    expect(result.error.cleanupIncomplete).toBe(false);
  });
});

describe("decompile_all publication cleanup", () => {
  const directory = useOutputDirectory();
  afterEach(() => vi.restoreAllMocks());

  it.each(["function", "index"])(
    "retains a %s publication cleanup failure after final cleanup succeeds",
    async (publication) => {
      const cleanupFailure = new Error("staging removal denied");
      const originalPublish = ExportResources.prototype.publish;
      const originalClose = OwnedStagedOutput.prototype.close;
      const destination = join(
        directory(),
        publication === "function"
          ? "functions/0x1000.c"
          : DECOMPILE_DIRECTORY_INDEX_NAME,
      );
      let selected = false;
      let failed = false;
      vi.spyOn(ExportResources.prototype, "publish").mockImplementation(
        async function (this: ExportResources, bytes, path, mode) {
          selected = path === destination;
          return originalPublish.call(this, bytes, path, mode);
        },
      );
      vi.spyOn(OwnedStagedOutput.prototype, "close").mockImplementation(
        async function (this: OwnedStagedOutput) {
          if (selected && !failed) {
            failed = true;
            throw cleanupFailure;
          }
          return originalClose.call(this);
        },
      );
      const { tools } = harness();
      const result = await run(tools, directory());
      expect(failed).toBe(true);
      expect(
        await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
      ).toContain(sentinel);
      if (publication === "index")
        expect(
          JSON.parse(
            await readFile(
              join(directory(), DECOMPILE_DIRECTORY_INDEX_NAME),
              "utf8",
            ),
          ),
        ).toMatchObject({ functions: expect.any(Array) });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(AnalysisOutputError);
      expect(result.error.message).toContain(
        `decompile ${publication} publication cleanup failed`,
      );
      expect(result.error.cause).toMatchObject({
        message: "staging removal denied",
      });
      expect(result.error.cleanupIncomplete).toBe(false);
    },
  );
});

describe("decompile_all resumed file cleanup", () => {
  const directory = useOutputDirectory();
  afterEach(() => vi.restoreAllMocks());
  it.each(["journaled", "unjournaled"])(
    "reports a %s file verification close failure after final cleanup succeeds",
    async (kind) => {
      const { tools } = harness();
      expect((await run(tools, directory())).ok).toBe(true);
      if (kind === "unjournaled") {
        const journal = join(directory(), DECOMPILE_DIRECTORY_JOURNAL_NAME);
        const header = (await readFile(journal, "utf8")).split("\n")[0];
        await writeFile(journal, `${header}\n`);
      }
      const identity = await stat(join(directory(), "functions/0x1000.c"));
      const close = OwnedFileHandle.prototype.close;
      let failed = false;
      vi.spyOn(OwnedFileHandle.prototype, "close").mockImplementation(
        async function (this: OwnedFileHandle) {
          const observed = await this.handle.stat();
          if (
            !failed &&
            observed.dev === identity.dev &&
            observed.ino === identity.ino
          ) {
            failed = true;
            throw new Error("verification close denied");
          }
          return close.call(this);
        },
      );
      const result = await run(tools, directory(), { resume: true });
      expect(failed).toBe(true);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("verification cleanup failed");
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(
        await readFile(join(directory(), "functions/0x1000.c"), "utf8"),
      ).toContain(sentinel);
      const resumed = await run(tools, directory(), { resume: true });
      expect(resumed.ok).toBe(true);
      if (resumed.ok)
        expect(resumed.value).toMatchObject({ counts: { skipped: 3 } });
    },
  );
});
