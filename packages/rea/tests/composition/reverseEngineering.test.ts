import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { digestFile } from "../../src/application/reverse/ReverseEngineeringService.js";
import { TestReverseEngineeringService as ReverseEngineeringService } from "../support/reverseEngineeringService.js";
import { providerSnapshot } from "../support/reverseEngineeringCompositionFixtures.js";
import { createReverseEngineeringService } from "../../src/composition/reverseEngineering.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { AnalysisCancelledError } from "../../src/domain/analysisErrorCore.js";
import { REVERSE_ENGINEERING_TOOL_CONTRACTS } from "../../src/contracts/reverseEngineeringToolContracts.js";

it("documents the shared combined capture limit for both command tools", () => {
  expect(REVERSE_ENGINEERING_TOOL_CONTRACTS.map(({ name }) => name)).toEqual(
    expect.arrayContaining(["inspect_with_objdump", "execute_rizin_command"]),
  );
  for (const contract of REVERSE_ENGINEERING_TOOL_CONTRACTS)
    expect(contract.description).toContain("shared 16 MiB combined limit");
  expect(
    REVERSE_ENGINEERING_TOOL_CONTRACTS.find(
      ({ name }) => name === "inspect_with_objdump",
    )?.description,
  ).toContain("does not follow local debug links by default");
  for (const contract of REVERSE_ENGINEERING_TOOL_CONTRACTS)
    expect(contract.description).toContain("command_timeout_ms");
});

describe("reverse engineering command services", () => {
  it("uses compatible local DWARF link flags and disables debuginfod through the environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-reverse-tools-"));
    const path = join(directory, "fixture.bin");
    await writeFile(path, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const calls: {
      command: string;
      args: readonly string[];
      env: NodeJS.ProcessEnv | undefined;
    }[] = [];
    const service = new ReverseEngineeringService({
      environment: {
        REA_OBJDUMP_COMMAND: "/tools/objdump",
        DEBUGINFOD_URLS: "https://debug.example.invalid",
      },
      run: async (command, args, options) => {
        calls.push({ command, args, env: options?.env });
        return { stdout: "DWARF output\n", stderr: "diagnostic\n" };
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "dwarf",
        follow_debug_links: true,
      });
      if (!result.ok) throw result.error;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(calls).toEqual([
        {
          command: resolve("/tools/objdump"),
          args: ["-W", "-WK", path],
          env: expect.objectContaining({ DEBUGINFOD_URLS: "" }),
        },
      ]);
      expect(result.value.raw_result).toMatchObject({
        stdout: "DWARF output\n",
        stderr: "diagnostic\n",
        exit_code: 0,
        output_truncated: false,
      });
      expect(result.value.provider.id).toBe("gnu.objdump");
      expect(result.value.subject?.local_path).toBe(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects non-regular artifacts without launching the provider", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-reverse-special-file-"),
    );
    let invoked = false;
    const service = new ReverseEngineeringService({
      run: async () => {
        invoked = true;
        return { stdout: "", stderr: "" };
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path: directory,
        operation: "file_headers",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.cause).toMatchObject({
          code: "EINVAL",
          message: "Artifact digest requires a regular file",
        });
      expect(invoked).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("classifies captured spawn failures instead of reporting provider evidence", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rea-objdump-spawn-failure-"),
    );
    const path = join(directory, "fixture.bin");
    await writeFile(path, "fixture");
    const service = new ReverseEngineeringService({
      run: async () => {
        const failure = Object.assign(new Error("not found"), {
          stdout: "",
          stderr: "",
          code: "ENOENT",
          signal: null,
          killed: false,
        });
        throw failure;
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "file_headers",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
        expect(result.error.message).toContain("ENOENT");
        expect(result.error.message).not.toContain("stdout");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks max-buffer termination as unknown completion while retaining output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-objdump-max-buffer-"));
    const path = join(directory, "fixture.bin");
    await writeFile(path, "fixture");
    const service = new ReverseEngineeringService({
      run: async () => {
        throw Object.assign(new Error("max buffer exceeded"), {
          stdout: "captured partial output",
          stderr: "",
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          signal: "SIGTERM",
          killed: true,
        });
      },
    });

    try {
      const result = await service.executeRizinCommand({
        path,
        command: "wx 00 @ 0",
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.raw_result).toMatchObject({
          stdout: "captured partial output",
          exit_code: null,
          output_truncated: true,
          completion_status: "unknown",
        });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it.each([
  ["file_headers", true, undefined, ["-f"], false],
  ["section_headers", true, undefined, ["-h"], false],
  ["symbols", true, undefined, ["-t"], false],
  ["relocations", true, undefined, ["-r"], false],
  ["disassemble", true, undefined, ["-d"], false],
  ["disassemble_all", true, undefined, ["-D"], false],
  [
    "disassemble",
    true,
    "sample_symbol",
    ["--disassemble=sample_symbol"],
    false,
  ],
  ["dwarf", true, undefined, ["-W", "-WK"], true],
  ["dwarf", false, undefined, ["-W", "-WN"], false],
] as const)(
  "scopes the debug-link limitation to %s when following links is %s",
  async (operation, followDebugLinks, symbol, flags, warns) => {
    const directory = await mkdtemp(join(tmpdir(), "rea-objdump-limitations-"));
    const path = join(directory, "fixture.bin");
    await writeFile(path, "inert artifact");
    const calls: (readonly string[])[] = [];
    const service = new ReverseEngineeringService({
      environment: { REA_OBJDUMP_COMMAND: "/tools/objdump" },
      run: async (_command, args) => {
        calls.push(args);
        return { stdout: "captured stdout", stderr: "captured stderr" };
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation,
        follow_debug_links: followDebugLinks,
        ...(symbol === undefined ? {} : { symbol }),
      });
      if (!result.ok) throw result.error;
      expect(calls).toEqual([[...flags, path]]);
      expect(result.value.parameters).toMatchObject({
        path,
        operation,
        follow_debug_links: followDebugLinks,
        ...(symbol === undefined ? {} : { symbol }),
      });
      expect(result.value.parameters.command_arguments).toEqual(calls[0]);
      expect(result.value.raw_result).toMatchObject({
        stdout: "captured stdout",
        stderr: "captured stderr",
        exit_code: 0,
        output_truncated: false,
        completion_status: "complete",
      });
      expect(
        result.value.limitations.some((text) =>
          text.startsWith("DWARF output"),
        ),
      ).toBe(warns);
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("uses one selected environment snapshot for provider selection and execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-environment-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const selectedEnvironment = {
    REA_RIZIN_COMMAND: "/selected/rizin",
    PATH: "/selected/bin",
    SELECTED_VALUE: "captured",
  };
  const calls: { command: string; env: NodeJS.ProcessEnv | undefined }[] = [];
  const service = createReverseEngineeringService(selectedEnvironment, {
    run: async (command, _args, options) => {
      calls.push({ command, env: options?.env });
      return { stdout: "headers", stderr: "" };
    },
  });
  selectedEnvironment.REA_RIZIN_COMMAND = "/changed/rizin";
  selectedEnvironment.SELECTED_VALUE = "changed after construction";

  try {
    const result = await service.executeRizinCommand({
      path,
      command: "iI",
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: resolve("/selected/rizin"),
        env: {
          REA_RIZIN_COMMAND: "/selected/rizin",
          PATH: "/selected/bin",
          SELECTED_VALUE: "captured",
        },
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("marks signal-terminated provider commands as unknown completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-signal-exit-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  let invocation = 0;
  const service = new ReverseEngineeringService({
    run: async () => {
      invocation += 1;
      if (invocation === 1)
        throw Object.assign(new Error("provider killed by signal"), {
          stdout: "partial output",
          stderr: "",
          code: null,
          signal: "SIGKILL",
          killed: true,
        });
      throw Object.assign(new Error("provider exited with status 2"), {
        stdout: "ordinary partial output",
        stderr: "ordinary diagnostic",
        code: 2,
        signal: null,
        killed: false,
      });
    },
  });

  try {
    const signaled = await service.executeRizinCommand({
      path,
      command: "wx 00 @ 0",
    });
    expect(signaled.ok).toBe(true);
    if (signaled.ok) {
      expect(signaled.value.raw_result).toMatchObject({
        stdout: "partial output",
        exit_code: null,
        signal: "SIGKILL",
        completion_status: "unknown",
      });
      expect(signaled.value.limitations.join(" ")).toContain("signal");
    }
    const ordinaryExit = await service.executeRizinCommand({
      path,
      command: "iI",
    });
    expect(ordinaryExit.ok).toBe(true);
    if (ordinaryExit.ok) {
      expect(ordinaryExit.value.raw_result).toMatchObject({
        stdout: "ordinary partial output",
        exit_code: 2,
        signal: null,
        completion_status: "complete",
      });
      expect(ordinaryExit.value.limitations.join(" ")).not.toContain(
        "terminated by signal",
      );
      expect(ordinaryExit.value.limitations).toContain(
        "Rizin commands and retained plugins may read files or access network resources outside the selected artifact; those external inputs are not bound to Evidence.",
      );
      expect(ordinaryExit.value.limitations).toHaveLength(4);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Rizin command service", () => {
  it("defaults Rizin to plain presentation and preserves caller-selected colour on nonzero exits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-rizin-"));
    const path = join(directory, "fixture with spaces.bin");
    const callerPath = relative(process.cwd(), path);
    await writeFile(path, "fixture");
    const calls: { command: string; args: readonly string[] }[] = [];
    const service = new ReverseEngineeringService({
      environment: { REA_RIZIN_COMMAND: "/tools/rizin" },
      run: async (command, args) => {
        calls.push({ command, args });
        const failure = new Error("command exited with status 2") as Error & {
          stdout: string;
          stderr: string;
          code: number;
          signal: null;
          killed: boolean;
        };
        Object.assign(failure, {
          stdout: "\u001b[31mpartial data\u001b[0m\n",
          stderr: "command error",
          code: 2,
          signal: null,
          killed: false,
        });
        throw failure;
      },
    });

    try {
      const command = "e scr.color=1;pd 1";
      const result = await service.executeRizinCommand({
        path: callerPath,
        command,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lookupPath = result.value.subject?.local_path;
      expect(isAbsolute(lookupPath ?? "")).toBe(true);
      expect(result.value.subject?.digest.sha256).toBe(
        createHash("sha256").update("fixture").digest("hex"),
      );
      expect(calls).toEqual([
        {
          command: resolve("/tools/rizin"),
          args: ["-N", "-q", "-e", "scr.color=0", "-c", command, lookupPath],
        },
      ]);
      expect(result.value.raw_result).toMatchObject({
        stdout: "\u001b[31mpartial data\u001b[0m\n",
        stderr: "command error",
        exit_code: 2,
        completion_status: "complete",
      });
      expect(result.value.limitations.join(" ")).not.toContain(
        "terminated by signal",
      );
      expect(result.value.normalized_result).toMatchObject({
        stdout: "\u001b[31mpartial data\u001b[0m\n",
      });
      expect(result.value.limitations).toContain(
        "Rizin commands and retained plugins may read files or access network resources outside the selected artifact; those external inputs are not bound to Evidence.",
      );
      expect(result.value.limitations).toHaveLength(4);
      expect(result.value.parameters).toMatchObject({
        path: callerPath,
        command,
        provider_executable: resolve("/tools/rizin"),
      });
      expect(result.value.parameters.command_arguments).toEqual(calls[0]?.args);
      expect(result.value.provider.id).toBe("rizin");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects multiline Rizin command input before launching the provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-rizin-input-"));
    const path = join(directory, "fixture.bin");
    await writeFile(path, "fixture");
    let invoked = false;
    const service = new ReverseEngineeringService({
      run: async () => {
        invoked = true;
        return { stdout: "", stderr: "" };
      },
    });

    try {
      const result = await service.executeRizinCommand({
        path,
        command: "iI\nq",
      });
      expect(result.ok).toBe(false);
      expect(invoked).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves pre and post artifact digests when an unrestricted Rizin command changes the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-rizin-mutation-"));
    const path = join(directory, "fixture.bin");
    await writeFile(path, "before");
    const service = new ReverseEngineeringService({
      run: async () => {
        await writeFile(path, "after");
        return { stdout: "changed", stderr: "" };
      },
    });

    try {
      const result = await service.executeRizinCommand({
        path,
        command: "wx 00 @ 0",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.subject?.digest.sha256).toBe(
        createHash("sha256").update("before").digest("hex"),
      );
      expect(result.value.raw_result).toMatchObject({
        artifact_sha256_after: createHash("sha256")
          .update("after")
          .digest("hex"),
        artifact_changed: true,
      });
      expect(result.value.limitations).toContain(
        "The provider command may have changed the artifact while analysis was running; pre-run and post-run digests are both reported.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("retains partial Evidence when a provider command times out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-rizin-timeout-partial-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "before");
  const service = new ReverseEngineeringService({
    run: async () => {
      const failure = Object.assign(new Error("timeout"), {
        stdout: "captured before timeout",
        stderr: "still running",
        code: "ETIMEDOUT",
        signal: "SIGTERM",
        killed: true,
      });
      throw failure;
    },
  });

  try {
    const result = await service.executeRizinCommand({
      path,
      command: "wx 00 @ 0",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisTimeoutError");
      expect(JSON.stringify(result.error.partialObservation)).not.toContain(
        "command_timeout_ms",
      );
      expect(result.error.partialObservation).toMatchObject({
        operation: "execute_rizin_command",
        raw_result: {
          stdout: "captured before timeout",
          stderr: "still running",
          completion_status: "unknown",
          signal: "SIGTERM",
          artifact_sha256_after: expect.any(String),
        },
      });
      expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
        "captured before timeout",
      );
      const projected = projectAnalysisError(result.error);
      expect(projected.message).toContain("command_timeout_ms");
      expect(projected.message).toContain("120000 ms");
      expect(projected.remediation.action).toContain("120000");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps a selected architecture deadline on Evidence", async () => {
  const service = new ReverseEngineeringService({
    run: async () => ({ stdout: "elf64-x86-64\n", stderr: "" }),
  });
  const selected = await service.inspectWithObjdump({
    operation: "architectures",
    command_timeout_ms: 5_000,
  });
  expect(selected.ok).toBe(true);
  if (!selected.ok) return;
  expect(selected.value.parameters).toMatchObject({
    operation: "architectures",
    command_timeout_ms: 5_000,
  });
  expect(selected.value.parameters).not.toHaveProperty("path");

  const omitted = await service.inspectWithObjdump({
    operation: "architectures",
  });
  expect(omitted.ok).toBe(true);
  if (!omitted.ok) return;
  expect(omitted.value.parameters).not.toHaveProperty("command_timeout_ms");
});

it("shares one preflight deadline across stat and digest", async () => {
  const stat = async (): Promise<Stats> => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { isFile: () => true } as Stats;
  };
  const open = () => {
    const stream = new PassThrough();
    return stream as unknown as ReturnType<
      typeof import("node:fs").createReadStream
    >;
  };
  const started = performance.now();
  await expect(
    digestFile("/tmp/rea-preflight-deadline", undefined, stat, 200, open),
  ).rejects.toMatchObject({ code: "ETIMEDOUT" });
  expect(performance.now() - started).toBeLessThan(280);
});

it("retains an explicit null reason when digest admission is already cancelled", async () => {
  const controller = new AbortController();
  controller.abort(null);
  await expect(
    digestFile("/tmp/rea-cancelled-digest", controller.signal),
  ).rejects.toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: null,
  });
});

it("retains an object reason when cancellation interrupts an active digest stream", async () => {
  const controller = new AbortController();
  const reason = { source: "caller digest cancellation" };
  const stat = async (): Promise<Stats> => ({ isFile: () => true }) as Stats;
  const open = () => {
    const stream = new PassThrough();
    queueMicrotask(() => controller.abort(reason));
    return stream as unknown as ReturnType<
      typeof import("node:fs").createReadStream
    >;
  };
  const failure: unknown = await digestFile(
    "/tmp/rea-cancelled-stream",
    controller.signal,
    stat,
    1_000,
    open,
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AnalysisCancelledError);
  if (!(failure instanceof AnalysisCancelledError))
    throw new Error("Expected digest cancellation");
  expect(failure.cause).toBe(reason);
});

it("forwards selected and omitted deadlines through the production command runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-owned-timeout-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "before");
  const timeouts: (number | null)[] = [];
  const service = new ReverseEngineeringService({
    runOwned: async (_spawn, limits) => {
      timeouts.push(limits.timeoutMs);
      return providerSnapshot();
    },
  });
  try {
    const selected = await service.executeRizinCommand({
      path,
      command: "i",
      command_timeout_ms: 5_000,
    });
    expect(selected.ok).toBe(true);
    const omitted = await service.executeRizinCommand({
      path,
      command: "i",
    });
    expect(omitted.ok).toBe(true);
    expect(timeouts).toEqual([5_000, 120_000]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("applies a caller-selected one-shot deadline on the next call", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rea-rizin-timeout-selected-"),
  );
  const path = join(directory, "fixture.bin");
  await writeFile(path, "before");
  const timeouts: number[] = [];
  const service = new ReverseEngineeringService({
    run: async (_command, _args, options) => {
      timeouts.push(options?.timeout ?? -1);
      throw Object.assign(new Error("timeout"), {
        stdout: "",
        stderr: "",
        code: "ETIMEDOUT",
        signal: "SIGTERM",
        killed: true,
      });
    },
  });

  try {
    const selected = await service.executeRizinCommand({
      path,
      command: "i",
      command_timeout_ms: 5_000,
    });
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.error).toMatchObject({ timeoutMs: 5_000 });
      expect(projectAnalysisError(selected.error).message).toContain("5000 ms");
      expect(selected.error.partialObservation).toMatchObject({
        parameters: { command_timeout_ms: 5_000 },
      });
    }
    expect(timeouts).toEqual([5_000]);
    for (const command_timeout_ms of [0, 2_147_483_648]) {
      const rejected = await service.executeRizinCommand({
        path,
        command: "i",
        command_timeout_ms,
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error._tag).toBe("AnalysisInputError");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves raw byte counts when cancellation rejects invalid UTF-8 output", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rea-rizin-abort-invalid-utf8-"),
  );
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const controller = new AbortController();
  const failure = Object.assign(new Error("The operation was aborted"), {
    stdout: "�",
    stderr: "€",
    stdoutBytes: 1,
    stderrBytes: 3,
    code: "ABORT_ERR",
    signal: null,
    killed: true,
  });
  const service = new ReverseEngineeringService({
    run: async () => {
      controller.abort();
      throw failure;
    },
  });

  try {
    const result = await service.executeRizinCommand(
      { path, command: "iI" },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.capturedOutput).toMatchObject({
        stdout: "�",
        stderr: "€",
        stdout_bytes: 1,
        stderr_bytes: 3,
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves provider facts when cancellation interrupts the post-run digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-rizin-digest-cancel-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const controller = new AbortController();
  const service = new ReverseEngineeringService({
    run: async () => {
      controller.abort();
      return {
        stdout: "�",
        stderr: "�",
        stdoutInvalidUtf8: true,
        stderrInvalidUtf8: true,
        stdoutBytes: 1,
        stderrBytes: 1,
      };
    },
  });

  try {
    const result = await service.executeRizinCommand(
      { path, command: "iI" },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.capturedOutput).toMatchObject({
        stdout: "�",
        stderr: "�",
        stdout_bytes: 1,
        stderr_bytes: 1,
        exit_code: 0,
        signal: null,
      });
      expect(result.error.partialObservation).toMatchObject({
        raw_result: {
          stdout: "�",
          exit_code: null,
          completion_status: "unknown",
          artifact_sha256_after: null,
        },
        limitations: expect.arrayContaining([
          expect.stringContaining("cancellation interrupted the digest"),
        ]),
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("marks signal-terminated provider output incomplete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-rizin-signal-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "fixture");
  const service = new ReverseEngineeringService({
    run: async () => {
      throw Object.assign(new Error("terminated"), {
        stdout: "partial",
        stderr: "",
        code: null,
        signal: "SIGSEGV",
        killed: false,
      });
    },
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.raw_result).toMatchObject({
        signal: "SIGSEGV",
        exit_code: null,
        completion_status: "unknown",
      });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
