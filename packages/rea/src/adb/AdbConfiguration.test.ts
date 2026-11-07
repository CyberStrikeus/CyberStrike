import { describe, expect, it } from "vitest";

import {
  ADB_BINARY_ENV,
  parseAdbVersionOutput,
  resolveAdbBinary,
} from "./AdbConfiguration.js";

describe("resolveAdbBinary", () => {
  it("prefers an absolute REA_ADB_PATH", async () => {
    expect(
      await resolveAdbBinary({ [ADB_BINARY_ENV]: "/opt/tools/adb" }, "linux"),
    ).toEqual({
      binary: "/opt/tools/adb",
      pathSource: "environment",
      environment: { [ADB_BINARY_ENV]: "/opt/tools/adb" },
    });
  });

  it.skipIf(process.platform === "win32")(
    "falls back to POSIX PATH resolution without the environment key",
    async () => {
      expect(await resolveAdbBinary({})).toEqual({
        binary: "adb",
        pathSource: "path",
        environment: {},
      });
      expect(await resolveAdbBinary({ [ADB_BINARY_ENV]: "  " })).toEqual({
        binary: "adb",
        pathSource: "path",
        environment: { [ADB_BINARY_ENV]: "  " },
      });
    },
  );

  it("does not defer a missing Windows PATH selection to process creation", async () => {
    await expect(
      resolveAdbBinary({ Path: "", PathExt: ".EXE" }, "win32"),
    ).rejects.toMatchObject({ code: "binary_missing" });
  });

  it("rejects a relative environment path explicitly", async () => {
    await expect(
      resolveAdbBinary({ [ADB_BINARY_ENV]: "tools/adb" }),
    ).rejects.toThrow(/must be an absolute path/u);
  });
});

describe("parseAdbVersionOutput", () => {
  it("reads the build version and install path from real output", () => {
    expect(
      parseAdbVersionOutput(
        [
          "Android Debug Bridge version 1.0.41",
          "Version 34.0.5-debian",
          "Installed as /usr/lib/android-sdk/platform-tools/adb",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      version: "34.0.5-debian",
      installedPath: "/usr/lib/android-sdk/platform-tools/adb",
    });
  });

  it("reports null identity fields when the named lines are absent", () => {
    expect(parseAdbVersionOutput("unexpected output")).toEqual({
      version: null,
      installedPath: null,
    });
  });

  it("does not accept arbitrary successful output as an adb version", () => {
    expect(
      parseAdbVersionOutput(
        "Android Debug Bridge version tomorrow\nVersion unknown\n",
      ),
    ).toMatchObject({ version: null });
  });
});
