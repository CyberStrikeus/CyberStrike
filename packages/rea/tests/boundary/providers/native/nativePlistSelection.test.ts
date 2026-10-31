import {
  chmod,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  resolveNativePlistSelection,
  nativePlistFailure,
} from "../../../../src/native/NativePlistSource.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it("resolves selected paths and defaults without conflating intent and file readiness", async () => {
  const root = await createTestTempDirectory("rea-plist-origin-");
  const program = join(root, "program");
  await writeFile(program, "fixture program");
  const target = nativeMachoTarget(program);
  const chosen = join(root, "chosen.plist");
  expect(await resolveNativePlistSelection(target, chosen)).toEqual({
    ok: true,
    value: { path: chosen, origin: "selected" },
  });
  expect(await resolveNativePlistSelection(target, "chosen.plist")).toEqual({
    ok: true,
    value: { path: chosen, origin: "selected" },
  });
  expect(await resolveNativePlistSelection(target, undefined)).toEqual({
    ok: true,
    value: { path: join(root, "Contents/Info.plist"), origin: "default" },
  });
  const recorded = join(root, "Info.plist");
  expect(
    await resolveNativePlistSelection(
      { ...target, bundleInfoPlist: recorded },
      undefined,
    ),
  ).toEqual({ ok: true, value: { path: recorded, origin: "default" } });
  const plistTarget = {
    kind: "artifact",
    format: "plist",
    path: chosen,
    sha256: "0".repeat(64),
  } as const;
  expect(await resolveNativePlistSelection(plistTarget, undefined)).toEqual({
    ok: true,
    value: { path: chosen, origin: "selected" },
  });
});

it.skipIf(process.platform === "win32")(
  "preserves selected plist symlink-parent semantics for absolute and app-relative input",
  async () => {
    const root = await createTestTempDirectory("rea-plist-physical-selection-");
    const selected = join(root, "physical");
    await mkdir(join(selected, "child"), { recursive: true });
    await writeFile(join(root, "program"), "inert executable");
    await writeFile(join(root, "Info.plist"), "lexical decoy");
    await writeFile(join(selected, "Info.plist"), "physical selected plist");
    await symlink(join(selected, "child"), join(root, "alias"));
    const target = nativeMachoTarget(join(root, "program"));
    for (const requested of [
      "alias/../Info.plist",
      `${root}/alias/../Info.plist`,
      join(selected, "Info.plist"),
    ]) {
      const selection = await resolveNativePlistSelection(target, requested);
      if (!selection.ok) throw selection.error;
      expect(await realpath(selection.value.path)).toBe(
        await realpath(join(selected, "Info.plist")),
      );
      expect(await readFile(selection.value.path, "utf8")).toBe(
        "physical selected plist",
      );
    }
  },
);

it.each(["missing", "directory"] as const)(
  "retains selected target intent for a %s plist",
  async (kind) => {
    const root = await createTestTempDirectory("rea-plist-origin-file-");
    const path = join(root, "chosen.plist");
    if (kind === "directory") await mkdir(path);
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
    ).createClient({
      kind: "artifact",
      format: "plist",
      path,
      sha256: "0".repeat(64),
    });
    onTestFinished(async () => {
      await client.close();
    });
    const result = await client.execute("inspect_plist", {});
    if (result.ok) throw new Error("Expected selected file refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["path"],
            message: expect.stringContaining(
              kind === "missing"
                ? "no file exists there"
                : "not a regular file",
            ),
          },
        ],
      },
    });
  },
);

it.skipIf(process.platform === "win32")(
  "reports selected and default plist path-resolution failures as selection failures",
  async () => {
    const root = await createTestTempDirectory("rea-plist-origin-resolve-");
    const loop = join(root, "Loop.plist");
    await symlink("Loop.plist", loop);
    const long = join(root, `${"x".repeat(300)}.plist`);
    const program = join(root, "program");
    await writeFile(program, "fixture program");
    await mkdir(join(root, "Contents"));
    await symlink("Info.plist", join(root, "Contents/Info.plist"));
    const failure = async (
      target: Parameters<NativeMacOSProvider["createClient"]>[0],
    ) => {
      const client = new NativeMacOSProvider(
        {},
        new NativeFixtureRunner(),
        "darwin",
      ).createClient(target);
      onTestFinished(async () => {
        await client.close();
      });
      const result = await client.execute("inspect_plist", {});
      if (result.ok) throw new Error("Expected plist refusal");
      return projectAnalysisError(result.error);
    };
    for (const [path, code] of [
      [loop, "ELOOP"],
      [long, "ENAMETOOLONG"],
    ] as const)
      expect(
        await failure({
          kind: "artifact",
          format: "plist",
          path,
          sha256: "0".repeat(64),
        }),
      ).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              message: expect.stringContaining(`(${code})`),
            },
          ],
        },
      });
    const fallback = await failure(nativeMachoTarget(program));
    expect(fallback).toMatchObject({ code: "capability_unavailable" });
    expect(fallback.message).toContain("no readable default plist");
    expect(fallback.message).toContain("(ELOOP)");
  },
);

it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "keeps permission failure distinct from selection and format",
  async () => {
    const root = await createTestTempDirectory("rea-plist-origin-denied-");
    const path = join(root, "chosen.plist");
    await writeFile(path, "<plist><dict/></plist>");
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
    ).createClient({
      kind: "artifact",
      format: "plist",
      path,
      sha256: "0".repeat(64),
    });
    onTestFinished(async () => {
      await chmod(path, 0o600);
      await client.close();
    });
    await chmod(path, 0);
    const result = await client.execute("inspect_plist", {});
    if (result.ok) throw new Error("Expected access denial");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "access_denied",
      details: { path },
    });
  },
);

it("does not invent selection facts for unresolved scope failures", () => {
  const cause = Object.assign(new Error("scope failure"), { code: "ENOENT" });
  const error = nativePlistFailure(cause, undefined);
  expect(error.cause).toBe(cause);
  expect(error.diagnostics).toEqual({
    phase: "plist-scope",
    reason: "scope failure",
  });
  expect(projectAnalysisError(error).code).not.toBe("invalid_request");
  expect(projectAnalysisError(error).code).not.toBe("capability_unavailable");
});

it("refuses closed client admission before resolving a target or launching tools", async () => {
  const root = await createTestTempDirectory("rea-plist-origin-closed-");
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(nativeMachoTarget(join(root, "missing-program")));
  expect((await client.close()).ok).toBe(true);
  const result = await client.execute("inspect_plist", {});
  if (result.ok) throw new Error("Expected closed scope");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "capability_unavailable",
    details: { reason: "Native provider client is closed" },
  });
});
