import { describe, expect, it } from "vitest";

import {
  GhidraHeadlessLauncher,
  ghidraHeadlessCommand,
  ghidraHeadlessJavaOptions,
} from "./GhidraLauncher.js";
import { ghidraJavaEnvironment } from "./GhidraInstallation.js";

describe("Ghidra headless JVM environment", () => {
  it("passes Windows paths with spaces to Java's environment parser", () => {
    expect(
      ghidraHeadlessJavaOptions(
        "C:\\REA Runtime\\home",
        "C:\\REA Runtime\\tmp",
        "win32",
      ),
    ).toEqual({
      JDK_JAVA_OPTIONS:
        '"-Duser.home=C:\\REA Runtime\\home" "-Djava.io.tmpdir=C:\\REA Runtime\\tmp" "-XX:-UsePerfData"',
      GHIDRA_HEADLESS_JAVA_OPTIONS: "",
    });
  });

  it.each(["%TEMP%", 'quote"', "amp&", "line\n", "nul\0"])(
    "rejects interpreter metacharacters in either Windows JVM path: %s",
    (suffix) => {
      for (const [home, temp] of [
        [`C:\\runtime\\${suffix}`, "C:\\runtime\\tmp"],
        ["C:\\runtime\\home", `C:\\runtime\\${suffix}`],
      ] as const)
        expect(() => ghidraHeadlessJavaOptions(home, temp, "win32")).toThrow(
          /metacharacters/u,
        );
    },
  );
});

it("uses selected mixed-case Windows PATH and ComSpec through direct launch boundaries", () => {
  const environment = {
    Path: "C:\\selected\\tools",
    ComSpec: "C:\\selected\\cmd.exe",
    SystemRoot: "C:\\selected-windows",
  };
  const launcher = new GhidraHeadlessLauncher({
    environment,
    platform: "win32",
    analyzeHeadlessPath: "C:\\ghidra\\support\\analyzeHeadless.bat",
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
    bridgeScriptPath: "C:\\rea\\bridge.py",
  });
  environment.ComSpec = "C:\\changed\\cmd.exe";
  expect(
    ghidraHeadlessCommand({
      environment: launcher.options.environment,
      platform: "win32",
      analyzeHeadlessPath: launcher.options.analyzeHeadlessPath,
      arguments: [],
    }).command,
  ).toBe("C:\\selected\\cmd.exe");
  expect(ghidraJavaEnvironment("C:\\jdk", environment, "win32")).toMatchObject({
    PATH: "C:\\jdk\\bin;C:\\selected\\tools",
    COMSPEC: "C:\\changed\\cmd.exe",
    SYSTEMROOT: "C:\\selected-windows",
  });
  expect(
    ghidraHeadlessCommand({
      environment: { SYSTEMROOT: "C:\\selected-windows" },
      platform: "win32",
      analyzeHeadlessPath: launcher.options.analyzeHeadlessPath,
      arguments: [],
    }).command,
  ).toBe("C:\\selected-windows\\System32\\cmd.exe");
});
