import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NATIVE_FAILURE_DIAGNOSTIC_BYTES,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { ok } from "../../../../src/domain/result.js";
import { thinMach } from "../../../../src/domain/binaryTarget.fixture.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

type Streams = { readonly stdout: string; readonly stderr: string };

const fixture = async (streams: (path: string) => Streams) => {
  const root = await createTestTempDirectory("rea-plist-diagnostic-");
  const target = join(root, "program");
  await writeFile(target, thinMach(0xfeedfacf, 0x100000c));
  await mkdir(join(root, "Contents"));
  const path = join(root, "Contents/Info.plist");
  await writeFile(path, "not a plist");
  const output = streams(path);
  const replay = new NativeFixtureRunner({ file: "ASCII text\n" });
  const runner: NativeCommandRunner = {
    async run(tool, args) {
      const capture = await replay.run(tool, args);
      if (tool !== "plutil" || !capture.ok) return capture;
      return ok({
        ...capture.value,
        ...output,
        exitCode: 1,
        stdoutBytes: Buffer.byteLength(output.stdout),
        stderrBytes: Buffer.byteLength(output.stderr),
      });
    },
  };
  const provider = new NativeMacOSProvider({}, runner, "darwin");
  const client = provider.createClient(nativeMachoTarget(target));
  onTestFinished(async () => {
    await client.close();
  });
  return { client, path, output };
};

it.each(["stdout", "stderr", "both", "whitespace", "empty"] as const)(
  "preserves selected/default plist failure diagnostics from %s",
  async (source) => {
    const { client, path, output } = await fixture((path) => ({
      stdout:
        source === "stdout" || source === "both"
          ? `${path}: invalid integer on line 3\n`
          : "",
      stderr:
        source === "stderr" || source === "both"
          ? `${path}: additional parse diagnostic\n`
          : source === "whitespace"
            ? " \n\t"
            : "",
    }));
    for (const requested of [undefined, path]) {
      const result = await client.execute(
        "inspect_plist",
        requested === undefined ? {} : { path: requested },
      );
      if (result.ok) throw new Error("Expected decode refusal");
      const projected = projectAnalysisError(result.error);
      const text = JSON.stringify(
        requested === undefined
          ? projected.details?.reason
          : projected.details?.issues,
      );
      if (source === "stdout" || source === "both")
        expect(text).toContain("invalid integer on line 3");
      if (source === "stderr" || source === "both")
        expect(text).toContain("additional parse diagnostic");
      if (source === "whitespace" || source === "empty")
        expect(text).toContain("plutil printed no diagnostic");
      expect(projected).toMatchObject({
        code:
          requested === undefined
            ? "capability_unavailable"
            : "invalid_request",
        details: {
          captured_output: {
            ...output,
            truncated: false,
            stdout_bytes: Buffer.byteLength(output.stdout),
            stderr_bytes: Buffer.byteLength(output.stderr),
            exit_code: 1,
            signal: null,
          },
        },
      });
    }
    expect((await client.close()).ok).toBe(true);
  },
);

it("bounds failure excerpts and preserves observed byte counts and truncation", async () => {
  const { client, path, output } = await fixture(() => ({
    stdout: "é".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES),
    stderr: "z".repeat(NATIVE_FAILURE_DIAGNOSTIC_BYTES + 1),
  }));
  const result = await client.execute("inspect_plist", { path });
  if (result.ok) throw new Error("Expected decode refusal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    details: {
      captured_output: {
        truncated: true,
        stdout_bytes: Buffer.byteLength(output.stdout),
        stderr_bytes: Buffer.byteLength(output.stderr),
        exit_code: 1,
      },
    },
  });
  const capture = result.error.capturedOutput;
  expect(capture).toBeDefined();
  expect(Buffer.byteLength(capture!.stdout)).toBeLessThanOrEqual(
    NATIVE_FAILURE_DIAGNOSTIC_BYTES,
  );
  expect(Buffer.byteLength(capture!.stderr)).toBeLessThanOrEqual(
    NATIVE_FAILURE_DIAGNOSTIC_BYTES,
  );
  expect(capture!.stdout).not.toContain("\ufffd");
  expect(
    Buffer.byteLength(JSON.stringify(projectAnalysisError(result.error))),
  ).toBeLessThan(8 * NATIVE_FAILURE_DIAGNOSTIC_BYTES);
});
