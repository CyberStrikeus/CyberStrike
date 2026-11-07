import { expect, it } from "vitest";

import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../tests/fixtures/nativeCommands.js";
import {
  inspectNativeMacho,
  VTOOL_CONTAINER_REFUSAL_LIMITATION,
} from "./NativeMachoInspection.js";
import {
  inspectionReader,
  unreadEncryption,
} from "./NativeMachoInspection.fixture.js";

const inspect = async (options: {
  readonly diagnostic: string;
  readonly format?: "fat" | "thin";
  readonly stdout?: string;
  readonly signal?: string | null;
}) => {
  const path = "/fixture/universal";
  const runner = new NativeFixtureRunner(
    options.format === "thin"
      ? { lipo: `Non-fat file: ${path} is architecture: arm64\n` }
      : {},
  );
  return inspectNativeMacho({
    readCommandNames: inspectionReader(),
    readEncryption: unreadEncryption,
    target: nativeMachoTarget(path),
    run: async (tool, args, _signal, acceptNonZeroIf) => {
      const result = await runner.run(tool, args);
      if (!result.ok || tool !== "vtool") return result;
      const refused = {
        ...result.value,
        stdout: options.stdout ?? "",
        stdoutBytes: Buffer.byteLength(options.stdout ?? ""),
        stderr: options.diagnostic,
        stderrBytes: Buffer.byteLength(options.diagnostic),
        exitCode: 1,
        signal: options.signal ?? null,
      };
      return acceptNonZeroIf?.(refused)
        ? ok(refused)
        : err(new AnalysisOutputError("inspect_macho", "vtool failed"));
    },
    invocation: (value) => ({
      tool: value.tool,
      command: [value.executable, ...value.arguments],
      tool_version: value.toolVersion,
      version_reason: value.versionReason,
      executable_sha256: value.executableSha256,
      exit: { code: value.exitCode, signal: value.signal },
      stdout_bytes: value.stdoutBytes,
      stderr_bytes: value.stderrBytes,
    }),
  });
};

const refusal = "/usr/bin/vtool error: /fixture/universal file is not mach-o\n";

it("retains required facts and failed vtool provenance for its universal-container refusal", async () => {
  const result = await inspect({ diagnostic: refusal });
  if (!result.ok) throw result.error;
  expect(result.value.limitations).toContain(
    VTOOL_CONTAINER_REFUSAL_LIMITATION,
  );
  expect(result.value.result).toMatchObject({
    format: "mach-o-universal",
    selected_architecture: { name: "arm64" },
    build_metadata: {
      items: [{ platform: "MACOS", minimum_os: "13.0", sdk: "14.2" }],
    },
    dependencies: {
      items: [{ path: "/usr/lib/libSystem.B.dylib", kind: "LC_LOAD_DYLIB" }],
    },
    imports: {
      items: expect.arrayContaining([
        expect.objectContaining({ name: "__Block_copy" }),
      ]),
    },
    exports: {
      items: expect.arrayContaining([
        expect.objectContaining({ name: "_main" }),
      ]),
    },
    uuid: "01234567-89AB-CDEF-0123-456789ABCDEF",
    provenance: expect.arrayContaining([
      expect.objectContaining({
        tool: "vtool",
        exit: { code: 1, signal: null },
      }),
    ]),
  });
});

it.each([
  { diagnostic: refusal, format: "thin" as const },
  { diagnostic: `${refusal}another error\n` },
  { diagnostic: "/usr/bin/vtool error: /other file is not mach-o\n" },
  { diagnostic: refusal, stdout: "unexpected output" },
  { diagnostic: refusal, signal: "SIGTERM" },
])("does not suppress other vtool failures: $diagnostic", async (options) => {
  const result = await inspect(options);
  expect(result).toMatchObject({
    ok: false,
    error: { reason: "vtool failed" },
  });
});
