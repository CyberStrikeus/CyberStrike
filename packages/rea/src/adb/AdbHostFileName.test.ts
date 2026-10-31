import { describe, expect, it } from "vitest";

import { adbHostFileName } from "./AdbHostFileName.js";

describe("adbHostFileName", () => {
  it.each([
    ["/data/local/tmp/notes.txt", "notes.txt"],
    ["/data/data/com.example/databases/app.db", "app.db"],
    ["/sdcard/My Notes.txt", "My Notes.txt"],
    ["/system/etc/hosts", "hosts"],
    [
      "/data/local/tmp/split_config.arm64_v8a.apk",
      "split_config.arm64_v8a.apk",
    ],
    ["/data/local/tmp/résumé.xml", "résumé.xml"],
    ["/data/local/tmp/a-b_c.d", "a-b_c.d"],
    ["/data/local/tmp/a\\b", "a\\b"],
    ["/data/local/tmp/report:2024", "report:2024"],
    ["/data/local/tmp/a*b.txt", "a*b.txt"],
    ["/data/local/tmp/re\u007fport", "re\u007fport"],
  ])("accepts the POSIX device path %s", (devicePath, fileName) => {
    expect(adbHostFileName(devicePath, "linux")).toEqual({
      ok: true,
      fileName,
    });
  });

  it.each([
    ["/", "empty_file_name"],
    ["data/local/tmp/file", "not_absolute_path"],
    ["/data/local/tmp/", "empty_file_name"],
    ["/data/local/tmp/..", "dot_segment"],
    ["/data/local/tmp/.", "dot_segment"],
    ["/data\0/local/tmp/file", "unsupported_character"],
    ["/data/local/tmp/a\0b", "unsupported_character"],
  ] as const)("refuses %s as %s", (devicePath, reason) => {
    expect(adbHostFileName(devicePath)).toEqual({ ok: false, reason });
  });

  it.each([
    ["/data/local/tmp/a\\b", "unsupported_character"],
    ["/data/local/tmp/ta\tb", "unsupported_character"],
    ["/data/local/tmp/CON", "reserved_name"],
    ["/data/local/tmp/nul.txt", "reserved_name"],
    ["/data/local/tmp/com1", "reserved_name"],
    ["/data/local/tmp/LPT9", "reserved_name"],
    ["/data/local/tmp/COM¹.txt", "reserved_name"],
    ["/data/local/tmp/lpt³", "reserved_name"],
    ["/data/local/tmp/report:2024", "unsupported_character"],
    ["/data/local/tmp/report.", "trailing_dot_or_space"],
    ["/data/local/tmp/report ", "trailing_dot_or_space"],
    ["/data/local/tmp/a*b.txt", "unsupported_character"],
    ["/data/local/tmp/a?b.txt", "unsupported_character"],
  ] as const)("rejects %s on Windows as %s", (devicePath, reason) => {
    expect(adbHostFileName(devicePath, "win32")).toEqual({ ok: false, reason });
  });

  it("does not impose non-Windows control restrictions on Windows filenames", () => {
    expect(adbHostFileName("/data/local/tmp/name\u007f.txt", "win32").ok).toBe(
      true,
    );
    expect(adbHostFileName("/data/local/tmp/name\u0085.txt", "win32").ok).toBe(
      true,
    );
  });
});
