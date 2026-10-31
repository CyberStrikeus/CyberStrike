import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it as test, vi } from "vitest";
import {
  KunaProjectCache,
  KunaPublishedProjectCleanupError,
} from "../../../../src/kuna/KunaProjectCache.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { inspectKunaInstallationOwned } from "./kunaResourceScope.js";
import { exportsOf, run, session } from "./kunaSessionFixture.js";
import {
  fakeKunaCalls,
  writeFakeKuna,
  type FakeKunaBehavior,
} from "./fakeKuna.js";

const fault = vi.hoisted(() => ({ root: "", blocked: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const refused = (path: unknown) =>
    fault.blocked &&
    fault.root !== "" &&
    String(path).startsWith(fault.root) &&
    /[/\\](?:staging|trash)[/\\]build-/u.test(String(path));
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (refused(args[0]) && /[/\\]trash[/\\]build-/u.test(String(args[1])))
        throw Object.assign(
          new Error("controlled staging retirement refusal"),
          { code: "EACCES" },
        );
      return actual.rename(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (refused(args[0]))
        throw Object.assign(new Error("controlled staging removal refusal"), {
          code: "EACCES",
        });
      return actual.rm(...args);
    },
  };
});
afterEach(() => {
  fault.blocked = false;
  fault.root = "";
});
const it = test.skipIf(process.platform === "win32");

const fixture = async (behavior: FakeKunaBehavior = {}) => {
  const root = await createTestTempDirectory("rea-kuna-published-cleanup-");
  const kuna = await writeFakeKuna(root, behavior);
  const cacheRoot = join(root, "cache");
  const installed = await inspectKunaInstallationOwned({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: cacheRoot,
  });
  if (!installed.ok) throw new Error(installed.error.reason);
  const targetPath = join(root, "program");
  await writeFile(targetPath, "program bytes");
  const cache = new KunaProjectCache(cacheRoot, { maxBytes: 64 * 1024 ** 2 });
  fault.root = cacheRoot;
  fault.blocked = true;
  return {
    kuna,
    cache,
    cacheRoot,
    request: {
      installation: installed.value,
      targetPath,
      targetSha256: createHash("sha256").update("program bytes").digest("hex"),
    },
  };
};

it("retains the completed publication receipt while retrying only stopped staging cleanup", async () => {
  const { cache, request, kuna } = await fixture();
  try {
    const built = await cache.build(request);
    if (built.ok) throw new Error("Expected retained staging cleanup failure");
    expect(built.error).toBeInstanceOf(KunaPublishedProjectCleanupError);
    if (!(built.error instanceof KunaPublishedProjectCleanupError))
      throw built.error;
    const error = built.error;
    expect(error.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(error).details).toMatchObject({
      diagnostics: {
        published_export: {
          kind: "project-export",
          key: error.project.key,
          directory: error.project.directory,
          manifest: error.project.manifest,
        },
      },
    });
    expect(
      await readFile(
        join(error.project.directory, error.project.manifest.files.asm.path),
        "utf8",
      ),
    ).toContain("RET");
    const firstClose = await cache.close();
    expect(firstClose.ok).toBe(false);
    expect(error.cleanupIncomplete).toBe(true);
    fault.blocked = false;
    expect(await cache.close()).toEqual({ ok: true, value: null });
    expect(error.cleanupIncomplete).toBe(false);
    if (!firstClose.ok) expect(firstClose.error.cleanupIncomplete).toBe(false);
    expect(
      (await fakeKunaCalls(kuna)).filter(
        ({ argv }) => argv[0] === "decompile-project",
      ),
    ).toHaveLength(1);
    expect(await cache.lookup(error.project.key)).toBeDefined();
  } finally {
    fault.blocked = false;
    await cache.close();
  }
});

it("reuses the published export in the same session without hiding pending cleanup", async () => {
  const { cacheRoot, kuna, open } = await session(
    "rea-kuna-session-published-cleanup-",
  );
  const client = open();
  fault.root = cacheRoot;
  fault.blocked = true;
  try {
    const first = await client.execute(
      "procedure_assembly",
      { procedure: "main" },
      {},
    );
    if (!first.ok) {
      expect(first.error.cleanupIncomplete).toBe(true);
      expect(first.error.diagnostics).toMatchObject({
        published_export: { kind: "project-export" },
      });
    } else
      expect(first.value.rawResult).toMatchObject({
        source: { kind: "project-export" },
        project_export: { state: "ready", cleanup_incomplete: true },
      });
    const repeated = await run(client, "procedure_assembly", {
      procedure: "main",
    });
    expect(repeated.rawResult).toMatchObject({
      source: { kind: "project-export" },
      project_export: { state: "ready", cleanup_incomplete: true },
    });
    expect(await exportsOf(kuna)).toHaveLength(1);
    expect((await client.close()).ok).toBe(false);
    fault.blocked = false;
    expect(await client.close()).toEqual({ ok: true, value: null });
    if (!first.ok) expect(first.error.cleanupIncomplete).toBe(false);
  } finally {
    fault.blocked = false;
    await client.close();
  }
});

it("preserves the original failed export when staging cleanup also fails", async () => {
  const { cache, request } = await fixture({ project: "exit-failure" });
  try {
    const built = await cache.build(request);
    if (built.ok) throw new Error("Expected export and cleanup failure");
    expect(built.error).not.toBeInstanceOf(KunaPublishedProjectCleanupError);
    expect(built.error.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(built.error)).toMatchObject({
      message: expect.stringContaining("not in recognized object file format"),
    });
    expect(JSON.stringify(built.error.diagnostics)).not.toContain(
      "published_export",
    );
    fault.blocked = false;
    expect(await cache.close()).toEqual({ ok: true, value: null });
    expect(built.error.cleanupIncomplete).toBe(false);
  } finally {
    fault.blocked = false;
    await cache.close();
  }
});
