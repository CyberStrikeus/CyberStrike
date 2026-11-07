import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  signatureInspectionFixture,
  NativeFixtureRunner,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";
import { resolvedAnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import {
  withSignatureTarget,
  verifySignatureTarget,
} from "../../../../src/native/SignatureTargetBinding.js";
import {
  NativeCommandFailure,
  XcrunCommandRunner,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { inspectSignatureSchema } from "../../../../src/domain/native/nativeInspection.js";
import { err, ok } from "../../../../src/domain/result.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const CONTENT = "registered executable bytes";
const runFile = promisify(execFile);
// Respect the caller's selected developer tools without passing the ambient environment.
const realXcrunRunner = () =>
  new XcrunCommandRunner(
    process.env.DEVELOPER_DIR === undefined
      ? {}
      : { DEVELOPER_DIR: process.env.DEVELOPER_DIR },
  );
const fixture = async () => {
  const directory = await createTestTempDirectory("rea-signature-binding-");
  const path = join(directory, "program");
  await writeFile(path, CONTENT);
  return {
    directory,
    path,
    target: await nativeMachoTargetForFile(path),
  };
};

class Captures extends NativeFixtureRunner {
  calls = 0;
  constructor(
    private readonly onCapture?: (args: readonly string[]) => Promise<void>,
  ) {
    super();
  }
  override async run(tool: string, args: readonly string[]) {
    this.calls += 1;
    await this.onCapture?.(args);
    return super.run(tool, args);
  }
}

const registerSignatureObservationCases = () => {
  it("inspects an unchanged registered executable", async () => {
    const { target } = await fixture();
    const captures: (readonly string[])[] = [];
    const result = await new NativeMacOSProvider(
      {},
      new Captures(async (args) => {
        captures.push(args);
      }),
      "darwin",
    )
      .createClient(target)
      .execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    expect(captures.slice(0, 3).every((args) => !args.includes("-a"))).toBe(
      true,
    );
    expect(
      captures.slice(3).map((args) => args[args.indexOf("-a") + 1]),
    ).toEqual(target.availableArchitectures);
    expect(result.value.result).toMatchObject({
      signed: true,
      identifier: "com.example.fixture",
      designated_requirement: "identifier com.example.fixture",
      limitations: expect.arrayContaining([
        "Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.",
        expect.stringContaining("Partial signature coverage:"),
      ]),
    });
  });

  it("projects typed plist scalars from a controlled entitlement response", async () => {
    const { path, target } = await fixture();
    const replay = new NativeFixtureRunner();
    const xml = `<?xml version="1.0"?><plist><dict>
<key>positive</key><real>+infinity</real>
<key>negative</key><real>-inf</real>
<key>nan</key><real>nan</real>
<key>integer</key><integer>9007199254740993</integer>
<key>date</key><date>2001-01-01T00:00:00Z</date>
<key>data</key><data>AQID</data><key>control</key><true/>
</dict></plist>`;
    const runner: NativeCommandRunner = {
      run(tool, args) {
        return args.includes("--entitlements")
          ? new NativeFixtureRunner({ codesign: xml }).run(tool, args)
          : replay.run(tool, args);
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(target)
      .execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    const signature = inspectSignatureSchema.parse(result.value.result);
    expect(signature.entitlements).toEqual({
      positive: { $plist_type: "real", value: "+infinity" },
      negative: { $plist_type: "real", value: "-infinity" },
      nan: { $plist_type: "real", value: "nan" },
      integer: { $plist_type: "integer", decimal: "9007199254740993" },
      date: { $plist_type: "date", iso8601: "2001-01-01T00:00:00.000Z" },
      data: { $plist_type: "data", base64: "AQID" },
      control: true,
    });
    expect(signature.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Entitlements: 3 non-finite real value(s)"),
        expect.stringContaining("unambiguous integer value(s)"),
      ]),
    );
    expect(await readFile(path, "utf8")).toBe(CONTENT);
  });
};

const registerSignatureIdentityGuardCases = () => {
  it.each(["changed", "missing", "directory", "symlink"] as const)(
    "rejects a %s target before commands run",
    async (replacement) => {
      const { path, target } = await fixture();
      if (replacement === "changed") await writeFile(path, "replacement bytes");
      else {
        await rm(path);
        if (replacement === "directory") await mkdir(path);
        if (replacement === "symlink") {
          await symlink(join(path, "missing"), path);
        }
      }
      const runner = new Captures();
      const result = await new NativeMacOSProvider({}, runner, "darwin")
        .createClient(target)
        .execute("inspect_signature", {});
      if (result.ok) throw new Error("Expected target-change failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "artifact_changed",
        details: { path },
      });
      expect(runner.calls).toBe(0);
    },
  );

  it.each(["replace", "remove", "rewrite"] as const)(
    "rejects %s after capturing signature metadata",
    async (change) => {
      const { path, target } = await fixture();
      const runner = new Captures(async (args) => {
        if (!args.includes("--entitlements")) return;
        if (change === "remove") await rm(path);
        else if (change === "rewrite") {
          const before = await lstat(path);
          await writeFile(path, CONTENT);
          // Identical writes may share a filesystem clock tick. Make the
          // metadata change observed by the target guard explicit.
          await utimes(path, before.atimeMs / 1000, before.mtimeMs / 1000 + 1);
        } else {
          const replacement = `${path}.replacement`;
          await writeFile(replacement, CONTENT);
          await rename(replacement, path);
        }
      });
      const result = await new NativeMacOSProvider({}, runner, "darwin")
        .createClient(target)
        .execute("inspect_signature", {});
      if (result.ok) throw new Error("Expected target-change failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "artifact_changed",
        details: { path },
      });
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    "preserves read permission denial before commands",
    async () => {
      const { path, target } = await fixture();
      await chmod(path, 0);
      const runner = new Captures();
      try {
        const result = await new NativeMacOSProvider({}, runner, "darwin")
          .createClient(target)
          .execute("inspect_signature", {});
        if (result.ok) throw new Error("Expected access denial");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "access_denied",
          details: { path },
        });
        expect(runner.calls).toBe(0);
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    "preserves permission denial during final version lookup",
    async () => {
      const { directory, path, target } = await fixture();
      const runner = new Captures(async (args) => {
        if (args.includes("--entitlements")) await chmod(directory, 0);
      });
      try {
        const result = await new NativeMacOSProvider({}, runner, "darwin")
          .createClient(target)
          .execute("inspect_signature", {});
        if (result.ok) throw new Error("Expected access denial");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "access_denied",
          details: { path },
        });
      } finally {
        await chmod(directory, 0o700);
      }
    },
  );
};

describe("native signature target identity", () => {
  registerSignatureObservationCases();
  registerSignatureIdentityGuardCases();
});

it.each([
  ["display", "result"],
  ["requirements", "result"],
  ["entitlements", "result"],
  ["slice", "result"],
  ["display", "throw"],
  ["requirements", "diagnostic"],
] as const)(
  "reports a removed target before the %s capture's %s failure can hide it",
  async (stage, failure) => {
    const { path, target } = await fixture();
    const replay = new NativeFixtureRunner();
    const unsigned: NativeCommandRunner = {
      async run(tool, args, options) {
        const diagnostic = `${args.at(-1)}: code object is not signed at all\n`;
        const capture = await new NativeFixtureRunner(
          { codesign: diagnostic },
          1,
        ).run(tool, args);
        if (!capture.ok) return capture;
        return ok({
          ...capture.value,
          stdout: "",
          stderr: diagnostic,
          stdoutBytes: 0,
          stderrBytes: Buffer.byteLength(diagnostic),
        });
      },
    };
    let failed = false;
    let displayCaptures = 0;
    const runner: NativeCommandRunner = {
      async run(tool, args) {
        const display = args.includes("--verbose=4");
        const slice = display && displayCaptures++ > 0;
        const selected =
          stage === "slice"
            ? slice
            : stage === "requirements"
              ? args.includes("-r-")
              : stage === "entitlements"
                ? args.includes("--entitlements")
                : display && !slice;
        if (selected) {
          failed = true;
          await rm(path);
          if (failure === "throw")
            throw new Error("codesign target disappeared");
          if (failure === "diagnostic")
            return new NativeFixtureRunner(
              { codesign: "invalid or unsupported format\n" },
              1,
            ).run(tool, args);
          return err(new NativeCommandFailure(tool, "nonzero-exit", 1));
        }
        if (stage === "slice" && args.includes("-r-"))
          return unsigned.run(tool, args, {});
        return replay.run(tool, args);
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(target)
      .execute("inspect_signature", {});
    expect(failed).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
  },
);

it("rejects an intermediate replacement before a later capture can restore the original inode", async () => {
  const { path, target } = await fixture();
  const original = `${path}.original`;
  const runner = new Captures(async (args) => {
    if (args.includes("-r-")) {
      await rename(path, original);
      await writeFile(path, "different executable");
    } else if (args.includes("--entitlements")) {
      await rm(path);
      await rename(original, path);
    }
  });
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(target)
    .execute("inspect_signature", {});
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisArtifactChangedError" },
  });
});

it("returns typed cancellation during target acquisition before commands run", async () => {
  const { path } = await fixture();
  await writeFile(path, Buffer.alloc(4 * 1024 * 1024, 42));
  const target = await nativeMachoTargetForFile(path);
  const controller = new AbortController();
  const runner = new Captures();
  const pending = new NativeMacOSProvider({}, runner, "darwin")
    .createClient(target)
    .execute("inspect_signature", {}, { signal: controller.signal });
  controller.abort();
  const result = await pending;
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(!result.ok && projectAnalysisError(result.error).code).toBe(
    "cancelled",
  );
  expect(runner.calls).toBe(0);
});

it("returns typed cancellation at binding entry and final verification", async () => {
  const { target } = await fixture();
  const signal = AbortSignal.abort();
  await expect(
    withSignatureTarget(
      target,
      new ArtifactResourceScope(),
      async () => {
        throw new Error("Cancelled acquisition must not invoke inspection");
      },
      signal,
    ),
  ).resolves.toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  await withSignatureTarget(
    target,
    new ArtifactResourceScope(),
    async (binding) => {
      const result = await verifySignatureTarget(target, binding, signal);
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
      return result.ok ? ok(signatureInspectionFixture()) : result;
    },
  );
});

it("preserves cancellation after a capture instead of classifying it as invalid output", async () => {
  const { target } = await fixture();
  const controller = new AbortController();
  const runner = new Captures(async () => {
    controller.abort();
  });
  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(target)
    .execute("inspect_signature", {}, { signal: controller.signal });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
});

it("does not classify an unrelated path-echo diagnostic as an unsigned observation", async () => {
  const directory = await createTestTempDirectory(
    "rea-signature-path-diagnostic-",
  );
  const path = join(directory, "source\ncode object is not signed\noperand");
  await writeFile(path, CONTENT);
  const target = await nativeMachoTargetForFile(path);
  let snapshotPath: string | undefined;
  const runner: NativeCommandRunner = {
    async run(tool, args) {
      snapshotPath = args.at(-1);
      if (snapshotPath === undefined)
        throw new Error("Expected the bound snapshot as the codesign operand");
      expect(
        Buffer.compare(await readFile(snapshotPath), Buffer.from(CONTENT)),
      ).toBe(0);
      return new NativeFixtureRunner(
        { codesign: `${snapshotPath}: No such file or directory\n` },
        1,
      ).run(tool, args);
    },
  };

  const result = await new NativeMacOSProvider({}, runner, "darwin")
    .createClient(target)
    .execute("inspect_signature", {});

  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "ProviderAdapterError" },
  });
  expect(await readFile(path, "utf8")).toBe(CONTENT);
  if (snapshotPath === undefined) throw new Error("Expected codesign capture");
  await expect(lstat(dirname(snapshotPath))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.skipIf(process.platform !== "darwin")(
  "rejects a path-injected unsigned diagnostic when real codesign sees a removed private snapshot",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-signature-snapshot-path-",
    );
    const path = join(directory, "source\ncode object is not signed\noperand");
    await copyFile("/usr/bin/true", path);
    const admitted = await parseBinaryTarget(path);
    if (!admitted.ok) throw admitted.error;
    const target = admitted.value;
    if (target.kind !== "executable")
      throw new Error("Expected the copied system executable");
    const originalBytes = await readFile(path);
    const real = realXcrunRunner();
    let snapshotPath: string | undefined;
    const runner: NativeCommandRunner = {
      async run(tool, args, options) {
        snapshotPath = args.at(-1);
        if (snapshotPath === undefined)
          throw new Error(
            "Expected the bound snapshot as the codesign operand",
          );
        expect(snapshotPath).not.toBe(path);
        expect(snapshotPath).toContain("\ncode object is not signed\n");
        await rm(snapshotPath);
        return real.run(tool, args, options);
      },
    };

    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(target)
      .execute("inspect_signature", {});

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
    expect(Buffer.compare(await readFile(path), originalBytes)).toBe(0);
    if (snapshotPath === undefined)
      throw new Error("Expected codesign capture");
    await expect(lstat(dirname(snapshotPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.skipIf(process.platform !== "darwin")(
  "accepts the exact unsigned diagnostic for a caller path containing that phrase",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-signature-real-unsigned-",
    );
    const path = join(directory, "source\ncode object is not signed\noperand");
    await copyFile("/usr/bin/true", path);
    await runFile("/usr/bin/codesign", ["--remove-signature", path]);
    const admitted = await parseBinaryTarget(path);
    if (!admitted.ok) throw admitted.error;
    const target = admitted.value;
    if (target.kind !== "executable")
      throw new Error("Expected the copied system executable");
    const result = await new NativeMacOSProvider(
      {},
      realXcrunRunner(),
      "darwin",
    )
      .createClient(target)
      .execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    const parsed = inspectSignatureSchema.parse(result.value.result);
    expect(parsed).toMatchObject({ signed: false });
    const { stdout: archOutput } = await runFile("/usr/bin/lipo", [
      "-archs",
      path,
    ]);
    const names = archOutput.trim().split(/\s+/u);
    const toolName = (architecture: string) => {
      const family = architecture === "x86" ? "i386" : architecture;
      const name =
        names.find((candidate) => candidate === family) ??
        names.find((candidate) => candidate.startsWith(family));
      if (name === undefined) throw new Error(`Missing ${family} slice`);
      return name;
    };
    const selectedArchitecture = toolName(target.architecture);
    const universal = target.format === "mach-o-universal";
    if (!universal && target.format !== "mach-o")
      throw new Error(`Unexpected Mach-O format ${target.format}`);
    const selector = (command: readonly string[], required: boolean) => {
      const index = command.indexOf("-a");
      if (!required) {
        expect(index).toBe(-1);
        return null;
      }
      if (index < 0)
        throw new Error("codesign omitted -a for a universal slice");
      return command[index + 1];
    };
    expect(
      parsed.provenance.map(({ command }, index) =>
        selector(command, universal || index >= 3),
      ),
    ).toEqual([
      ...(universal
        ? [selectedArchitecture, selectedArchitecture, selectedArchitecture]
        : [null, null, null]),
      ...(universal && target.availableArchitectures.length > 1
        ? target.availableArchitectures.map(toolName)
        : []),
    ]);
    expect(parsed.provenance.every(({ exit }) => exit.code === 1)).toBe(true);
  },
);

it.each(["success", "failure", "cancellation", "throw"] as const)(
  "releases the verified snapshot after %s",
  async (outcome) => {
    const { target } = await fixture();
    const controller = new AbortController();
    let snapshotPath: string | undefined;
    const runner: NativeCommandRunner = {
      async run(tool, args) {
        snapshotPath = args.at(-1);
        if (snapshotPath === undefined)
          throw new Error("Missing command target");
        expect(snapshotPath).not.toBe(target.path);
        expect(await readFile(snapshotPath, "utf8")).toBe(CONTENT);
        if (outcome === "throw") throw new Error("Unexpected native failure");
        if (outcome === "failure")
          return err(new NativeCommandFailure(tool, "io"));
        if (outcome === "cancellation") controller.abort();
        return new NativeFixtureRunner().run(tool, args);
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(target)
      .execute("inspect_signature", {}, { signal: controller.signal });
    expect(result.ok).toBe(outcome === "success");
    if (snapshotPath === undefined)
      throw new Error("Expected snapshot capture");
    await expect(lstat(dirname(snapshotPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("copies and hashes the same bytes across multiple snapshot chunks", async () => {
  const { path } = await fixture();
  const bytes = Buffer.alloc(128 * 1024 + 13, 42);
  await writeFile(path, bytes);
  const target = await nativeMachoTargetForFile(path);
  await withSignatureTarget(
    target,
    new ArtifactResourceScope(),
    async (binding) => {
      expect(Buffer.compare(await readFile(binding.snapshotPath), bytes)).toBe(
        0,
      );
      const verified = await verifySignatureTarget(target, binding);
      return verified.ok ? ok(signatureInspectionFixture()) : verified;
    },
  );
});

it.skipIf(process.platform === "win32")(
  "rejects a changed snapshot identity while the registered source remains unchanged",
  async () => {
    const { path, target } = await fixture();
    const result = await withSignatureTarget(
      target,
      new ArtifactResourceScope(),
      async (binding) => {
        await chmod(binding.snapshotPath, 0o600);
        await writeFile(binding.snapshotPath, "replacement snapshot bytes");
        const verified = await verifySignatureTarget(target, binding);
        return verified.ok ? ok(signatureInspectionFixture()) : verified;
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
    expect(await readFile(path, "utf8")).toBe(CONTENT);
  },
);

it("cleans the private snapshot when inspection throws", async () => {
  const { target } = await fixture();
  let snapshotPath: string | undefined;
  const result = await withSignatureTarget(
    target,
    new ArtifactResourceScope(),
    async (binding) => {
      snapshotPath = binding.snapshotPath;
      throw new Error("Invalid parsed output");
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisOutputError" },
  });
  if (snapshotPath === undefined) throw new Error("Expected snapshot");
  await expect(lstat(dirname(snapshotPath))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.skipIf(process.platform !== "darwin")(
  "keeps real codesign bound to registered bytes during an ancestor directory swap",
  async () => {
    const root = await createTestTempDirectory("rea-signature-swap-");
    const selected = join(root, "selected");
    const replacement = join(root, "replacement");
    const saved = join(root, "saved");
    await mkdir(selected);
    await mkdir(replacement);
    const path = join(selected, "program");
    const replacementPath = join(replacement, "program");
    const run = promisify(execFile);
    for (const [program, identifier] of [
      [path, "rea.original"],
      [replacementPath, "rea.replacement"],
    ] as const) {
      await copyFile("/usr/bin/true", program);
      await run("/usr/bin/codesign", [
        "-s",
        "-",
        "-f",
        "--identifier",
        identifier,
        program,
      ]);
    }
    const admitted = await parseBinaryTarget(path);
    if (!admitted.ok) throw admitted.error;
    const target = admitted.value;
    if (target.kind !== "executable")
      throw new Error("Expected the copied system executable");
    const real = realXcrunRunner();
    let capturedPath: string | undefined;
    const runner: NativeCommandRunner = {
      async run(tool, args, options) {
        capturedPath = args.at(-1);
        await rename(selected, saved);
        await rename(replacement, selected);
        try {
          expect(
            Buffer.compare(
              await readFile(path),
              await readFile(join(saved, "program")),
            ),
          ).not.toBe(0);
          return await real.run(tool, args, options);
        } finally {
          await rename(selected, replacement);
          await rename(saved, selected);
        }
      },
    };
    const result = await new NativeMacOSProvider({}, runner, "darwin")
      .createClient(target)
      .execute("inspect_signature", {});
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      signed: true,
      identifier: "rea.original",
    });
    expect(
      inspectSignatureSchema
        .parse(result.value.result)
        .provenance.map(({ command }) => command.at(-1)),
    ).toEqual(
      Array.from(
        {
          length:
            3 +
            (target.format === "mach-o-universal" &&
            target.availableArchitectures.length > 1
              ? target.availableArchitectures.length
              : 0),
        },
        () => "$ARTIFACT",
      ),
    );
    if (capturedPath === undefined)
      throw new Error("Expected codesign invocation");
    await expect(lstat(dirname(capturedPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

for (const cleanupFails of [false, true])
  it(`retains completed provider signature facts when root finalization cancels (fails: ${cleanupFails})`, async () => {
    const { path, target } = await fixture();
    const controller = new AbortController();
    const reason = { caller: "provider-final-root-close" };
    const root = join(dirname(path), "controlled-snapshot-root");
    let attempts = 0;
    const client = new NativeMacOSProvider(
      {},
      new Captures(),
      "darwin",
      undefined,
      async () => {
        await mkdir(root);
        return {
          path: root,
          async close() {
            try {
              if (cleanupFails && attempts++ === 0)
                throw new Error("controlled provider root cleanup failure");
              await rm(root, { recursive: true });
            } finally {
              controller.abort(reason);
            }
          },
        };
      },
    ).createClient(target);
    onTestFinished(async () => {
      await client.close();
    });
    const result = await client.execute(
      "inspect_signature",
      {},
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error("Expected cancellation after completed provider facts");
    expect(result.error.cleanupIncomplete).toBe(cleanupFails);
    const facts = inspectSignatureSchema.parse(result.error.partialObservation);
    expect(facts.signed).toBe(true);
    expect(facts.provenance).toHaveLength(5);
    expect(
      projectAnalysisError(result.error).details?.partial_observation,
    ).toEqual(facts);
    expect((await client.close()).ok).toBe(true);
    expect(resolvedAnalysisError(result.error)).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
