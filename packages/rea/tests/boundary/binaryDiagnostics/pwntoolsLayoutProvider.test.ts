import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { expect, it, onTestFinished } from "vitest";
import { PwntoolsLayoutProvider } from "../../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "../../../src/native/pwntools/PwntoolsRelease.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { binaryLayoutFixture } from "../../fixtures/binaryDiagnostics/layout.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

const unsupportedHost = process.platform !== "linux" || process.arch !== "x64";
const requestSchema = z.strictObject({
  snapshot_path: z.string(),
  reply_path: z.string(),
});

it.runIf(!unsupportedHost).each([
  ["SIGXCPU", "reported", "cpu"],
  ["SIGXCPU", "missing", "cpu"],
  ["SIGXCPU", "malformed", "cpu"],
  ["SIGXFSZ", "reported", "file-size"],
  ["EFBIG", "reported", "file-size"],
  ["EFBIG", "malformed", "file-size"],
] as const)(
  "preserves observed %s with %s limit evidence",
  async (failure, scenario, resource) => {
    const { path } = await fixture();
    let ownedPath = "";
    const limits = {
      address_space_bytes: 3221225472,
      cpu_seconds: 1,
      file_size_bytes: 1024,
    };
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        if (failure === "EFBIG")
          await writeFile(join(ownedPath, "resource.failure"), "F");
        if (scenario !== "missing")
          await writeFile(
            join(ownedPath, "limits.json"),
            scenario === "reported"
              ? JSON.stringify(limits)
              : '{"cpu_seconds":999}',
          );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            failure === "EFBIG"
              ? 'process.stdout.write("resource diagnostic", () => { process.exitCode = 76; })'
              : failure === "SIGXFSZ"
                ? 'process.on("SIGXFSZ", () => { process.removeAllListeners("SIGXFSZ"); process.kill(process.pid, "SIGXFSZ"); }); process.stdout.write("resource diagnostic", () => process.kill(process.pid, "SIGXFSZ")); setTimeout(() => {}, 1000);'
                : `process.stdout.write("resource diagnostic", () => process.kill(process.pid, "${failure}"))`,
          ],
        });
      },
    );
    const result = await provider.inspect({ path });
    if (result.ok) throw new Error("Expected observed resource failure");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: {
        resource,
        reported_limits: scenario === "reported" ? limits : null,
        captured_output: { stdout: "resource diagnostic", truncated: false },
      },
    });
    expect(result.error.message).toContain(
      failure === "EFBIG"
        ? "exact write failure cause is unknown"
        : "exact signal cause is unknown",
    );
    if (scenario !== "reported")
      expect(result.error.message).toContain("limit report unavailable");
    expect(projected.remediation.action).toContain(
      resource === "cpu" ? "CPU" : "file-size",
    );
    if (resource === "file-size") {
      expect(projected.remediation.action).toContain("outputBytes");
      expect(projected.remediation.action).toContain("67108864");
      expect(projected.remediation.action).toContain("file_size_bytes");
      expect(projected.remediation.action).not.toContain("address-space");
      expect(projected.remediation.action).not.toContain("3221225472");
      if (scenario === "reported")
        expect(projected.remediation.action).toContain("1024");
    }
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "retains actual diagnostic truncation when output overflow and process cleanup both fail",
  async () => {
    const { path } = await fixture();
    let ownedPath = "";
    let cleanupAllowed = false;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", 'process.stdout.write("x".repeat(1048577))'],
        });
        return {
          ...launched,
          cleanup: async () => {
            if (cleanupAllowed)
              return cleanupOwnedProcessGroup(launched.ownership);
            throw new Error("injected post-cleanup reporting failure");
          },
        };
      },
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspect({ path });
    if (result.ok) throw new Error("Expected compounded lifecycle failure");
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      capturedOutput: { truncated: true, stderr: "" },
      diagnostics: {
        primary_error: {
          code: "unreadable_output",
        },
        cleanup_error: {
          code: "cleanup_incomplete",
          details: {
            diagnostics: { reason: "injected post-cleanup reporting failure" },
          },
        },
      },
    });
    const projected = projectAnalysisError(result.error);
    expect(projected.details?.captured_output).toEqual(
      result.error.capturedOutput,
    );
    expect(projected).not.toHaveProperty(
      "details.diagnostics.primary_error.details.captured_output",
    );
    const output = result.error.capturedOutput?.stdout;
    if (!output) throw new Error("Expected retained truncated worker output");
    // Preserve the cleanup owner's separate snapshot, but not a redundant
    // captured_output copy in generic primary history.
    expect(projected).toHaveProperty(
      "details.diagnostics.cleanup_error.details.diagnostics.captured_output.stdout",
      output,
    );
    expect(JSON.stringify(projected).split(output)).toHaveLength(3);
    await expect(access(ownedPath)).resolves.toBeUndefined();
    cleanupAllowed = true;
    await provider.close();
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it
  .runIf(!unsupportedHost)
  .each([
    "reserved-memory-status",
    "unmarked-memory-status",
    "unmarked-file-status",
    "wrong-marker",
    "ordinary-exit",
    "signal",
  ])(
  "requires matching private bridge failure evidence, without guessing from stderr: %s",
  async (scenario) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        if (
          scenario === "reserved-memory-status" ||
          scenario === "wrong-marker"
        )
          await writeFile(
            join(ownedPath, "resource.failure"),
            scenario === "wrong-marker" ? Buffer.from([0xcd]) : "M",
          );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            'process.stderr.write("MemoryError-like diagnostic\\n");' +
              (scenario === "signal"
                ? 'process.kill(process.pid,"SIGKILL")'
                : `process.exit(${scenario === "unmarked-file-status" ? "76" : ["reserved-memory-status", "unmarked-memory-status", "wrong-marker"].includes(scenario) ? "75" : "7"})`),
          ],
        });
      },
    );
    const result = await provider.inspect({ path });
    if (result.ok) throw new Error("Expected explicit process failure");
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe(
      scenario === "reserved-memory-status"
        ? "resource_constraint"
        : "execution_failure",
    );
    expect(JSON.stringify(projected)).toContain("MemoryError-like diagnostic");
    if (scenario === "reserved-memory-status")
      expect(projected.details).toMatchObject({
        resource: "memory",
        reported_limits: null,
        captured_output: { truncated: false },
      });
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each([1048576, 1048577])(
  "keeps complete diagnostics or fails explicitly when a valid reply emits %s bytes",
  async (bytes) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request path missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        const {
          artifact: _artifact,
          diagnostics: _diagnostics,
          ...value
        } = binaryLayoutFixture(path);
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: true,
            profile: PWNTOOLS_PROVIDER_IDENTITY.version,
            value,
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            `process.stdout.write("x".repeat(${String(bytes)}))`,
          ],
        });
      },
    );
    const result = await provider.inspect({ path });
    if (bytes === 1048576) {
      if (!result.ok) throw result.error;
      expect(result.value.diagnostics.stdout).toHaveLength(bytes);
      expect(result.value.diagnostics.truncated).toBe(false);
    } else {
      if (result.ok)
        throw new Error("Excess diagnostics must not return partial success");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "unreadable_output",
        details: { captured_output: { truncated: true } },
      });
    }
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each([
  null,
  {
    address_space_bytes: 67108864,
    cpu_seconds: 20,
    file_size_bytes: 33554432,
  },
])(
  "preserves reported memory failure, budgets, diagnostics and cleanup: %j",
  async (limits) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request path missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: false,
            reason: "resource-limit",
            message: "Memory allocation failed; exact cause unknown.",
            reported_limits: limits,
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            "process.stderr.write('upstream allocation diagnostic')",
          ],
        });
      },
    );
    const result = await provider.inspect({ path });
    if (result.ok) throw new Error("Expected resource failure");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      category: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: limits,
        captured_output: {
          stderr: "upstream allocation diagnostic",
          truncated: false,
        },
      },
    });
    expect(projected.remediation.action).toContain("memory");
    expect(projected.remediation.action).toContain("address-space");
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path, "utf8")).toBe("source-owned-seam-bytes");
  },
);

it.runIf(!unsupportedHost).each(["cancelled", "output-limit", "process"])(
  "releases an acquired decoder and its snapshot after %s",
  async (scenario) => {
    const { path } = await fixture();
    const controller = new AbortController();
    let ownedPath = "";
    let pid: number | undefined;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        ownedPath = spawn.cwd ?? "";
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            scenario === "cancelled"
              ? 'process.stdout.write("ready\\n"); setInterval(() => undefined, 1000)'
              : scenario === "output-limit"
                ? 'process.stdout.write("x".repeat(1048577))'
                : 'process.stderr.write("decoder exited unexpectedly"); process.exit(7)',
          ],
        });
        pid = launched.process.pid;
        if (scenario === "cancelled") {
          await waitForProviderProcessReady(launched.process);
          setImmediate(() => controller.abort());
        }
        return launched;
      },
    );
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag:
          scenario === "cancelled"
            ? "AnalysisCancelledError"
            : scenario === "output-limit"
              ? "AnalysisOutputError"
              : "ProviderAdapterError",
        ...(scenario === "process"
          ? {
              diagnostics: {
                exit_code: 7,
                stderr: "decoder exited unexpectedly",
              },
            }
          : {}),
      },
    });
    if (pid === undefined) throw new Error("Decoder was not acquired");
    const acquiredPid = pid;
    expect(() => process.kill(acquiredPid, 0)).toThrow();
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path, "utf8")).toBe("source-owned-seam-bytes");
  },
);

it.runIf(!unsupportedHost)(
  "reports private storage denial as an adapter failure rather than selected-input read denial",
  async () => {
    const { path } = await fixture();
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      undefined,
      () =>
        Promise.reject(
          Object.assign(new Error("private root denied"), { code: "EACCES" }),
        ),
    );
    expect(await provider.inspect({ path })).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: { phase: "decoder", reason: "private root denied" },
      },
    });
  },
);

it.runIf(!unsupportedHost)(
  "preserves a decoder failure when private-root cleanup also fails",
  async () => {
    const { path, root } = await fixture();
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request path missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: false,
            reason: "format",
            message: "Malformed original ELF table.",
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: ["-e", "process.exit(0)"],
        });
      },
      () =>
        Promise.resolve({
          path: root,
          close: () => Promise.reject(new Error("root cleanup failed")),
        }),
    );
    expect(await provider.inspect({ path })).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: [root],
        diagnostics: {
          primary_error: { category: "invalid_input" },
          cleanup_error: {
            code: "cleanup_incomplete",
            details: { diagnostics: { reason: "root cleanup failed" } },
          },
        },
      },
    });
  },
);
const fixture = async () => {
  const workspace = await createTestWorkspace("rea-layout-boundary-");
  const root = workspace.root;
  onTestFinished(() => removeTestWorkspace(root));
  const path = join(root, "selected.elf");
  await writeFile(path, "source-owned-seam-bytes");
  return { root, path };
};

it.runIf(!unsupportedHost)(
  "preserves cancellation during the actual signal-aware snapshot write and closes its acquired root",
  async () => {
    const { path } = await fixture();
    const controller = new AbortController();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      () => {
        throw new Error("Decoder must not launch");
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-layout-cancel-",
        });
        ownedPath = root.path;
        controller.abort();
        return root;
      },
    );
    expect(
      await provider.inspect({ path }, { signal: controller.signal }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it
  .runIf(!unsupportedHost)
  .each([
    "success",
    "format",
    "unavailable",
    "unsupported",
    "output-limit",
    "wrong-profile",
    "malformed-reply",
    "invalid-utf8",
    "literal-replacement",
    "bom-reply",
  ])(
  "preserves process/reply boundaries and cleans private snapshots: %s",
  async (scenario) => {
    const { root, path } = await fixture();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("request path missing");
        ownedPath = spawn.cwd ?? "";
        expect(spawn.arguments[0]).toBe("-I");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        expect(await readFile(request.snapshot_path, "utf8")).toBe(
          "source-owned-seam-bytes",
        );
        const {
          artifact: _artifact,
          diagnostics: _diagnostics,
          ...value
        } = binaryLayoutFixture(path);
        const encodedReplies: Partial<Record<string, string | Buffer>> = {
          "invalid-utf8": Buffer.concat([
            Buffer.from('{"ok":false,"reason":"format","message":"'),
            Buffer.from([0xff]),
            Buffer.from('"}'),
          ]),
          "literal-replacement": JSON.stringify({
            ok: false,
            reason: "format",
            message: "valid �",
          }),
          "bom-reply": '\uFEFF{"ok":false,"reason":"format","message":"valid"}',
        };
        const encodedReply = encodedReplies[scenario];
        if (encodedReply !== undefined)
          await writeFile(request.reply_path, encodedReply);
        else {
          await writeFile(
            request.reply_path,
            scenario === "malformed-reply"
              ? "broken-json"
              : JSON.stringify(
                  [
                    "format",
                    "unavailable",
                    "unsupported",
                    "output-limit",
                  ].includes(scenario)
                    ? {
                        ok: false,
                        reason: scenario,
                        message: "ELF table is truncated.",
                      }
                    : {
                        ok: true,
                        profile:
                          scenario === "wrong-profile"
                            ? "pwntools@other"
                            : PWNTOOLS_PROVIDER_IDENTITY.version,
                        value,
                      },
                ),
          );
        }
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", "process.stderr.write('upstream warning')"],
        });
      },
    );
    const result = await provider.inspect({ path });
    if (scenario === "literal-replacement")
      expect(result).toMatchObject({
        ok: false,
        error: { issues: [{ message: "valid �" }] },
      });
    if (scenario === "success") {
      if (!result.ok) throw result.error;
      expect(result.value.artifact).toMatchObject({
        path,
        bytes: Buffer.byteLength("source-owned-seam-bytes"),
      });
      expect(result.value.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.value.diagnostics.stderr).toBe("upstream warning");
    } else
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag:
            scenario === "format" || scenario === "literal-replacement"
              ? "AnalysisInputError"
              : scenario === "unavailable"
                ? "ProviderSelectionError"
                : scenario === "unsupported"
                  ? "AnalysisCapabilityUnavailableError"
                  : "AnalysisOutputError",
        },
      });
    if (!result.ok)
      expect(projectAnalysisError(result.error).details).toMatchObject({
        captured_output: {
          stdout: "",
          stderr: "upstream warning",
          truncated: false,
        },
      });
    expect(await readFile(path, "utf8")).toBe("source-owned-seam-bytes");
    expect(ownedPath.startsWith(root)).toBe(false);
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "rejects missing configuration, absent input and prelaunch cancellation distinctly",
  async () => {
    const { path } = await fixture();
    expect(
      await new PwntoolsLayoutProvider({}).inspect({ path }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "ProviderSelectionError", reason: "provider_unavailable" },
    });
    const provider = new PwntoolsLayoutProvider({
      REA_PWNTOOLS_PYTHON: process.execPath,
    });
    expect(await provider.inspect({ path: path + ".absent" })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      await provider.inspect({ path }, { signal: controller.signal }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
  },
);
it.runIf(unsupportedHost)(
  "reports unverified host coverage before acquiring a provider",
  async () => {
    const result = await new PwntoolsLayoutProvider({}).inspect({
      path: "/selected.elf",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
    // Another target cannot satisfy a host requirement, so name it.
    if (result.ok) throw new Error("Expected a host refusal");
    const projected = projectAnalysisError(result.error);
    expect(projected.message).toContain("Linux x64");
    expect(projected.remediation.action).toContain("Linux x64");
  },
);

it.runIf(!unsupportedHost)(
  "retains decoder warnings when cancellation arrives during successful root cleanup",
  async () => {
    const { path } = await fixture();
    const controller = new AbortController();
    let ownedPath = "";
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request path missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        const {
          artifact: _artifact,
          diagnostics: _diagnostics,
          ...value
        } = binaryLayoutFixture(path);
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: true,
            profile: PWNTOOLS_PROVIDER_IDENTITY.version,
            value,
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", 'process.stderr.write("retained late warning")'],
        });
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-layout-late-cancel-",
        });
        ownedPath = root.path;
        return {
          path: root.path,
          close: async () => {
            await root.close();
            controller.abort();
          },
        };
      },
    );
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (result.ok) throw new Error("Late cancellation must be preserved");
    expect(projectAnalysisError(result.error).details?.captured_output).toEqual(
      { stdout: "", stderr: "retained late warning", truncated: false },
    );
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each(["directory", "missing-interpreter"])(
  "identifies the configured executable on actual launch/preflight failure: %s",
  async (scenario) => {
    const { path, root } = await fixture();
    const executable =
      scenario === "directory" ? root : join(root, "broken-python");
    if (scenario === "missing-interpreter")
      await writeFile(
        executable,
        "#!/rea-missing-interpreter-for-boundary-test\n",
        { mode: 0o700 },
      );
    const result = await new PwntoolsLayoutProvider({
      REA_PWNTOOLS_PYTHON: executable,
    }).inspect({ path });
    if (result.ok) throw new Error("Expected unavailable executable");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "provider_unavailable",
      details: {
        rejections: [{ diagnostics: { executable_path: executable } }],
      },
    });
    expect(result.error._tag).toBe("ProviderSelectionError");
    expect(await readFile(path, "utf8")).toBe("source-owned-seam-bytes");
  },
);
