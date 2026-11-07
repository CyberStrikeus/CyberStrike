import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

import {
  HopperApplicationLauncher,
  type HopperApplicationLauncherOptions,
} from "../../../../src/hopper/BridgeLauncher.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import {
  HopperStartError,
  type HopperLaunchRejection,
} from "../../../../src/domain/hopperErrors.js";
import { execFileOutput } from "../../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const handoff = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock(
  "../../../../src/process/ProviderProcess.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/process/ProviderProcess.js")
    >()),
    spawnOwnedProviderProcess: handoff.spawn,
  }),
);
const reachedHandoff = new Error(
  "Test stopped at the vendor handoff; no application executed",
);
beforeEach(() => {
  handoff.spawn.mockReset();
  handoff.spawn.mockRejectedValue(reachedHandoff);
});

type NativeOptions = Extract<
  HopperApplicationLauncherOptions,
  { launchMode: "native" }
>;
const fixture = async (
  overrides: Partial<NativeOptions> = {},
  runtimeName = "runtime",
) => {
  const root = await createTestTempDirectory("rea-hopper-mac-arguments-");
  const directory = join(root, runtimeName);
  await mkdir(directory);
  let releases = 0;
  const verify = vi.fn(async () => "verified" as const);
  const launcher = new HopperApplicationLauncher(
    {
      environment: {},
      launcherPath: "/vendor/hopper",
      targetPath: "/selected/target.hop",
      targetKind: "database",
      loaderArgs: [],
      bridgeScriptPath: "/rea/hopper_bridge.py",
      launchMode: "native",
      ...overrides,
    },
    {
      platform: "darwin",
      verifyNativeHelper: verify,
      acquireTargetLease: async () => ({
        acquired: true,
        lease: {
          release: async () => {
            releases++;
          },
        },
      }),
    },
  );
  const session = {
    directory,
    socketPath: join(directory, "bridge.sock"),
    token: "test-token",
    runId: "literal-arguments",
  };
  return { launcher, session, verify, releases: () => releases };
};

const macTest = it.skipIf(process.platform === "win32");
macTest.each([
  ["target", 4],
  ["launcher", null],
  ["runtime", 2],
  ["loader", 1],
] as const)(
  "rejects unrepresentable %s values before handoff and releases its bootstrap and lease",
  async (source, argumentIndex) => {
    const expected: HopperLaunchRejection = {
      boundary: "argument_encoding",
      reason: "applescript_literal",
      ...(argumentIndex === null
        ? { source: "launcher_path" as const }
        : { source: "argument" as const, argument_index: argumentIndex }),
    };
    for (const character of ['"', "\\", "\r", "\n"]) {
      const selected = `literal${character}value`;
      const options: Partial<NativeOptions> =
        source === "target"
          ? { targetPath: `/selected/${selected}.hop` }
          : source === "launcher"
            ? { launcherPath: `/vendor/${selected}/hopper` }
            : source === "loader"
              ? { loaderArgs: ["-s", selected] }
              : {};
      const input = await fixture(
        options,
        source === "runtime" ? selected : "runtime",
      );
      const result = await input.launcher.launch(input.session);
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "HopperStartError",
          launchRejection: expected,
        },
      });
      if (result.ok) throw new Error("Expected literal admission failure");
      if (!(result.error instanceof HopperStartError)) throw result.error;
      expect(result.error.launchRejection).toEqual(expected);
      expect(
        projectAnalysisError(result.error).details?.launch_rejection,
      ).toEqual(expected);
      expect(handoff.spawn).not.toHaveBeenCalled();
      expect(input.verify).not.toHaveBeenCalled();
      expect(input.releases()).toBe(1);
      await expect(
        access(join(input.session.directory, "bootstrap.py")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await input.launcher.cleanup()).toEqual({
        ok: true,
        value: null,
      });
      handoff.spawn.mockClear();
    }
  },
);

macTest(
  "keeps representable spaces, apostrophes and punctuation literal",
  async () => {
    const targetPath = "/selected/space and 'apostrophe';$value.hop";
    const loaderArgs = ["-s", "selected 'loader';$value"];
    const input = await fixture({ targetPath, loaderArgs });
    const result = await input.launcher.launch(input.session);
    expect(result).toMatchObject({
      ok: false,
      error: { cause: reachedHandoff },
    });
    expect(handoff.spawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        command: "/vendor/hopper",
        arguments: [
          ...loaderArgs,
          "--analysis",
          "-Y",
          join(input.session.directory, "bootstrap.py"),
          "--database",
          targetPath,
        ],
      }),
    );
    expect(input.releases()).toBe(1);
    expect(await input.launcher.cleanup()).toEqual({ ok: true, value: null });
  },
);

macTest(
  "admits a quoted original executable name when its prepared launch path is literal",
  async () => {
    const root = await createTestTempDirectory("rea-hopper-quoted-source-");
    const targetPath = join(root, 'original"name');
    const bytes = Buffer.from("inert prepared-image copy fixture");
    await writeFile(targetPath, bytes);
    const input = await fixture({
      targetPath,
      targetKind: "executable",
      targetSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const result = await input.launcher.launch(input.session);
    expect(result).toMatchObject({
      ok: false,
      error: { cause: reachedHandoff },
    });
    expect(handoff.spawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        arguments: [
          "--analysis",
          "-Y",
          join(input.session.directory, "bootstrap.py"),
          "--executable",
          join(input.session.directory, "image.executable"),
        ],
      }),
    );
    expect((await readFile(targetPath)).equals(bytes)).toBe(true);
    expect(input.launcher.options.targetPath).toBe(targetPath);
    expect(await input.launcher.cleanup()).toEqual({ ok: true, value: null });
  },
);

it.skipIf(process.platform !== "darwin")(
  "observes native AppleScript literal interpretation for inert path strings",
  async () => {
    // Same quoted-literal representation seen in the pinned vendor helper. This
    // tests the real parser without opening an application or running target code.
    const backslashPath = "/selected/literal\\nname.hop";
    const parsed = await execFileOutput(
      "/usr/bin/osascript",
      ["-e", `return "${backslashPath}"`],
      { timeout: 5000 },
    );
    expect(parsed.stdout.trimEnd()).not.toBe(backslashPath);
    await expect(
      execFileOutput(
        "/usr/bin/osascript",
        ["-e", 'return "/selected/quote"name.hop"'],
        { timeout: 5000 },
      ),
    ).rejects.toBeInstanceOf(Error);
  },
);
