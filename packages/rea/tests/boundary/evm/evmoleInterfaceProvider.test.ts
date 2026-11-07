import { createHash } from "node:crypto";
import { access, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { evmInterfaceSchema } from "../../../src/domain/evm/evmInterface.js";
import { EvmoleInterfaceProvider } from "../../../src/evm/EvmoleInterfaceProvider.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { EvmInterfaceService } from "../../../src/application/evm/EvmInterfaceService.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const unsupportedHost = process.platform !== "linux" || process.arch !== "x64";
const requestSchema = z.strictObject({
  snapshot_path: z.string(),
  reply_path: z.string(),
  failure_marker_path: z.string(),
  encoding: z.enum(["raw", "hex"]),
});
const fixture = async () => {
  const workspace = await createTestWorkspace("rea-evm-interface-boundary-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = join(workspace.root, "selected.hex");
  await writeFile(path, "0x60006000f3\n");
  return { path, root: workspace.root };
};

it.runIf(unsupportedHost)(
  "names the host requirement instead of asking for another target",
  async () => {
    const result = await new EvmoleInterfaceProvider({}).inspect({
      path: "/selected.hex",
      encoding: "hex",
    });
    if (result.ok) throw new Error("Expected a host refusal");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({ code: "capability_unavailable" });
    expect(projected.message).toContain("Linux x64");
    expect(projected.remediation.action).toContain("Linux x64");
  },
);

it.runIf(!unsupportedHost).each(["SIGXCPU", "SIGXFSZ", "EFBIG"])(
  "preserves %s with configured limits distinct from unknown effective limits",
  async (failure) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      ownedPath = spawn.cwd ?? "";
      if (failure === "EFBIG")
        await writeFile(join(ownedPath, "resource.failure"), "F");
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
    });
    const result = await provider.inspect({ path, encoding: "hex" });
    if (result.ok) throw new Error("Expected observed resource failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: failure === "SIGXCPU" ? "cpu" : "file-size",
        reported_limits: {
          configured_soft_limits: { cpu_seconds: expect.any(Number) },
          effective_soft_limits: null,
        },
        captured_output: { stdout: "resource diagnostic", truncated: false },
      },
    });
    expect(result.error.message).toContain(
      failure === "EFBIG" ? "exact write failure cause" : "exact signal cause",
    );
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each(["missing", "wrong"])(
  "does not classify a launcher exit 76 with %s worker failure evidence",
  async (scenario) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      ownedPath = spawn.cwd ?? "";
      if (scenario === "wrong")
        await writeFile(
          join(ownedPath, "resource.failure"),
          Buffer.from([0xc6]),
        );
      return spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: [
          "-e",
          'process.stdout.write("launcher failure", () => { process.exitCode = 76; });',
        ],
      });
    });
    const result = await provider.inspect({ path, encoding: "hex" });
    if (result.ok) throw new Error("Expected launcher failure");
    expect(projectAnalysisError(result.error).code).toBe("execution_failure");
    expect(result.error).toMatchObject({
      capturedOutput: { stdout: "launcher failure", truncated: false },
      diagnostics: {
        file_size_failure_marker: {
          verified: false,
          failure: expect.any(String),
        },
      },
    });
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "retains actual diagnostic truncation when overflow and process cleanup both fail",
  async () => {
    const { path } = await fixture();
    let ownedPath = "";
    let failCleanup = true;
    let launches = 0;
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      launches += 1;
      ownedPath = spawn.cwd ?? "";
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", 'process.stdout.write("x".repeat(1048577))'],
      });
      const cleanupOwned =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          const cleaned = await cleanupOwned();
          if (failCleanup)
            throw new Error("injected post-cleanup reporting failure");
          return cleaned;
        },
      };
    });
    onTestFinished(async () => {
      failCleanup = false;
      await provider.close();
    });
    const result = await provider.inspect({ path, encoding: "hex" });
    if (result.ok) throw new Error("Expected compounded lifecycle failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    // Inspect the retained error chain without diffing a megabyte of stdout.
    const cleanup = z
      .object({
        reason: z.string(),
        previous_error: z.object({
          code: z.string(),
          category: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
        }),
        captured_output: z.object({
          truncated: z.boolean(),
          stderr: z.literal(""),
          stdout: z.string().transform((value) => Buffer.byteLength(value)),
        }),
      })
      .parse(projectAnalysisError(result.error).details?.["diagnostics"]);
    expect(cleanup).toEqual({
      reason: "injected post-cleanup reporting failure",
      previous_error: expect.objectContaining({ code: "unreadable_output" }),
      captured_output: { truncated: true, stderr: "", stdout: 1048576 },
    });
    expect(cleanup.previous_error.details?.["captured_output"]).toBeUndefined();
    expect(JSON.stringify(cleanup.previous_error)).not.toContain(
      "x".repeat(256),
    );
    expect(result.error.cleanupResources).toContain(ownedPath);
    await access(ownedPath);
    const blocked = await provider.inspect({ path, encoding: "hex" });
    expect(blocked.ok).toBe(false);
    expect(launches).toBe(1);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    failCleanup = false;
    await provider.close();
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each(["completed", "malformed-reply"] as const)(
  "retains worker facts or its primary reply failure while process cleanup is unresolved: %s",
  async (scenario) => {
    const { path } = await fixture();
    let ownedRoot = "";
    let denyRootClose = true;
    let launches = 0;
    let mayClean = false;
    const provider = new EvmoleInterfaceProvider(
      {},
      async (spawn) => {
        launches += 1;
        ownedRoot = spawn.cwd ?? "";
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        if (scenario === "malformed-reply")
          await writeFile(request.reply_path, "malformed worker reply");
        else {
          const bytes = Buffer.from("60006000f3", "hex");
          await writeFile(
            request.reply_path,
            JSON.stringify({
              ok: true,
              version: "0.9.3",
              bytecode: {
                sha256: createHash("sha256").update(bytes).digest("hex"),
                bytes: bytes.length,
                hex: bytes.toString("hex"),
              },
              raw: { functions: [] },
            }),
          );
        }
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", 'process.stderr.write("worker completed")'],
        });
        const cleanup =
          launched.cleanup ??
          (() => cleanupOwnedProcessGroup(launched.ownership));
        return {
          ...launched,
          cleanup: async () => {
            const stopped = await cleanup();
            if (!mayClean) throw new Error("injected retained cleanup failure");
            return stopped;
          },
        };
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-evm-mixed-cleanup-",
        });
        ownedRoot = root.path;
        const close = root.close.bind(root);
        return {
          path: root.path,
          close: async () => {
            if (denyRootClose) {
              denyRootClose = false;
              throw new Error("injected retained root cleanup failure");
            }
            await close();
          },
        };
      },
    );
    onTestFinished(async () => {
      mayClean = true;
      await provider.close();
    });

    const result = await provider.inspect({ path, encoding: "hex" });
    if (result.ok)
      throw new Error("Expected process cleanup to remain visible");
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    const projected = projectAnalysisError(result.error);
    expect(projected.details?.["diagnostics"]).toMatchObject({
      reason: "injected retained cleanup failure",
      captured_output: { stderr: "worker completed", truncated: false },
      ...(scenario === "malformed-reply"
        ? { previous_error: { code: "unreadable_output" } }
        : { previous_error: null }),
    });
    if (scenario === "completed")
      expect(result.error.partialObservation).toMatchObject({
        normalized_result: {
          bytecode: { hex: "60006000f3" },
          evidence_kind: "inferred",
        },
      });
    else expect(result.error.partialObservation).toBeUndefined();
    await access(ownedRoot);

    const blocked = await provider.inspect({ path, encoding: "hex" });
    expect(blocked.ok).toBe(false);
    expect(launches).toBe(1);
    mayClean = true;
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [ownedRoot],
    });
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(ownedRoot);
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(projectAnalysisError(result.error).code).toBe(
      scenario === "malformed-reply"
        ? "unreadable_output"
        : "execution_failure",
    );
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each([1048576, 1048577])(
  "keeps complete diagnostics or rejects a valid worker reply with %s diagnostic bytes",
  async (size) => {
    const { path } = await fixture();
    let ownedPath = "";
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      ownedPath = spawn.cwd ?? "";
      const requestPath = spawn.arguments.at(-1);
      if (requestPath === undefined) throw new Error("Request missing");
      const request = requestSchema.parse(
        JSON.parse(await readFile(requestPath, "utf8")),
      );
      const bytes = Buffer.from("60006000f3", "hex");
      await writeFile(
        request.reply_path,
        JSON.stringify({
          ok: true,
          version: "0.9.3",
          bytecode: {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
            hex: bytes.toString("hex"),
          },
          raw: { functions: [] },
        }),
      );
      return spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", `process.stderr.write("x".repeat(${String(size)}))`],
      });
    });
    const result = await provider.inspect({ path, encoding: "hex" });
    if (size === 1048576) {
      if (!result.ok) throw result.error;
      const report = evmInterfaceSchema.parse(result.value.result);
      expect(report.diagnostics.stderr).toHaveLength(size);
      expect(report.diagnostics.truncated).toBe(false);
    } else {
      if (result.ok)
        throw new Error("Expected explicit diagnostic budget failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "unreadable_output",
        details: { captured_output: { truncated: true } },
      });
    }
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it
  .runIf(!unsupportedHost)
  .each([
    "success",
    "format",
    "unsupported",
    "output-limit",
    "wrong-version",
    "wrong-decoded-carrier",
    "broken-reply",
    "invalid-utf8",
    "literal-replacement",
    "bom-reply",
    "out-of-range-body",
  ])(
  "binds source carrier/worker representation and releases owned files: %s",
  async (scenario) => {
    const { path } = await fixture();
    let ownedRoot = "";
    const provider = new EvmoleInterfaceProvider(
      { NODE_OPTIONS: "--inspect=0" },
      async (spawn) => {
        ownedRoot = spawn.cwd ?? "";
        expect(spawn.hostEnvironment?.NODE_OPTIONS).toBeUndefined();
        expect(spawn.arguments).toContain("--as=3221225472:");
        expect(spawn.arguments).toContain("--disable-wasm-trap-handler");
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("request missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        expect(request.encoding).toBe("hex");
        expect(await readFile(request.snapshot_path, "utf8")).toBe(
          "0x60006000f3\n",
        );
        const hex = scenario === "wrong-decoded-carrier" ? "00" : "60006000f3";
        const bytes = Buffer.from(hex, "hex");
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
            scenario === "broken-reply"
              ? "broken"
              : JSON.stringify(
                  ["format", "unsupported", "output-limit"].includes(scenario)
                    ? {
                        ok: false,
                        reason: scenario,
                        message:
                          scenario === "output-limit"
                            ? "Complete interface evidence exceeds the 16 MiB reply budget."
                            : "Malformed hex carrier.",
                      }
                    : {
                        ok: true,
                        version:
                          scenario === "wrong-version" ? "0.0.0" : "0.9.3",
                        bytecode: {
                          sha256: createHash("sha256")
                            .update(bytes)
                            .digest("hex"),
                          bytes: bytes.length,
                          hex,
                        },
                        raw: {
                          functions:
                            scenario === "out-of-range-body"
                              ? [
                                  {
                                    selector: "aabbccdd",
                                    bytecodeOffset: 5,
                                    dispatch: "abi",
                                  },
                                ]
                              : [],
                        },
                      },
                ),
          );
        }
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", 'process.stderr.write("upstream warning")'],
        });
      },
    );
    const result = await provider.inspect({ path, encoding: "hex" });
    if (scenario === "literal-replacement")
      expect(result).toMatchObject({
        ok: false,
        error: { issues: [{ message: "valid �" }] },
      });
    if (scenario === "success") {
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        artifact: { path, encoding: "hex", bytes: 13 },
        bytecode: { hex: "60006000f3", bytes: 5 },
        diagnostics: { stderr: "upstream warning" },
      });
      expect(result.value.rawResult).toEqual({ functions: [] });
    } else
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag:
            scenario === "format" || scenario === "literal-replacement"
              ? "AnalysisInputError"
              : scenario === "unsupported"
                ? "AnalysisUnsupportedTargetError"
                : scenario === "output-limit"
                  ? "AnalysisResourceConstraintError"
                  : "AnalysisOutputError",
        },
      });
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: {
          captured_output: {
            stdout: "",
            stderr: "upstream warning",
            truncated: false,
          },
        },
      });
    expect(await readFile(path, "utf8")).toBe("0x60006000f3\n");
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "retains raw metadata and ordered duplicate selector inferences after worker admission",
  async () => {
    const { path } = await fixture();
    const raw = {
      metadata: {
        bytecodeOffset: 1,
        cborLength: 2,
        entries: [
          {
            key: "reported",
            value: { type: "integer", value: 9007199254740992 },
          },
        ],
      },
      functions: [
        { selector: "aabbccdd", bytecodeOffset: 1, dispatch: "abi" },
        {
          selector: "aabbccdd",
          bytecodeOffset: 2,
          dispatch: "fallback",
          arguments: "uint256",
          stateMutability: "view",
        },
      ],
    };
    let ownedRoot = "";
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      ownedRoot = spawn.cwd ?? "";
      const requestPath = spawn.arguments.at(-1);
      if (requestPath === undefined) throw new Error("request missing");
      const request = requestSchema.parse(
        JSON.parse(await readFile(requestPath, "utf8")),
      );
      const bytes = Buffer.from("60006000f3", "hex");
      await writeFile(
        request.reply_path,
        JSON.stringify({
          ok: true,
          version: "0.9.3",
          bytecode: {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
            hex: bytes.toString("hex"),
          },
          raw,
        }),
      );
      return spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", 'process.stderr.write("upstream warning")'],
      });
    });
    onTestFinished(() => provider.close());
    const result = await provider.inspect({ path, encoding: "hex" });
    if (!result.ok) throw result.error;
    const report = evmInterfaceSchema.parse(result.value.result);
    expect(report.functions).toEqual([
      {
        selector: "0xaabbccdd",
        bytecode_offset: 1,
        dispatch: "abi",
        inferred_arguments: null,
        inferred_state_mutability: null,
      },
      {
        selector: "0xaabbccdd",
        bytecode_offset: 2,
        dispatch: "fallback",
        inferred_arguments: "uint256",
        inferred_state_mutability: "view",
      },
    ]);
    expect(result.value.rawResult).toEqual(raw);
    expect(report.diagnostics).toEqual({
      stdout: "",
      stderr: "upstream warning",
      truncated: false,
    });
    expect(await readFile(path, "utf8")).toBe("0x60006000f3\n");
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each(["cancelled", "output-limit", "process"])(
  "preserves lifecycle failure and independently releases an acquired worker: %s",
  async (scenario) => {
    const { path } = await fixture();
    const controller = new AbortController();
    let pid: number | undefined;
    let ownedRoot = "";
    const provider = new EvmoleInterfaceProvider({}, async (spawn) => {
      ownedRoot = spawn.cwd ?? "";
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: [
          "-e",
          scenario === "cancelled"
            ? 'process.stdout.write("ready\\n");setInterval(()=>undefined,1000)'
            : scenario === "output-limit"
              ? 'process.stdout.write("x".repeat(1048577))'
              : 'process.stderr.write("worker failed");process.exit(7)',
        ],
      });
      pid = launched.process.pid;
      if (scenario === "cancelled") {
        await waitForProviderProcessReady(launched.process);
        setImmediate(() => controller.abort());
      }
      return launched;
    });
    expect(
      await provider.inspect(
        { path, encoding: "hex" },
        { signal: controller.signal },
      ),
    ).toMatchObject({
      ok: false,
      error: {
        _tag:
          scenario === "cancelled"
            ? "AnalysisCancelledError"
            : scenario === "output-limit"
              ? "AnalysisOutputError"
              : "ProviderAdapterError",
      },
    });
    if (pid === undefined) throw new Error("worker not acquired");
    const acquiredPid = pid;
    expect(() => process.kill(acquiredPid, 0)).toThrow();
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "distinguishes unavailable limiter, absent carrier and prelaunch cancellation",
  async () => {
    const { path } = await fixture();
    expect(
      await new EvmoleInterfaceProvider({
        REA_EVM_PRLIMIT_COMMAND: path + ".absent",
      }).inspect({ path, encoding: "hex" }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
    expect(
      await new EvmoleInterfaceProvider({}).inspect({
        path: path + ".absent",
        encoding: "raw",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
    const controller = new AbortController();
    controller.abort();
    expect(
      await new EvmoleInterfaceProvider({}).inspect(
        { path, encoding: "raw" },
        { signal: controller.signal },
      ),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
  },
);
it.runIf(!unsupportedHost)(
  "classifies selected carrier path-resolution errnos as invalid input",
  async () => {
    const { root } = await fixture();
    const loop = join(root, "loop");
    await symlink("loop", loop);
    const cases = [
      { code: "ELOOP", path: join(loop, "carrier.bin") },
      { code: "ENAMETOOLONG", path: join(root, "x".repeat(256)) },
    ] as const;
    const service = new EvmInterfaceService(new EvmoleInterfaceProvider({}));
    try {
      for (const { code, path } of cases) {
        const result = await service.inspect({ path, encoding: "raw" });
        if (result.ok) throw new Error(`Expected ${code} path failure`);
        expect(result.error._tag).toBe("AnalysisInputError");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["path"],
                reason: "invalid_value",
                message: expect.stringContaining(code),
              },
            ],
          },
        });
      }
    } finally {
      await service.close();
    }
  },
);

it.runIf(unsupportedHost)(
  "reports unverified host coverage before acquiring a provider",
  async () => {
    expect(
      await new EvmoleInterfaceProvider({}).inspect({
        path: "/selected.hex",
        encoding: "hex",
      }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
  },
);

it.runIf(!unsupportedHost)(
  "preserves actual snapshot-write cancellation and root cleanup",
  async () => {
    const { path } = await fixture();
    const controller = new AbortController();
    let ownedRoot = "";
    const provider = new EvmoleInterfaceProvider(
      {},
      () => {
        throw new Error("must not launch worker");
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-evm-cancel-",
        });
        ownedRoot = root.path;
        controller.abort();
        return root;
      },
    );
    expect(
      await provider.inspect(
        { path, encoding: "hex" },
        { signal: controller.signal },
      ),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost)(
  "reports private storage denial without claiming selected carrier read denial",
  async () => {
    const { path } = await fixture();
    const provider = new EvmoleInterfaceProvider({}, undefined, () =>
      Promise.reject(
        Object.assign(new Error("private root denied"), { code: "EACCES" }),
      ),
    );
    expect(await provider.inspect({ path, encoding: "hex" })).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: { phase: "worker", reason: "private root denied" },
      },
    });
  },
);

it.runIf(!unsupportedHost)(
  "retains original format failure when owned-root cleanup fails",
  async () => {
    const { path, root } = await fixture();
    const provider = new EvmoleInterfaceProvider(
      {},
      async (spawn) => {
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("request missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: false,
            reason: "format",
            message: "Odd selected hex.",
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", "process.exit(0)"],
        });
      },
      () =>
        Promise.resolve({
          path: root,
          close: () => Promise.reject(new Error("root cleanup failed")),
        }),
    );
    expect(await provider.inspect({ path, encoding: "hex" })).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: [root],
        diagnostics: {
          reason: "root cleanup failed",
          previous_error: { category: "invalid_input" },
        },
      },
    });
  },
);

it
  .runIf(!unsupportedHost)
  .each([
    "success",
    "late-cancellation",
    "cleanup-failure",
    "cancelled-cleanup-failure",
  ])(
  "retains captured warnings after a successful worker: %s",
  async (scenario) => {
    const { path } = await fixture();
    const source = await readFile(path);
    const controller = new AbortController();
    const reason = { requested: "stop during root removal" };
    let denyClose =
      scenario === "cleanup-failure" ||
      scenario === "cancelled-cleanup-failure";
    let ownedRoot = "";
    const provider = new EvmoleInterfaceProvider(
      {},
      async (spawn) => {
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("request missing");
        const request = requestSchema.parse(
          JSON.parse(await readFile(requestPath, "utf8")),
        );
        const bytes = Buffer.from("60006000f3", "hex");
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: true,
            version: "0.9.3",
            bytecode: {
              sha256: createHash("sha256").update(bytes).digest("hex"),
              bytes: bytes.length,
              hex: bytes.toString("hex"),
            },
            raw: { functions: [] },
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", 'process.stderr.write("upstream warning")'],
        });
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-evm-late-",
        });
        ownedRoot = root.path;
        return {
          path: root.path,
          close: async () => {
            await root.close();
            if (
              scenario === "late-cancellation" ||
              scenario === "cancelled-cleanup-failure"
            )
              controller.abort(reason);
            if (denyClose) throw new Error("reported cleanup failure");
          },
        };
      },
    );
    onTestFinished(async () => {
      denyClose = false;
      await provider.close();
    });
    const result = await provider.inspect(
      { path, encoding: "hex" },
      { signal: controller.signal },
    );
    if (scenario === "success") {
      expect(result.ok).toBe(true);
      await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    if (result.ok) throw new Error("Expected lifecycle failure");
    const output = { stdout: "", stderr: "upstream warning", truncated: false };
    expect(projectAnalysisError(result.error)).toMatchObject({
      category:
        scenario === "late-cancellation" ||
        scenario === "cancelled-cleanup-failure"
          ? "cancelled"
          : "execution_failure",
      details:
        scenario === "late-cancellation"
          ? { captured_output: output }
          : { diagnostics: { captured_output: output } },
    });
    const evidence = parseEvidence(result.error.partialObservation);
    expect(evidence.subject?.local_path).toBe(path);
    expect(evidence.subject?.digest.sha256).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    expect(Buffer.compare(await readFile(path), source)).toBe(0);
    expect(evidence).toMatchObject({
      operation: "inspect_evm_interface",
      parameters: { path, encoding: "hex" },
      provider: { id: "evmole-interface" },
      raw_result: { functions: [] },
      normalized_result: {
        artifact: { path, encoding: "hex" },
        bytecode: { hex: "60006000f3", bytes: 5 },
        diagnostics: output,
      },
    });
    expect(evidence.limitations.length).toBeGreaterThan(0);
    if (scenario === "late-cancellation")
      expect(result.error.cause).toBe(reason);
    else expect(result.error.cleanupIncomplete).toBe(true);
    if (scenario === "cancelled-cleanup-failure") {
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
      denyClose = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).category).toBe("cancelled");
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
    }
    const forwarded = await new EvmInterfaceService({
      inspect: async () => result,
    }).inspect({ path, encoding: "hex" });
    expect(forwarded).toBe(result);
    await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(!unsupportedHost).each(["directory", "missing-interpreter"])(
  "identifies configured limiter constraints without blaming the carrier: %s",
  async (scenario) => {
    const { path, root } = await fixture();
    const limiter =
      scenario === "directory" ? root : join(root, "broken-limiter");
    if (scenario === "missing-interpreter")
      await writeFile(limiter, "#!/rea-missing-limiter-interpreter\n", {
        mode: 0o700,
      });
    let ownedRoot: string | undefined;
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: limiter },
      undefined,
      async () => {
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "rea-evm-limiter-",
        });
        ownedRoot = runtime.path;
        return runtime;
      },
    );
    const result = await provider.inspect({ path, encoding: "hex" });
    if (result.ok) throw new Error("Expected unavailable limiter");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      category: "unsupported_provider",
      details: { provider_id: "evmole-interface" },
    });
    if (scenario === "directory")
      expect(result.error).toMatchObject({
        reason: "prlimit_not_file",
        diagnostics: {
          limiter_path: limiter,
          code: "prlimit_not_file",
        },
      });
    else expect(result.error.message).toContain(limiter);
    if (ownedRoot !== undefined)
      await expect(access(ownedRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path, "utf8")).toBe("0x60006000f3\n");
  },
);
