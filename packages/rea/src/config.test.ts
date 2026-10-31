import { describe, expect, it } from "vitest";

import {
  defaultHopperLauncherPath,
  inspectNativeAnalysisConfiguration,
  parseConfig,
} from "./config/parseConfig.js";
import {
  parseEnvironmentValues,
  parseJebMcpTimeoutMs,
} from "./config/environment.js";
import { projectAnalysisError } from "./domain/analysisErrorProjection.js";

it("reports a configuration failure for a NUL in Hopper loader arguments", () => {
  const result = parseConfig({
    HOPPER_LOADER_ARGS_JSON: JSON.stringify(["--option", "value\0suffix"]),
  });
  if (result.ok)
    throw new Error("NUL argv cannot be passed to a child process");
  expect(result.error).toMatchObject({
    settings: [{ setting: "HOPPER_LOADER_ARGS_JSON" }],
  });
  expect(result.error.message).toContain("NUL");
});

it.each([
  ["unknown value", { CALLER_SETTING: "private\0value" }],
  ["unknown name", { ["CALLER\0SETTING"]: "private value" }],
  ["known path", { HOPPER_TARGET_PATH: "private\0path" }],
] as const)(
  "rejects a NUL in an environment %s without exposing its value",
  (_name, environment) => {
    for (const result of [
      parseEnvironmentValues(environment),
      parseConfig(environment),
    ]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected invalid environment");
      expect(result.error.settings).toHaveLength(1);
      expect(result.error.settings[0]?.constraint).toContain("NUL");
      expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
        "private",
      );
    }
  },
);

it("accepts ordinary custom environment strings and omitted values", () => {
  expect(
    parseEnvironmentValues({
      CALLER_SETTING: "\nvalue=one;二\t",
      EMPTY_SETTING: "",
      OMITTED_SETTING: undefined,
    }).ok,
  ).toBe(true);
});

describe("runtime configuration", () => {
  it("preserves a selected MCP input allowance for deferred startup and refuses disabling values", () => {
    expect(parseConfig({ REA_MCP_MAX_INPUT_ELEMENTS: "8192" })).toMatchObject({
      ok: true,
      value: { mcpMaxInputElements: 8192 },
    });
    const invalid = parseConfig({ REA_MCP_MAX_INPUT_ELEMENTS: "Infinity" });
    expect(invalid.ok).toBe(false);
    if (invalid.ok)
      throw new Error(
        "Infinite MCP input allowance must not be accepted from the environment",
      );
    expect(invalid.error.settings).toEqual([
      {
        setting: "REA_MCP_MAX_INPUT_ELEMENTS",
        constraint: expect.stringContaining("positive decimal safe integer"),
      },
    ]);
  });
  it("allows target-free startup and applies runtime defaults", () => {
    const empty = parseConfig({});
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.value.hopperTargetPath).toBeUndefined();
      expect(empty.value.analysisProvider).toBe("auto");
      expect(empty.value.hopperStartupTimeoutMs).toBe(120_000);
    }
    const result = parseConfig({ HOPPER_TARGET_PATH: "/usr/bin/true" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hopperTargetKind).toBe("executable");
      expect(result.value.hopperLoaderArgs).toEqual([]);
      expect(result.value.logLevel).toBe("info");
      expect(result.value.referenceSourcePolicy).toEqual({
        secretPatterns: [],
      });
    }
  });

  it("parses one shared provider selector and rejects unstable IDs", () => {
    expect(
      parseConfig({
        REA_ANALYSIS_PROVIDER: "ida",
        REA_IDA_MCP_CONFIG: "/tmp/ida-mcp.json",
      }),
    ).toMatchObject({
      ok: true,
      value: { analysisProvider: "ida", idaMcpConfigPath: "/tmp/ida-mcp.json" },
    });
    expect(parseConfig({ REA_IDA_MCP_CONFIG: "relative.json" }).ok).toBe(false);
    expect(parseConfig({ REA_ANALYSIS_PROVIDER: "ghidra" })).toMatchObject({
      ok: true,
      value: { analysisProvider: "ghidra" },
    });
    expect(parseConfig({ REA_ANALYSIS_PROVIDER: "auto" })).toMatchObject({
      ok: true,
      value: { analysisProvider: "auto" },
    });
    for (const invalid of ["", "Auto", "ghidra_1", "ghidra "])
      expect(parseConfig({ REA_ANALYSIS_PROVIDER: invalid }).ok).toBe(false);
  });

  it("shares native admission with doctor and ignores the JEB-only timeout", () => {
    expect(inspectNativeAnalysisConfiguration({})).toEqual({ issues: [] });
    expect(
      inspectNativeAnalysisConfiguration({ REA_JEB_MCP_TIMEOUT_MS: "abc" }),
    ).toEqual({ issues: [] });
    expect(parseConfig({ REA_JEB_MCP_TIMEOUT_MS: "abc" }).ok).toBe(true);
    const rejected = inspectNativeAnalysisConfiguration({
      REA_ANALYSIS_PROVIDER: "Hopper",
      REA_GHIDRA_STARTUP_TIMEOUT_MS: "abc",
    });
    expect(rejected.issues.map(({ setting }) => setting)).toEqual([
      "REA_ANALYSIS_PROVIDER",
      "REA_GHIDRA_STARTUP_TIMEOUT_MS",
    ]);
    expect(
      parseConfig({
        REA_ANALYSIS_PROVIDER: "Hopper",
        REA_GHIDRA_STARTUP_TIMEOUT_MS: "abc",
      }).ok,
    ).toBe(false);
  });

  it("preserves the timeout's schema cause when aggregate admission stops at NUL", () => {
    const inspected = inspectNativeAnalysisConfiguration({
      CALLER_SETTING: "private\0value",
      REA_HOPPER_STARTUP_TIMEOUT_MS: "0",
    });
    expect(inspected.issues).toEqual([
      {
        setting: "CALLER_SETTING",
        constraint:
          "Environment variable names and values must not contain NUL bytes",
      },
    ]);
    const timeout = inspected.configuredHopperStartupTimeout;
    if (timeout === undefined || timeout.ok)
      throw new Error("Expected the configured timeout's independent refusal");
    expect(timeout.error.cause).toMatchObject({
      name: "ZodError",
      issues: [{ message: "must be a positive decimal integer" }],
    });
    expect(timeout.error.settings).toEqual([
      {
        setting: "REA_HOPPER_STARTUP_TIMEOUT_MS",
        constraint: "must be a positive decimal integer",
      },
    ]);
  });

  it("parses absolute BYO Ghidra and optional Java paths", () => {
    expect(
      parseConfig({
        GHIDRA_INSTALL_DIR: "/opt/ghidra_12.1.4_PUBLIC",
        JAVA_HOME: "/usr/lib/jvm/jdk-21",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        ghidraInstallDir: "/opt/ghidra_12.1.4_PUBLIC",
        ghidraJavaHome: "/usr/lib/jvm/jdk-21",
      },
    });
    expect(parseConfig({ GHIDRA_INSTALL_DIR: "relative/ghidra" }).ok).toBe(
      false,
    );
    expect(parseConfig({ JAVA_HOME: "relative/jdk" }).ok).toBe(false);
  });

  it("parses an optional absolute BYO ilspycmd path", () => {
    expect(
      parseConfig({ REA_ILSPY_CMD_PATH: "/home/user/.dotnet/tools/ilspycmd" }),
    ).toMatchObject({
      ok: true,
      value: {
        ilspyCmdPath: "/home/user/.dotnet/tools/ilspycmd",
      },
    });
    expect(parseConfig({ REA_ILSPY_CMD_PATH: "relative/ilspycmd" }).ok).toBe(
      false,
    );
  });
});

describe("runtime target configuration", () => {
  it("rejects invalid target kinds with actionable environment diagnostics", () => {
    const result = parseConfig({ HOPPER_TARGET_KIND: "archive" });
    if (result.ok) throw new Error("Expected invalid target kind");
    expect(result.error.message).toContain("Invalid REA environment");
  });

  it("parses database kind and loader arguments", () => {
    expect(
      parseConfig({
        HOPPER_LAUNCHER_PATH: "/custom/hopper",
        REA_ANALYSIS_PROVIDER: "hopper",
        HOPPER_TARGET_PATH: "/fixture/sample.hop",
        HOPPER_TARGET_KIND: "database",
        HOPPER_LOADER_ARGS_JSON: '["-l","FAT","--aarch64","-l","Mach-O"]',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        hopperLauncherPath: "/custom/hopper",
        analysisProvider: "hopper",
        hopperTargetPath: "/fixture/sample.hop",
        hopperTargetKind: "database",
        hopperLoaderArgs: ["-l", "FAT", "--aarch64", "-l", "Mach-O"],
        logLevel: "info",
        referenceSourcePolicy: {
          secretPatterns: [],
        },
      },
    });
  });
});

describe("runtime collection configuration", () => {
  it("preserves empty loader arguments and rejects empty exclusion patterns", () => {
    expect(
      parseConfig({ HOPPER_LOADER_ARGS_JSON: '["", " ", "--option"]' }),
    ).toMatchObject({
      ok: true,
      value: { hopperLoaderArgs: ["", " ", "--option"] },
    });
    expect(parseConfig({ REA_REFERENCE_SECRET_PATTERNS_JSON: '[""]' }).ok).toBe(
      false,
    );
  });

  it.each(["not-json", "{}", '"just a string"', '["ok",1]'])(
    "rejects invalid loader args: %s",
    (encoded) => {
      const result = parseConfig({
        HOPPER_TARGET_PATH: "/tmp/a",
        HOPPER_LOADER_ARGS_JSON: encoded,
      });
      if (result.ok)
        throw new Error("expected malformed loader arguments to fail");
      expect(result.error.message).toContain(
        encoded === "not-json" ? "valid JSON" : "array of strings",
      );
    },
  );

  it("parses supported log levels and rejects unknown levels", () => {
    const configured = parseConfig({ REA_LOG_LEVEL: "debug" });
    expect(configured.ok && configured.value.logLevel).toBe("debug");
    expect(parseConfig({ REA_LOG_LEVEL: "verbose" }).ok).toBe(false);
  });

  it("parses reference source secret patterns", () => {
    const result = parseConfig({
      REA_REFERENCE_SECRET_PATTERNS_JSON: '["*.env", "*.pem", "secrets/"]',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.referenceSourcePolicy).toEqual({
        secretPatterns: ["*.env", "*.pem", "secrets/"],
      });
    }
  });

  it.each(["not-json", "{}", '["*.ok", 1]'])(
    "rejects invalid reference source secret patterns: %s",
    (encoded) => {
      expect(
        parseConfig({ REA_REFERENCE_SECRET_PATTERNS_JSON: encoded }).ok,
      ).toBe(false);
    },
  );
});

describe("configuration failure diagnostics", () => {
  it.each(["1", "900000", "2147483647"])(
    "accepts Hopper startup deadline %s without changing Ghidra's deadline",
    (value) => {
      expect(
        parseConfig({ REA_HOPPER_STARTUP_TIMEOUT_MS: value }),
      ).toMatchObject({
        ok: true,
        value: {
          hopperStartupTimeoutMs: Number(value),
          ghidraStartupTimeoutMs: 330_000,
        },
      });
    },
  );

  it.each(["", "0", "-1", "1.5", "1e3", "invalid", "2147483648"])(
    "rejects malformed Hopper startup deadline %j with its setting",
    (value) => {
      const result = parseConfig({ REA_HOPPER_STARTUP_TIMEOUT_MS: value });
      if (result.ok) throw new Error("Expected invalid startup deadline");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "configuration_invalid",
        category: "invalid_input",
        details: {
          settings: [
            {
              setting: "REA_HOPPER_STARTUP_TIMEOUT_MS",
              constraint: expect.any(String),
            },
          ],
        },
      });
    },
  );

  it.each([
    "",
    " ",
    "0",
    "-5",
    "abc",
    "1.5",
    "1e3",
    "0x100",
    "2147483648",
    "9007199254740991",
  ])(
    "rejects malformed Ghidra startup deadline %j with its setting and constraint",
    (value) => {
      const result = parseConfig({ REA_GHIDRA_STARTUP_TIMEOUT_MS: value });
      if (result.ok) throw new Error("Expected invalid startup deadline");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "configuration_invalid",
        category: "invalid_input",
        details: {
          settings: [
            {
              setting: "REA_GHIDRA_STARTUP_TIMEOUT_MS",
              constraint: expect.any(String),
            },
          ],
        },
      });
    },
  );

  it.each(["1", "90000", "2147483647"])(
    "accepts Swift compile deadline %s without changing Hopper's deadline",
    (value) => {
      expect(
        parseConfig({ REA_SWIFTC_COMPILE_TIMEOUT_MS: value }),
      ).toMatchObject({
        ok: true,
        value: {
          hopperStartupTimeoutMs: 120_000,
        },
      });
    },
  );

  it.each(["", "0", "-1", "1.5", "1e3", "invalid", "2147483648"])(
    "rejects malformed Swift compile deadline %j with its setting",
    (value) => {
      const result = parseConfig({ REA_SWIFTC_COMPILE_TIMEOUT_MS: value });
      if (result.ok) throw new Error("Expected invalid Swift compile deadline");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "configuration_invalid",
        category: "invalid_input",
        details: {
          settings: [
            {
              setting: "REA_SWIFTC_COMPILE_TIMEOUT_MS",
              constraint: expect.any(String),
            },
          ],
        },
      });
    },
  );

  it.each([
    ["GHIDRA_INSTALL_DIR", "./fixture"],
    ["JAVA_HOME", "./jdk"],
    ["REA_GHIDRA_NATIVEAOT_JAR", "./missing.jar"],
  ])(
    "names the rejected %s and its absolute-path constraint",
    (setting, value) => {
      const result = parseConfig({ [setting]: value });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const constraint = `${setting} must be absolute`;
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "configuration_invalid",
        category: "invalid_input",
        message: `REA configuration is invalid: ${constraint}.`,
        remediation: { action: expect.stringContaining(`Correct ${setting} `) },
        details: { settings: [{ setting, constraint }] },
      });
      // The rejected value itself is not echoed.
      expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
        value,
      );
    },
  );

  it("names settings rejected by their own parsers", () => {
    const result = parseConfig({ HOPPER_LOADER_ARGS_JSON: "not-json" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: {
          settings: [
            {
              setting: "HOPPER_LOADER_ARGS_JSON",
              constraint: "HOPPER_LOADER_ARGS_JSON must be valid JSON",
            },
          ],
        },
      });
  });
});

describe("JEB MCP timeout configuration", () => {
  it("stays optional and validates the caller-selected environment value", () => {
    expect(parseJebMcpTimeoutMs(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseJebMcpTimeoutMs("900000")).toEqual({
      ok: true,
      value: 900_000,
    });
    expect(
      parseEnvironmentValues({ REA_JEB_MCP_TIMEOUT_MS: "900000" }),
    ).toMatchObject({ ok: true, value: { REA_JEB_MCP_TIMEOUT_MS: 900_000 } });
  });

  it.each(["", "0", "-1", "1.5", "1e3", "invalid", "2147483648"])(
    "rejects malformed timeout %j with its setting",
    (value) => {
      const result = parseJebMcpTimeoutMs(value);
      if (result.ok) throw new Error("Expected invalid JEB MCP timeout");
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: {
          settings: [
            {
              setting: "REA_JEB_MCP_TIMEOUT_MS",
              constraint: expect.any(String),
            },
          ],
        },
      });
    },
  );
});

describe("default Linux Hopper launcher", () => {
  const home = "/fixture/home";
  const withExecutables =
    (paths: readonly string[]) =>
    (path: string): boolean =>
      paths.includes(path);

  it.each([["/opt/hopper-v4/bin/hopper"], ["/usr/bin/hopper"]])(
    "selects an existing system launcher %s",
    (path) => {
      expect(
        defaultHopperLauncherPath("linux", home, withExecutables([path])),
      ).toBe(path);
    },
  );

  it("prefers REA-managed and user-local launchers over system paths", () => {
    expect(
      defaultHopperLauncherPath(
        "linux",
        home,
        withExecutables([
          "/opt/hopper/bin/Hopper",
          "/opt/hopper-v4/bin/hopper",
          "/usr/bin/hopper",
        ]),
      ),
    ).toBe("/opt/hopper/bin/Hopper");
    expect(
      defaultHopperLauncherPath(
        "linux",
        home,
        withExecutables([
          `${home}/.local/share/rea/hopper/bin/Hopper`,
          "/usr/bin/hopper",
        ]),
      ),
    ).toBe(`${home}/.local/share/rea/hopper/bin/Hopper`);
  });
});

describe("default macOS Hopper launcher", () => {
  it("selects the system path before the installer user path", () => {
    const home = "/fixture/home";
    const system =
      "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper";
    const user =
      "/fixture/home/Applications/Hopper Disassembler.app/Contents/MacOS/hopper";
    const executable = (path: string): boolean =>
      path === system || path === user;

    expect(defaultHopperLauncherPath("darwin", home, executable)).toBe(system);
    expect(
      defaultHopperLauncherPath("darwin", home, (path) => path === user),
    ).toBe(user);
  });

  it("keeps an explicit launcher path unchanged", () => {
    const configured = "/custom/../Hopper launcher";
    const parsed = parseConfig({ HOPPER_LAUNCHER_PATH: configured });
    expect(parsed).toMatchObject({
      ok: true,
      value: { hopperLauncherPath: configured },
    });
  });
});

describe("Ghidra decompile limit configuration", () => {
  it.each([
    [undefined, undefined],
    ["1", 1],
    ["30", 30],
    ["86400", 86_400],
    ["86401", 86_401],
    ["2147483", 2_147_483],
  ] as const)(
    "reads the Ghidra decompile limit %j as %j seconds",
    (value, expected) => {
      const result = parseConfig(
        value === undefined
          ? {}
          : { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: value },
      );
      if (!result.ok) throw result.error;
      expect(result.value.ghidraDecompileTimeoutSeconds).toBe(expected);
    },
  );

  it.each(["", "0", "-1", "1.5", "30s", "2147484", "2147483647"])(
    "rejects malformed Ghidra decompile limit %j with its setting",
    (value) => {
      const result = parseConfig({
        REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: value,
      });
      if (result.ok) throw new Error("Expected invalid decompile limit");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "configuration_invalid",
        details: {
          settings: [
            {
              setting: "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
              constraint: expect.any(String),
            },
          ],
        },
      });
    },
  );
});
