import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { EventEmitter } from "node:events";
import { join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { createGhidraTestRuntime } from "../../../fixtures/ghidraRuntime.js";
import type { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import type {
  OwnedProviderProcessSpawnOptions,
  ProviderProcessHandle,
  SpawnedOwnedProviderProcess,
} from "../../../../src/process/ProviderProcess.js";

import {
  ghidraHeadlessArguments,
  ghidraHeadlessCommand,
  GhidraHeadlessLauncher,
} from "../../../../src/ghidra/GhidraLauncher.js";

const fixturePath = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../../../fixtures/captureGhidraLaunch.cmd"
      : "../../../fixtures/captureGhidraLaunch.mjs",
    import.meta.url,
  ),
);
const runtimes: PrivateRuntimeRoot[] = [];

const launchCaptureSchema = z.object({
  arguments: z.array(z.string()),
  environment: z.record(z.string(), z.string()),
  descriptor_mode: z.number().int(),
  descriptor_has_token: z.boolean(),
});

const expectOptions = (
  arguments_: readonly string[],
  options: readonly (readonly [string, string])[],
): void => {
  for (const [flag, value] of options) {
    const index = arguments_.indexOf(flag);
    expect(index, flag).toBeGreaterThanOrEqual(0);
    expect(arguments_[index + 1], flag).toBe(value);
  }
};

const expectIsolatedEnvironment = (
  environment: Record<string, string>,
  runtimeRoot: string,
  javaHome: string,
) => {
  expect(environment).toMatchObject({
    HOME: join(runtimeRoot, "home"),
    ...(process.platform === "win32"
      ? {
          USERPROFILE: join(runtimeRoot, "home"),
          APPDATA: join(runtimeRoot, "config"),
          LOCALAPPDATA: join(runtimeRoot, "cache"),
          TEMP: join(runtimeRoot, "tmp"),
          TMP: join(runtimeRoot, "tmp"),
        }
      : {}),
    TMPDIR: join(runtimeRoot, "tmp"),
    XDG_CACHE_HOME: join(runtimeRoot, "cache"),
    XDG_CONFIG_HOME: join(runtimeRoot, "config"),
    XDG_DATA_HOME: join(runtimeRoot, "data"),
    GHIDRA_JAVA_OPTIONS: "",
    JAVA_TOOL_OPTIONS: "",
    JDK_JAVA_OPTIONS:
      process.platform === "win32"
        ? `"-Duser.home=${join(runtimeRoot, "home")}" "-Djava.io.tmpdir=${join(runtimeRoot, "tmp")}" "-XX:-UsePerfData"`
        : "",
    _JAVA_OPTIONS: "",
    JAVA_HOME: javaHome,
    REA_PROCESS_RUN_ID: "d6fcbb66-e829-4ff6-a535-0035aec63139",
  });
  expect(environment.PATH).toBe(
    `${join(javaHome, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
  );
};

beforeAll(async () => {
  if (process.platform !== "win32") await chmod(fixturePath, 0o755);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("Ghidra COM loader", () => {
  it("loads explicit COM at its PSP-relative entry before auto-analysis", () => {
    const arguments_ = ghidraHeadlessArguments({
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target.com",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
      dosCom: true,
    });
    expectOptions(arguments_, [
      ["-loader", "BinaryLoader"],
      ["-loader-baseAddr", "1000:0100"],
      ["-processor", "x86:LE:16:Real Mode"],
      ["-cspec", "default"],
    ]);
    const prepare = arguments_.indexOf("-preScript");
    expect(arguments_[prepare + 1]).toBe(
      join("/package/bridge", "ReaGhidraPrepareCom.java"),
    );
    expect(prepare).toBeLessThan(arguments_.indexOf("-postScript"));
    expect(arguments_).toContain("-readOnly");
    expect(arguments_).toContain("-deleteProject");
  });
});

describe("Ghidra raw-binary loader", () => {
  it("loads caller-supplied architecture and entry before auto-analysis", () => {
    const arguments_ = ghidraHeadlessArguments({
      projectRoot: "/tmp/project",
      targetPath: "/tmp/ecu.bin",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
      rawBinary: {
        languageId: "ARM:LE:32:v7",
        compilerSpecId: "default",
        baseAddr: "0x8000000",
      },
    });
    expectOptions(arguments_, [
      ["-loader", "BinaryLoader"],
      ["-loader-baseAddr", "0x8000000"],
      ["-processor", "ARM:LE:32:v7"],
      ["-cspec", "default"],
    ]);
    const prepare = arguments_.indexOf("-preScript");
    expect(arguments_[prepare + 1]).toBe(
      join("/package/bridge", "ReaGhidraPrepareRaw.java"),
    );
    expect(arguments_[prepare + 2]).toBe("ARM:LE:32:v7");
    expect(arguments_[prepare + 3]).toBe("0x8000000");
    expect(prepare).toBeLessThan(arguments_.indexOf("-postScript"));
    expect(arguments_).toContain("-readOnly");
    expect(arguments_).toContain("-deleteProject");
  });
});

describe("Ghidra GameCube DOL loader", () => {
  const dolBase = {
    platform: "darwin" as const,
    projectRoot: "/tmp/project",
    targetPath: "/tmp/main.dol",
    bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
    descriptorPath: "/tmp/session.json",
    ghidraLogPath: "/tmp/ghidra.log",
    scriptLogPath: "/tmp/script.log",
  };

  it("loads the DOL as a zero-based BinaryLoader block with the stock language", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...dolBase,
      gamecubeDol: {
        languageId: "PowerPC:BE:32:default",
        sectionFilePath: "/tmp/gamecube-dol-sections.txt",
      },
    });
    expectOptions(arguments_, [
      ["-loader", "BinaryLoader"],
      ["-loader-baseAddr", "0x0"],
      ["-processor", "PowerPC:BE:32:default"],
    ]);
    expect(arguments_).not.toContain("-cspec");
    expect(arguments_.indexOf("-loader")).toBeGreaterThan(
      arguments_.indexOf("-import"),
    );
  });

  it("passes an optional compiler spec only when the override carries one", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...dolBase,
      gamecubeDol: {
        languageId: "PowerPC:BE:32:Gekko_Broadway",
        compilerSpecId: "default",
        sectionFilePath: "/tmp/gamecube-dol-sections.txt",
      },
    });
    expectOptions(arguments_, [
      ["-processor", "PowerPC:BE:32:Gekko_Broadway"],
      ["-cspec", "default"],
    ]);
  });

  it("runs the section pre-script with its section file after the loader", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...dolBase,
      gamecubeDol: {
        languageId: "PowerPC:BE:32:default",
        sectionFilePath: "/tmp/gamecube-dol-sections.txt",
      },
    });
    const prepare = arguments_.indexOf(
      "/package/bridge/ReaGhidraPrepareDol.java",
    );
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(arguments_[prepare - 1]).toBe("-preScript");
    expect(arguments_[prepare + 1]).toBe("/tmp/gamecube-dol-sections.txt");
    expect(prepare).toBeLessThan(arguments_.indexOf("-postScript"));
    expect(arguments_).not.toContain(
      "/package/bridge/ReaGhidraPrepareRaw.java",
    );
    expect(arguments_).not.toContain(
      "/package/bridge/ReaGhidraPrepareCom.java",
    );
    expect(arguments_).toContain("-readOnly");
    expect(arguments_).toContain("-deleteProject");
  });

  it.each([
    ["PSP", { psp: true }],
    ["DOS MZ", { dosMz: true }],
    ["DOS COM", { dosCom: true }],
    ["MIPS soft-float", { mipsSoftFloat: true }],
    [
      "RISC-V calling convention",
      { riscvCallingConvention: "ilp32-prototype-v1" },
    ],
    [
      "raw binary",
      {
        rawBinary: {
          languageId: "ARM:LE:32:v7",
          compilerSpecId: "default",
          baseAddr: "0x8000000",
        },
      },
    ],
    [
      "language override",
      { languageOverride: { languageId: "PowerPC:BE:32:Gekko_Broadway" } },
    ],
  ] as const)("refuses a DOL import combined with %s", (_label, conflict) => {
    expect(() =>
      ghidraHeadlessArguments({
        ...dolBase,
        ...conflict,
        gamecubeDol: {
          languageId: "PowerPC:BE:32:default",
          sectionFilePath: "/tmp/gamecube-dol-sections.txt",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: "GhidraAdmissionError",
        code: "gamecube_dol_combined",
      }),
    );
  });
});

describe("Ghidra headless launcher", () => {
  it("forces the admitted real-mode language and loader for DOS MZ", () => {
    const arguments_ = ghidraHeadlessArguments({
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
      dosMz: true,
    });
    expectOptions(arguments_, [
      ["-loader", "MzLoader"],
      ["-processor", "x86:LE:16:Real Mode"],
      ["-cspec", "default"],
    ]);
    expect(arguments_).toContain("-readOnly");
    expect(arguments_).toContain("-deleteProject");
  });
  it("builds a read-only ephemeral import with its bridge descriptor", () => {
    const arguments_ = ghidraHeadlessArguments({
      platform: "darwin",
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
    });
    expect(arguments_.slice(0, 2)).toEqual(["/tmp/project", "rea-project"]);
    expectOptions(arguments_, [
      ["-import", "/tmp/target"],
      ["-log", "/tmp/ghidra.log"],
      ["-scriptlog", "/tmp/script.log"],
      ["-scriptPath", "/package/bridge"],
      ["-postScript", "/package/bridge/ReaGhidraNoReturnFix.java"],
    ]);
    // The no-return repair must finish before the bridge starts serving.
    const fix = arguments_.indexOf("/package/bridge/ReaGhidraNoReturnFix.java");
    const bridge = arguments_.indexOf("/package/bridge/ReaGhidraBridge.java");
    expect(fix).toBeLessThan(bridge);
    expect(arguments_[bridge + 1]).toBe("/tmp/session.json");
    expect(arguments_).toContain("-readOnly");
    expect(arguments_).toContain("-deleteProject");
  });
  it("remaps soft-float storage after the no-return fix and before the bridge", () => {
    const base = {
      platform: "linux" as const,
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
    };
    const soft = "/package/bridge/ReaGhidraMipsSoftFloat.java";
    expect(ghidraHeadlessArguments(base)).not.toContain(soft);
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      mipsSoftFloat: true,
    });
    expect(arguments_[arguments_.indexOf(soft) - 1]).toBe("-postScript");
    expect(
      arguments_.indexOf("/package/bridge/ReaGhidraNoReturnFix.java"),
    ).toBeLessThan(arguments_.indexOf(soft));
    expect(arguments_.indexOf(soft)).toBeLessThan(
      arguments_.indexOf("/package/bridge/ReaGhidraBridge.java"),
    );
    for (const conflict of [
      { psp: true as const },
      { dosMz: true as const },
      { dosCom: true as const },
      {
        rawBinary: {
          languageId: "x86:LE:32:default",
          compilerSpecId: "default",
          baseAddr: "0x1000",
        },
      },
    ])
      expect(() =>
        ghidraHeadlessArguments({ ...base, mipsSoftFloat: true, ...conflict }),
      ).toThrow(
        expect.objectContaining({
          _tag: "GhidraAdmissionError",
          code: "mips_soft_float_scope",
        }),
      );
  });

  it("runs the committed RISC-V policy after the no-return refit and before the bridge", () => {
    const base = {
      platform: "linux" as const,
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
      languageOverride: {
        languageId: "RISCV:LE:32:default",
        compilerSpecId: "gcc",
      },
    };
    const script = "/package/bridge/ReaGhidraRiscvCallingConvention.java";
    // PSP, DOS and raw imports carry their own languages, so they omit the pin.
    const { languageOverride: _pin, ...unpinned } = base;
    expect(ghidraHeadlessArguments(base)).not.toContain(script);
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      riscvCallingConvention: "ilp32-prototype-v1",
    });
    const at = arguments_.indexOf(script);
    expect(arguments_.slice(at - 1, at + 2)).toEqual([
      "-postScript",
      script,
      "ilp32-prototype-v1",
    ]);
    expect(
      arguments_.indexOf("/package/bridge/ReaGhidraNoReturnFix.java"),
    ).toBeLessThan(at);
    expect(at).toBeLessThan(
      arguments_.indexOf("/package/bridge/ReaGhidraBridge.java"),
    );
    for (const conflict of [
      { psp: true as const },
      { mipsSoftFloat: true as const },
      { dosMz: true as const },
      { dosCom: true as const },
      {
        rawBinary: {
          languageId: "x86:LE:32:default",
          compilerSpecId: "default",
          baseAddr: "0x1000",
        },
      },
    ])
      expect(() =>
        ghidraHeadlessArguments({
          ...unpinned,
          riscvCallingConvention: "ilp32-prototype-v1",
          ...conflict,
        }),
      ).toThrow(
        expect.objectContaining({
          _tag: "GhidraAdmissionError",
          code: "riscv_calling_convention_scope",
        }),
      );
  });
});

describe("Ghidra configured import language and seeds", () => {
  const base = {
    platform: "darwin" as const,
    projectRoot: "/tmp/project",
    targetPath: "/tmp/target",
    bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
    descriptorPath: "/tmp/session.json",
    ghidraLogPath: "/tmp/ghidra.log",
    scriptLogPath: "/tmp/script.log",
  };

  it("passes a configured language and compiler spec to the import", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      languageOverride: {
        languageId: "x86:LE:32:default",
        compilerSpecId: "borlandcpp",
      },
    });
    expectOptions(arguments_, [
      ["-processor", "x86:LE:32:default"],
      ["-cspec", "borlandcpp"],
    ]);
    expect(arguments_).not.toContain("-loader");
    expect(arguments_.indexOf("-processor")).toBeGreaterThan(
      arguments_.indexOf("-import"),
    );
  });

  it("lets Ghidra choose the language default compiler spec", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      languageOverride: { languageId: "x86:LE:32:default" },
    });
    expectOptions(arguments_, [["-processor", "x86:LE:32:default"]]);
    expect(arguments_).not.toContain("-cspec");
  });

  it("never combines a configured language with a DOS import", () => {
    expect(() =>
      ghidraHeadlessArguments({
        ...base,
        dosMz: true,
        languageOverride: { languageId: "x86:LE:32:default" },
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: "GhidraAdmissionError",
        code: "language_override_dos",
      }),
    );
  });

  it("never combines a configured language with a raw-binary import", () => {
    expect(() =>
      ghidraHeadlessArguments({
        ...base,
        languageOverride: { languageId: "x86:LE:32:default" },
        rawBinary: {
          languageId: "ARM:LE:32:v7",
          compilerSpecId: "default",
          baseAddr: "0x8000000",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: "GhidraAdmissionError",
        code: "language_override_raw_binary",
      }),
    );
  });

  it.each(["darwin", "win32"] as const)(
    "applies seeds after loader preparation and before analysis scripts on %s",
    (platform) => {
      const path = platform === "win32" ? win32 : posix;
      const bridgeDirectory = path.join("/package", "bridge");
      const seedPath = path.join("/tmp/runtime/seeds", "seeds.tsv");
      const arguments_ = ghidraHeadlessArguments({
        ...base,
        platform,
        bridgeScriptPath: path.join(bridgeDirectory, "ReaGhidraBridge.java"),
        dosCom: true,
        seedPath,
      });
      const prepare = arguments_.indexOf(
        path.join(bridgeDirectory, "ReaGhidraPrepareCom.java"),
      );
      const seeds = arguments_.indexOf(
        path.join(bridgeDirectory, "ReaGhidraApplySeeds.java"),
      );
      expect(prepare).toBeGreaterThanOrEqual(0);
      expect(arguments_[seeds - 1]).toBe("-preScript");
      expect(arguments_[seeds + 1]).toBe(seedPath);
      expect(prepare).toBeLessThan(seeds);
      expect(seeds).toBeLessThan(arguments_.indexOf("-postScript"));
    },
  );

  it("adds no seed script without a seed snapshot", () => {
    expect(ghidraHeadlessArguments(base)).not.toContain(
      posix.join("/package/bridge", "ReaGhidraApplySeeds.java"),
    );
  });
});

describe("Ghidra disabled analyzers", () => {
  const base = {
    platform: "darwin" as const,
    projectRoot: "/tmp/project",
    targetPath: "/tmp/target",
    bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
    descriptorPath: "/tmp/session.json",
    ghidraLogPath: "/tmp/ghidra.log",
    scriptLogPath: "/tmp/script.log",
  };

  it("applies the analyzer options after seeds and before analysis scripts", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      dosCom: true,
      seedPath: posix.join("/tmp/runtime/seeds", "seeds.tsv"),
      disabledAnalyzers: [
        "Objective-C Message Analyzer",
        "Decompiler Switch Analysis",
      ],
    });
    const options = arguments_.indexOf(
      posix.join("/package/bridge", "ReaGhidraAnalysisOptions.java"),
    );
    expect(arguments_[options - 1]).toBe("-preScript");
    expect(arguments_[options + 1]).toBe(
      "Objective-C Message Analyzer,Decompiler Switch Analysis",
    );
    const prepare = arguments_.indexOf(
      posix.join("/package/bridge", "ReaGhidraPrepareCom.java"),
    );
    const seeds = arguments_.indexOf(
      posix.join("/package/bridge", "ReaGhidraApplySeeds.java"),
    );
    expect(prepare).toBeLessThan(seeds);
    expect(seeds).toBeLessThan(options);
    expect(options).toBeLessThan(arguments_.indexOf("-postScript"));
  });

  it.each(["darwin", "win32"] as const)(
    "uses the target platform's script path for the options script on %s",
    (platform) => {
      const path = platform === "win32" ? win32 : posix;
      const arguments_ = ghidraHeadlessArguments({
        ...base,
        platform,
        bridgeScriptPath: path.join(
          "/package",
          "bridge",
          "ReaGhidraBridge.java",
        ),
        disabledAnalyzers: ["Objective-C Message Analyzer"],
      });
      const options = arguments_.indexOf(
        path.join("/package", "bridge", "ReaGhidraAnalysisOptions.java"),
      );
      expect(arguments_[options - 1]).toBe("-preScript");
      expect(arguments_[options + 1]).toBe("Objective-C Message Analyzer");
      expect(options).toBeLessThan(arguments_.indexOf("-postScript"));
    },
  );

  it("keeps the invocation byte-identical without an override", () => {
    expect(ghidraHeadlessArguments(base)).toEqual([
      "/tmp/project",
      "rea-project",
      "-import",
      "/tmp/target",
      "-readOnly",
      "-deleteProject",
      "-log",
      "/tmp/ghidra.log",
      "-scriptlog",
      "/tmp/script.log",
      "-scriptPath",
      "/package/bridge",
      "-postScript",
      "/package/bridge/ReaGhidraNoReturnFix.java",
      "-postScript",
      "/package/bridge/ReaGhidraBridge.java",
      "/tmp/session.json",
    ]);
  });

  it("adds no analyzer script for an empty override", () => {
    expect(
      ghidraHeadlessArguments({ ...base, disabledAnalyzers: [] }),
    ).not.toContain(
      posix.join("/package/bridge", "ReaGhidraAnalysisOptions.java"),
    );
  });
});

describe("Ghidra existing project", () => {
  const base = {
    platform: "darwin" as const,
    projectRoot: "/tmp/project",
    targetPath: "/tmp/target",
    bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
    descriptorPath: "/tmp/session.json",
    ghidraLogPath: "/tmp/ghidra.log",
    scriptLogPath: "/tmp/script.log",
  };

  it("opens a pre-imported program without importing or deleting the project", () => {
    const arguments_ = ghidraHeadlessArguments({
      ...base,
      existingProject: { programName: "game.exe" },
    });
    // The project location and name stay explicit; nothing is imported.
    expect(arguments_.slice(0, 2)).toEqual(["/tmp/project", "rea-project"]);
    expect(arguments_).not.toContain("-import");
    expect(arguments_).not.toContain("-deleteProject");
    expect(arguments_).toEqual([
      "/tmp/project",
      "rea-project",
      "-process",
      "game.exe",
      "-noanalysis",
      "-readOnly",
      "-log",
      "/tmp/ghidra.log",
      "-scriptlog",
      "/tmp/script.log",
      "-scriptPath",
      "/package/bridge",
      "-postScript",
      "/package/bridge/ReaGhidraBridge.java",
      "/tmp/session.json",
    ]);
  });

  it.each([
    [{ dosMz: true as const }, "existing_project_dos"],
    [{ dosCom: true as const }, "existing_project_dos"],
    [
      {
        rawBinary: {
          languageId: "ARM:LE:32:v7",
          compilerSpecId: "default",
          baseAddr: "0x8000000",
        },
      },
      "existing_project_raw_binary",
    ],
    [
      { languageOverride: { languageId: "x86:LE:32:default" } },
      "existing_project_language_override",
    ],
    [{ psp: true as const }, "existing_project_psp"],
    [{ mipsSoftFloat: true as const }, "existing_project_mips_soft_float"],
    [
      { riscvCallingConvention: "ilp32-prototype-v1" as const },
      "existing_project_riscv_calling_convention",
    ],
    [{ seedPath: "/tmp/runtime/seeds/seeds.tsv" }, "existing_project_analysis"],
    [
      { disabledAnalyzers: ["Decompiler Parameter ID"] },
      "existing_project_analysis",
    ],
  ] as const)(
    "rejects the import-only option %o with an existing project",
    (conflict, code) => {
      expect(() =>
        ghidraHeadlessArguments({
          ...base,
          existingProject: { programName: "game.exe" },
          ...conflict,
        }),
      ).toThrow(
        expect.objectContaining({ _tag: "GhidraAdmissionError", code }),
      );
    },
  );

  it("rejects a Windows existing-project open on the P0 launch path", () => {
    expect(() =>
      ghidraHeadlessArguments({
        ...base,
        platform: "win32",
        bridgeScriptPath: win32.join(
          "/package",
          "bridge",
          "ReaGhidraBridge.java",
        ),
        existingProject: { programName: "game.exe" },
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: "GhidraAdmissionError",
        code: "existing_project_windows",
      }),
    );
  });

  it("requires a program name for -process", () => {
    expect(() =>
      ghidraHeadlessArguments({
        ...base,
        existingProject: { programName: "   " },
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: "GhidraAdmissionError",
        code: "existing_project_program_name",
      }),
    );
  });
});

const fakeSpawnedProcess = (runId: string): SpawnedOwnedProviderProcess => {
  const handle: ProviderProcessHandle = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout: null,
    stdin: null,
    stderr: null,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  });
  return {
    process: handle,
    ownership: { runId, leaderPid: 4242, processGroupId: 4242 },
  };
};

const createFakeJavaHome = async (parent: string): Promise<string> => {
  const javaHome = join(parent, "jdk");
  await mkdir(join(javaHome, "bin"), { recursive: true });
  // LaunchSupport only consults this helper; an empty report is valid.
  await writeFile(join(javaHome, "bin", "java"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  return javaHome;
};

const launchExistingProject = async (
  runtimeRoot: string,
  parent: string,
  projectPath: string,
  spawned: OwnedProviderProcessSpawnOptions[],
) => {
  const javaHome = await createFakeJavaHome(parent);
  const launcher = new GhidraHeadlessLauncher({
    environment: process.env,
    analyzeHeadlessPath: fixturePath,
    platform: "linux",
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
    javaHome,
    bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
    existingProject: { projectPath, programName: "game.exe" },
    spawnProcess: async (options) => {
      spawned.push(options);
      return fakeSpawnedProcess(options.runId);
    },
  });
  return launcher.launch({
    runtimeRoot,
    transport: "unix-socket",
    endpointPath: join(runtimeRoot, "bridge.sock"),
    token: "secret-token-that-must-not-leak",
    runId: "d6fcbb66-e829-4ff6-a535-0035aec63139",
    targetPath: "/tmp/target",
    targetSha256: "b".repeat(64),
    providerVersion: "12.1.4",
    profileDigest: "a".repeat(64),
  });
};

describe("Ghidra existing project launcher", () => {
  it.skipIf(process.platform === "win32")(
    "copies the caller's project into the owned runtime before launching",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      const sourceProject = join(parent, "user-project");
      await mkdir(join(sourceProject, "rea-project.rep"), {
        recursive: true,
      });
      const projectMarker = join(sourceProject, "rea-project.gpr");
      await writeFile(projectMarker, "pre-imported");
      await writeFile(
        join(sourceProject, "rea-project.rep", "marker"),
        "recursive",
      );
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        sourceProject,
        spawned,
      );
      if (!launched.ok) throw launched.error;
      try {
        expect(spawned).toHaveLength(1);
        expect(spawned[0]?.arguments).not.toContain("-import");
        expect(spawned[0]?.arguments).not.toContain("-deleteProject");
        expectOptions(spawned[0]?.arguments ?? [], [["-process", "game.exe"]]);
        expect(spawned[0]?.arguments).toContain("-noanalysis");
        expect(spawned[0]?.arguments).toContain("-readOnly");
        // Copy-first: the owned runtime holds the copy before Ghidra starts.
        expect(
          await readFile(join(runtime.path, "project", "rea-project.gpr"), {
            encoding: "utf8",
          }),
        ).toBe("pre-imported");
        expect(
          await readFile(
            join(runtime.path, "project", "rea-project.rep", "marker"),
            { encoding: "utf8" },
          ),
        ).toBe("recursive");
        // The caller's original project files stay untouched.
        expect(await readFile(projectMarker, { encoding: "utf8" })).toBe(
          "pre-imported",
        );
        expect((await stat(projectMarker)).isFile()).toBe(true);
      } finally {
        await launched.value.cleanup?.();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a missing project directory before starting Ghidra",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        join(parent, "absent-project"),
        spawned,
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("launch unexpectedly succeeded");
      // The launcher wraps the copy failure; the reason stays on the cause.
      expect(String(launched.error.cause)).toMatch(/does not exist/u);
      expect(spawned).toHaveLength(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a project without the fixed rea-project name before copying",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      // The headless open selects the project by the fixed name; a caller
      // directory holding any other project file must fail with its reason
      // instead of spawning into an opaque Ghidra error.
      const sourceProject = join(parent, "user-project");
      await mkdir(sourceProject, { recursive: true });
      await writeFile(join(sourceProject, "other-project.grez"), "mislabeled");
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        sourceProject,
        spawned,
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("launch unexpectedly succeeded");
      expect(String(launched.error.cause)).toMatch(/rea-project\.gpr/u);
      expect(spawned).toHaveLength(0);
      // Nothing from the rejected project was copied into the owned runtime.
      await expect(
        access(join(runtime.path, "project")),
      ).resolves.toBeUndefined();
      expect(await readdir(join(runtime.path, "project"))).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a project path that overlaps the runtime before copying",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      // Copying the runtime into itself would recurse without bound, so the
      // launcher must refuse the overlap before touching the file system.
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        runtime.path,
        spawned,
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("launch unexpectedly succeeded");
      expect(String(launched.error.cause)).toMatch(
        /overlaps the REA runtime directory/u,
      );
      expect(spawned).toHaveLength(0);
      expect(await readdir(join(runtime.path, "project"))).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a project path inside the runtime before copying",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      // A caller-supplied path inside the owned runtime (here the project
      // root itself) is equally an overlap and must fail before Ghidra runs.
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        join(runtime.path, "project"),
        spawned,
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("launch unexpectedly succeeded");
      expect(String(launched.error.cause)).toMatch(
        /overlaps the REA runtime directory/u,
      );
      expect(spawned).toHaveLength(0);
      expect(await readdir(join(runtime.path, "project"))).toEqual([]);
    },
  );
});

describe("Ghidra existing project symlink overlap", () => {
  it.skipIf(process.platform === "win32")(
    "rejects a project path whose symbolic link hides a runtime overlap before copying",
    async () => {
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      // A valid project directory inside the owned runtime, reached only
      // through a symbolic link outside it: the lexical path never overlaps
      // the runtime, so only a realpath-based comparison can refuse the copy.
      const hidden = join(runtime.path, "link-target");
      await mkdir(hidden, { recursive: true });
      await writeFile(join(hidden, "rea-project.gpr"), "", {
        encoding: "utf8",
      });
      await mkdir(join(hidden, "rea-project.rep"), { recursive: true });
      const alias = join(parent, "alias");
      await symlink(hidden, alias);
      const spawned: OwnedProviderProcessSpawnOptions[] = [];
      const launched = await launchExistingProject(
        runtime.path,
        parent,
        alias,
        spawned,
      );
      expect(launched.ok).toBe(false);
      if (launched.ok) throw new Error("launch unexpectedly succeeded");
      expect(String(launched.error.cause)).toMatch(
        /overlaps the REA runtime directory/u,
      );
      expect(spawned).toHaveLength(0);
      expect(await readdir(join(runtime.path, "project"))).toEqual([]);
    },
  );
});

describe("Ghidra expanded project admission", () => {
  it.each([
    { label: "archive only", marker: false, data: false },
    { label: "marker without data", marker: true, data: false },
    { label: "data without marker", marker: false, data: true },
  ])("rejects $label before starting Ghidra", async ({ marker, data }) => {
    const parent = await createTestTempDirectory("rea-launcher-test-");
    const runtime = await createGhidraTestRuntime(parent);
    runtimes.push(runtime);
    const sourceProject = join(parent, "user-project");
    await mkdir(sourceProject);
    await writeFile(join(sourceProject, "rea-project.grez"), "saved archive");
    if (marker)
      await writeFile(join(sourceProject, "rea-project.gpr"), "marker");
    if (data) await mkdir(join(sourceProject, "rea-project.rep"));
    const spawned: OwnedProviderProcessSpawnOptions[] = [];
    const launched = await launchExistingProject(
      runtime.path,
      parent,
      sourceProject,
      spawned,
    );
    expect(launched.ok).toBe(false);
    if (launched.ok) throw new Error("launch unexpectedly succeeded");
    expect(String(launched.error.cause)).toMatch(
      /restore saved \.grez archives/u,
    );
    expect(spawned).toHaveLength(0);
    expect(await readdir(join(runtime.path, "project"))).toEqual([]);
  });
});

describe("Ghidra Windows launcher", () => {
  it("keeps analysis repair outside Windows P0 authority", () => {
    const args = ghidraHeadlessArguments({
      platform: "win32",
      projectRoot: "/tmp/project",
      targetPath: "/tmp/target",
      bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
      descriptorPath: "/tmp/session.json",
      ghidraLogPath: "/tmp/ghidra.log",
      scriptLogPath: "/tmp/script.log",
    });
    expect(args).not.toContain("/package/bridge/ReaGhidraNoReturnFix.java");
    expect(args).toContain("/package/bridge/ReaGhidraBridge.java");
  });
});

describe("Ghidra Windows batch command construction", () => {
  it("wraps the Windows batch launcher without enabling a Node shell", () => {
    const command = ghidraHeadlessCommand({
      environment: {},
      platform: "win32",
      analyzeHeadlessPath:
        "C:\\Program Files\\Ghidra 12.1.4\\support\\analyzeHeadless.bat",
      arguments: [
        "C:\\REA Runtime\\project",
        "rea-project",
        "-import",
        "C:\\REA Runtime\\target.exe",
      ],
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(command).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      arguments: [
        "/d",
        "/e:on",
        "/v:off",
        "/s",
        "/c",
        '""C:\\Program Files\\Ghidra 12.1.4\\support\\analyzeHeadless.bat" "C:\\REA Runtime\\project" "rea-project" "-import" "C:\\REA Runtime\\target.exe""',
      ],
    });
  });

  it.each([
    "C:\\targets\\%TEMP%\\fixture.exe",
    "C:\\targets\\fixture & calc.exe",
    'C:\\targets\\fixture".exe',
  ])("rejects a Windows command-interpreter path: %s", (targetPath) => {
    expect(() =>
      ghidraHeadlessCommand({
        environment: {},
        platform: "win32",
        analyzeHeadlessPath: "C:\\Ghidra\\support\\analyzeHeadless.bat",
        arguments: ["-import", targetPath],
        comSpec: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toThrow(/metacharacters/u);
  });
});

describe("Ghidra Windows release configuration", () => {
  it
    .skipIf(process.platform !== "win32")
    .each(["ghidra_12.1.4_PUBLIC", "renamed-install"])(
    "prepares the %s release directory through the Windows runtime",
    async (release) => {
      const parent = await createTestTempDirectory("rea-launch-config-");
      const installRoot = join(parent, "renamed-install");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      const spawnProcess = vi.fn(async () => {
        throw new Error("fixture stops before process creation");
      });
      const launcher = new GhidraHeadlessLauncher({
        environment: process.env,
        platform: "win32",
        configurationDirectoryName: release,
        analyzeHeadlessPath: join(
          installRoot,
          "support",
          "analyzeHeadless.bat",
        ),
        javaHome: "C:\\Java\\jdk-21",
        bridgeScriptPath: join(parent, "ReaGhidraBridge.java"),
        // The preflight validates the inspected JVM's LaunchSupport output;
        // these fixtures assert batch-spawn behavior without a working JDK.
        javaLaunch: async () => ({
          command: "C:\\Java\\jdk-21\\bin\\java.exe",
          arguments: [],
          environment: {},
        }),
        spawnProcess,
      });
      const launched = await launcher.launch({
        runtimeRoot: runtime.path,
        transport: "unix-socket",
        endpointPath: join(runtime.path, "bridge.sock"),
        token: "fixture-token",
        runId: "d6fcbb66-e829-4ff6-a535-0035aec63139",
        targetPath: join(parent, "fixture.exe"),
        targetSha256: "b".repeat(64),
        providerVersion: "12.1.4",
        profileDigest: "a".repeat(64),
      });
      expect(launched.ok).toBe(false);
      expect(spawnProcess).toHaveBeenCalledOnce();
      expect(
        (
          await stat(join(runtime.path, "config", "ghidra", release))
        ).isDirectory(),
      ).toBe(true);
    },
  );
});

describe("Ghidra Windows launcher process ownership", () => {
  it.skipIf(process.platform !== "win32")(
    "keeps authority in a private descriptor and isolates Ghidra state through the batch launcher",
    async () => {
      vi.stubEnv("GHIDRA_JAVA_OPTIONS", "-javaagent:/unapproved/agent.jar");
      vi.stubEnv("JAVA_TOOL_OPTIONS", "-Duser.home=/unapproved/home");
      vi.stubEnv("JDK_JAVA_OPTIONS", "-XX:MaxRAMPercentage=99");
      vi.stubEnv("_JAVA_OPTIONS", "-Xmx99G");
      const parent = await createTestTempDirectory("rea-launcher-test-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      const runtimeRoot = runtime.path;
      const token = "secret-token-that-must-not-leak";
      const javaHome = "C:\\Java\\jdk-21";
      const launcher = new GhidraHeadlessLauncher({
        // Select the fixture's Node PATH and injected JVM options explicitly.
        environment: process.env,
        analyzeHeadlessPath: fixturePath,
        configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
        // POSIX follows the real inspected-JVM route; Windows uses the official
        // batch script because its launcher contract differs.
        platform: "win32",
        javaHome,
        bridgeScriptPath: "/package/bridge/ReaGhidraBridge.java",
        // The preflight validates the inspected JVM's LaunchSupport output;
        // this fixture captures the batch launcher without a working JDK.
        javaLaunch: async () => ({
          command: `${javaHome}\\bin\\java.exe`,
          arguments: [],
          environment: {},
        }),
      });
      const launched = await launcher.launch({
        runtimeRoot,
        transport: "unix-socket",
        endpointPath: join(runtimeRoot, "bridge.sock"),
        token,
        runId: "d6fcbb66-e829-4ff6-a535-0035aec63139",
        targetPath: "/tmp/fixture",
        targetSha256: "b".repeat(64),
        providerVersion: "12.1.4",
        profileDigest: "a".repeat(64),
      });
      if (!launched.ok) throw launched.error;
      try {
        const capturePath = join(runtimeRoot, "launch-capture.json");
        await vi.waitFor(() => access(`${capturePath}.ready`), {
          timeout: 10_000,
        });
        const capture = launchCaptureSchema.parse(
          JSON.parse(await readFile(capturePath, "utf8")),
        );
        const encodedArguments = JSON.stringify(capture.arguments);
        const encodedEnvironment = JSON.stringify(capture.environment);
        expect(encodedArguments).not.toContain(token);
        expect(encodedEnvironment).not.toContain(token);
        expect(capture).toMatchObject({
          ...(process.platform === "win32" ? {} : { descriptor_mode: 0o600 }),
          descriptor_has_token: true,
        });
        expectIsolatedEnvironment(capture.environment, runtimeRoot, javaHome);
        expect(capture.environment.GHIDRA_HEADLESS_JAVA_OPTIONS).toBe("");
        if (process.platform !== "win32")
          expect(
            (await stat(join(runtimeRoot, "ownership.json"))).mode & 0o777,
          ).toBe(0o600);
      } finally {
        const cleaned = await launched.value.cleanup?.();
        expect(cleaned).toMatchObject({ cleaned: true });
        await expect(
          access(join(runtimeRoot, "project")),
        ).resolves.toBeUndefined();
      }
    },
  );
});

describe("Ghidra GameCube DOL section file", () => {
  // The fixture forces the POSIX launch path (platform "darwin": posix paths,
  // 0600 files, direct JVM). Windows CI returns a launch error before spawn,
  // so this runs only where that path is the real host path.
  it.skipIf(process.platform === "win32")(
    "writes the canonical section table next to session.json before spawn",
    async () => {
      const parent = await createTestTempDirectory("rea-dol-section-");
      const runtime = await createGhidraTestRuntime(parent);
      runtimes.push(runtime);
      const sectionFile =
        "plan 2 1 0\nsection text 0 0x100 0x80003100 0x20\nentry 0x80003100\n";
      const spawnProcess = vi.fn(async () => {
        throw new Error("fixture stops before process creation");
      });
      const javaHome = "/opt/fixture-jdk";
      const launcher = new GhidraHeadlessLauncher({
        environment: process.env,
        platform: "darwin",
        configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
        analyzeHeadlessPath: fixturePath,
        javaHome,
        bridgeScriptPath: join(parent, "ReaGhidraBridge.java"),
        javaLaunch: async () => ({
          command: join(javaHome, "bin", "java"),
          arguments: [],
          environment: {},
        }),
        spawnProcess,
        gamecubeDol: {
          languageId: "PowerPC:BE:32:default",
          sectionFile,
        },
      });
      await launcher.launch({
        runtimeRoot: runtime.path,
        transport: "unix-socket",
        endpointPath: join(runtime.path, "bridge.sock"),
        token: "token-for-section-test",
        runId: "d6fcbb66-e829-4ff6-a535-0035aec63139",
        targetPath: "/tmp/fixture.dol",
        targetSha256: "c".repeat(64),
        providerVersion: "12.1.4",
        profileDigest: "a".repeat(64),
      });
      expect(spawnProcess).toHaveBeenCalledOnce();
      const sectionPath = join(runtime.path, "gamecube-dol-sections.txt");
      expect(await readFile(sectionPath, "utf8")).toBe(sectionFile);
    },
  );
});
