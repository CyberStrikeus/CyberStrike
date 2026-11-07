import { win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWindowsProviderExecutable } from "../../src/composition/resolveWindowsProviderExecutable.js";
import { createReverseEngineeringCommandPort } from "../../src/composition/reverseEngineering.js";

const windowsLookup = (cwd: string, files: readonly string[]) => {
  const existingFiles = new Set(
    files.map((path) => win32.normalize(path).toLowerCase()),
  );
  return {
    cwd,
    isFile: (path: string): boolean =>
      existingFiles.has(win32.normalize(path).toLowerCase()),
  };
};

describe("resolveWindowsProviderExecutable", () => {
  it("resolves a bare name from quoted and relative Windows PATH entries", () => {
    const cwd = "C:\\work";
    const expected = "C:\\work\\Program Files\\REA Tools\\objdump.EXE";
    expect(
      resolveWindowsProviderExecutable(
        "objdump",
        {
          PATH: `.;".\\Program Files\\REA Tools";D:\\unused`,
          PATHEXT: ".COM;.EXE;.BAT",
        },
        windowsLookup(cwd, [expected]),
      ),
    ).toBe(expected);
  });

  it("resolves a relative configured path against the caller's Windows CWD", () => {
    expect(
      resolveWindowsProviderExecutable(
        ".\\tools\\objdump.exe",
        {},
        windowsLookup("D:\\analysis", []),
      ),
    ).toBe("D:\\analysis\\tools\\objdump.exe");
  });

  it("resolves relative PATH hits to absolute drive paths", () => {
    const expected = "D:\\analysis\\bin\\rizin.EXE";
    expect(
      resolveWindowsProviderExecutable(
        "rizin",
        { PATH: ".\\bin", PATHEXT: ".EXE" },
        windowsLookup("D:\\analysis", [expected]),
      ),
    ).toBe(expected);
  });

  it("skips script extensions and preserves a caller-selected absolute path", () => {
    const expected = "C:\\tools\\rizin.EXE";
    const selected = "C:\\tools\\rizin.exe";
    expect(
      resolveWindowsProviderExecutable(
        "rizin",
        { PATH: "C:\\tools", PATHEXT: ".CMD;.BAT;.EXE;.COM" },
        windowsLookup("C:\\work", ["C:\\tools\\rizin.CMD", expected]),
      ),
    ).toBe(expected);
    expect(
      resolveWindowsProviderExecutable(
        selected,
        {},
        windowsLookup("D:\\work", []),
      ),
    ).toBe(selected);
  });

  it("keeps unresolved bare command names unchanged", () => {
    expect(
      resolveWindowsProviderExecutable(
        "missing-tool",
        { PATH: ".\\tools", PATHEXT: ".EXE" },
        windowsLookup("C:\\work", []),
      ),
    ).toBe("missing-tool");
  });

  it("passes an absolute selected command through provider composition", () => {
    const commands = createReverseEngineeringCommandPort(
      { REA_OBJDUMP_COMMAND: "C:\\tools\\objdump.exe" },
      "win32",
    );
    expect(
      commands.objdump({ path: "artifact", operation: "file_headers" })
        .executable,
    ).toBe("C:\\tools\\objdump.exe");
  });
});
