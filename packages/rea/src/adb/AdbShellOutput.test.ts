import { describe, expect, it } from "vitest";

import {
  parseAmStartOutput,
  parsePackageChangeOutput,
  parseDumpsysPackageOutput,
  parseWmDensityOutput,
  parseWindowFocusOutput,
} from "./AdbShellOutput.js";

const packageDump = (installerLine: string | undefined): string =>
  [
    "Packages:",
    "  Package [com.example] (abcdef):",
    "    versionName=1.2.3",
    ...(installerLine === undefined ? [] : [`    ${installerLine}`]),
    "    pkgFlags=[ HAS_CODE ]",
    "",
  ].join("\n");

describe("parseDumpsysPackageOutput", () => {
  it.each(["userId", "appId"])(
    "retains the printed %s package identifier",
    (key) => {
      expect(
        parseDumpsysPackageOutput(
          `Packages:\n  Package [com.example] (abcdef):\n    ${key}=10234\n`,
        ).userId,
      ).toBe(10234);
    },
  );
  it.each(["", "  My Build  ", "  ", "null"])(
    "preserves the printed version name %j",
    (versionName) => {
      const result = parseDumpsysPackageOutput(
        `  pkg=Package{abcdef com.example}\n  versionName=${versionName}\n`,
      );
      expect(result.versionName).toBe(versionName);
    },
  );

  it("keeps a reported installer package name", () => {
    expect(
      parseDumpsysPackageOutput(
        packageDump("installerPackageName=com.android.vending"),
      ).installerPackageName,
    ).toBe("com.android.vending");
  });

  // Package Manager prints an absent String field as the text "null"; a
  // missing or empty declaration means the same absence (morluto/rea#3943).
  it.each([
    ["the literal null sentinel", "installerPackageName=null"],
    ["an empty value", "installerPackageName="],
    ["a missing line", undefined],
  ])("reports an absent installer as null for %s", (_case, line) => {
    expect(parseDumpsysPackageOutput(packageDump(line))).toMatchObject({
      versionName: "1.2.3",
      installerPackageName: null,
    });
  });

  // A manifest may declare the literal string "null" as its version name and
  // dumpsys prints it the same way as an absent one, so the text is kept.
  it("keeps a version name printed as the text null", () => {
    expect(
      parseDumpsysPackageOutput(
        packageDump("installerPackageName=null").replace(
          "versionName=1.2.3",
          "versionName=null",
        ),
      ).versionName,
    ).toBe("null");
  });
});

describe("parseWindowFocusOutput display contexts", () => {
  it.each([false, true])(
    "retains both display owners independent of block order: %s",
    (reverse) => {
      const inactive =
        "  Display: mDisplayId=3 rootTasks=0\n  mCurrentFocus=null\n  mFocusedApp=null\n";
      const active =
        "  Display: mDisplayId=0 rootTasks=12\n  mCurrentFocus=Window{active}\n  mFocusedApp=ActivityRecord{active}\n";
      const result = parseWindowFocusOutput(
        reverse ? active + inactive : inactive + active,
      );
      expect(result).toMatchObject({
        focused_window: null,
        focused_app: null,
        focus_summary: "ambiguous",
        focus_contexts: expect.arrayContaining([
          {
            scope: "display",
            display_id: "3",
            header_line: "  Display: mDisplayId=3 rootTasks=0",
            declarations: [
              {
                field: "mCurrentFocus",
                value: null,
                raw_line: "  mCurrentFocus=null",
              },
              {
                field: "mFocusedApp",
                value: null,
                raw_line: "  mFocusedApp=null",
              },
            ],
          },
          {
            scope: "display",
            display_id: "0",
            header_line: "  Display: mDisplayId=0 rootTasks=12",
            declarations: [
              {
                field: "mCurrentFocus",
                value: "Window{active}",
                raw_line: "  mCurrentFocus=Window{active}",
              },
              {
                field: "mFocusedApp",
                value: "ActivityRecord{active}",
                raw_line: "  mFocusedApp=ActivityRecord{active}",
              },
            ],
          },
        ]),
      });
    },
  );

  it("does not pair declarations from different displays", () => {
    expect(
      parseWindowFocusOutput(
        "Display: mDisplayId=0\nmCurrentFocus=Window{one}\nDisplay: mDisplayId=1\nmFocusedApp=ActivityRecord{two}\n",
      ),
    ).toMatchObject({
      focus_summary: "ambiguous",
      focused_window: null,
      focused_app: null,
      focus_contexts: [
        {
          display_id: "0",
          declarations: [{ field: "mCurrentFocus", value: "Window{one}" }],
        },
        {
          display_id: "1",
          declarations: [
            { field: "mFocusedApp", value: "ActivityRecord{two}" },
          ],
        },
      ],
    });
  });

  it("retains an unknown display identity and missing fields without borrowing its neighbor", () => {
    expect(
      parseWindowFocusOutput(
        "Display: vendor-format\nmCurrentFocus=null\nDisplay: mDisplayId=0\n",
      ),
    ).toMatchObject({
      focus_summary: "ambiguous",
      focus_contexts: [
        {
          scope: "display",
          display_id: null,
          header_line: "Display: vendor-format",
          declarations: [{ field: "mCurrentFocus", value: null }],
        },
        { scope: "display", display_id: "0", declarations: [] },
      ],
    });
  });
});

describe("parseWindowFocusOutput declaration presence", () => {
  it("separates missing declarations from explicit absence and retains source lines", () => {
    expect(parseWindowFocusOutput("no declarations\n")).toEqual({
      focused_window: null,
      focused_app: null,
      focus_summary: "unavailable",
      focus_contexts: [],
      observed_lines: [],
    });
    expect(
      parseWindowFocusOutput("  mCurrentFocus=null\nmFocusedApp=null\n"),
    ).toEqual({
      focused_window: null,
      focused_app: null,
      focus_summary: "single_context",
      focus_contexts: [
        {
          scope: "unscoped",
          display_id: null,
          header_line: null,
          declarations: [
            {
              field: "mCurrentFocus",
              value: null,
              raw_line: "  mCurrentFocus=null",
            },
            { field: "mFocusedApp", value: null, raw_line: "mFocusedApp=null" },
          ],
        },
      ],
      observed_lines: ["  mCurrentFocus=null", "mFocusedApp=null"],
    });
  });

  it("retains repeated declarations without choosing one or erasing explicit absence", () => {
    expect(
      parseWindowFocusOutput(
        "mCurrentFocus=null\nmCurrentFocus=Window{later}\nmFocusedApp=ActivityRecord{current}\n",
      ),
    ).toMatchObject({
      focus_summary: "ambiguous",
      focused_window: null,
      focused_app: null,
      focus_contexts: [
        {
          declarations: [
            { field: "mCurrentFocus", value: null },
            { field: "mCurrentFocus", value: "Window{later}" },
            { field: "mFocusedApp", value: "ActivityRecord{current}" },
          ],
        },
      ],
      observed_lines: [
        "mCurrentFocus=null",
        "mCurrentFocus=Window{later}",
        "mFocusedApp=ActivityRecord{current}",
      ],
    });
  });
});

describe("parseDumpsysPackageOutput", () => {
  it.each(["userId", "appId"])(
    "retains the printed %s package identifier",
    (key) => {
      expect(
        parseDumpsysPackageOutput(
          `Packages:\n  Package [com.example] (abcdef):\n    ${key}=10234\n`,
        ).userId,
      ).toBe(10234);
    },
  );
  it("reports unknown requested permissions when the package is null", () => {
    expect(
      parseDumpsysPackageOutput("Package [com.example] (abcdef):\n  pkg=null\n")
        .requestedPermissions,
    ).toBeNull();
  });

  it("reports unknown when package state and the permission section are absent", () => {
    expect(
      parseDumpsysPackageOutput(
        "Package [com.example] (abcdef):\n  versionCode=45\n",
      ).requestedPermissions,
    ).toBeNull();
  });

  it("reports zero only for a confirmed loaded package without the section", () => {
    expect(
      parseDumpsysPackageOutput(
        "Package [com.example] (abcdef):\n  pkg=Package{abcdef com.example}\n",
      ).requestedPermissions,
    ).toBe(0);
  });

  it("counts listed permissions when the section is available", () => {
    expect(
      parseDumpsysPackageOutput(
        "Package [com.example] (abcdef):\n  requested permissions:\n    android.permission.INTERNET\n",
      ).requestedPermissions,
    ).toBe(1);
  });

  it("does not count permissions in the hidden system packages section", () => {
    expect(
      parseDumpsysPackageOutput(
        [
          "Package [com.example] (abcdef):",
          "  pkg=Package{abcdef com.example}",
          "  requested permissions:",
          "    android.permission.INTERNET",
          "Hidden system packages:",
          "  requested permissions:",
          "    com.android.hidden.permission",
        ].join("\n"),
      ).requestedPermissions,
    ).toBe(1);
  });

  it("counts permission names containing hyphens and dollar signs", () => {
    expect(
      parseDumpsysPackageOutput(
        [
          "Package [com.example] (abcdef):",
          "  pkg=Package{abcdef com.example}",
          "  requested permissions:",
          "    com.example.permission-Hyphen",
          "    com.example.permission$Dollar",
        ].join("\n"),
      ).requestedPermissions,
    ).toBe(2);
  });

  it("counts Unicode permission names without ending the section", () => {
    expect(
      parseDumpsysPackageOutput(
        [
          "Package [com.example] (abcdef):",
          "  pkg=Package{abcdef com.example}",
          "  requested permissions:",
          "    com.example.permission-First",
          "    com.example.permission.ÉCRIRE WITH SPACE",
          "    android.permission.CAMERA",
          "  install permissions:",
          "    android.permission.CAMERA: granted=true",
        ].join("\n"),
      ).requestedPermissions,
    ).toBe(3);
  });

  it("ends requested permissions at a same-indent field", () => {
    expect(
      parseDumpsysPackageOutput(
        [
          "Package [com.example] (abcdef):",
          "  pkg=Package{abcdef com.example}",
          "  requested permissions:",
          "    android.permission.INTERNET",
          "  gids=[1000]",
          "    android.permission.CAMERA",
        ].join("\n"),
      ).requestedPermissions,
    ).toBe(1);
  });
});

describe("parseWmDensityOutput", () => {
  it("reads labeled physical and override densities", () => {
    expect(
      parseWmDensityOutput("Physical density: 420\nOverride density: 480\n"),
    ).toEqual({
      physical: 420,
      override: 480,
      numericIssues: { sample: [], total: 0 },
    });
    expect(parseWmDensityOutput("Physical density: 420\n")).toEqual({
      physical: 420,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
  });

  // Older builds print the physical density as a bare number
  // (morluto/rea#3942); it must not be lost as an unread declaration.
  it("reads a bare numeric density as the physical density", () => {
    expect(parseWmDensityOutput("420\n")).toEqual({
      physical: 420,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
    expect(parseWmDensityOutput("420\r\n")).toEqual({
      physical: 420,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
  });

  it("prefers a labeled physical density over a bare number", () => {
    expect(parseWmDensityOutput("560\nPhysical density: 420\n")).toEqual({
      physical: 420,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
  });

  it("reports no density for unrecognized output", () => {
    expect(parseWmDensityOutput("")).toEqual({
      physical: null,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
    expect(parseWmDensityOutput("420dpi\n")).toEqual({
      physical: null,
      override: null,
      numericIssues: { sample: [], total: 0 },
    });
  });
});

const starting =
  "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Main }";

describe("parseAmStartOutput", () => {
  it("recognizes a CRLF wait-timeout report", () => {
    expect(
      parseAmStartOutput(
        `${starting}\r\nStatus: timeout\r\nActivity: com.example/.Main\r\nComplete\r\n`,
      ),
    ).toMatchObject({
      status: "refused",
      activity: "com.example/.Main",
      reportedStatus: "timeout",
      reason: "am start reported status: timeout",
    });
  });

  it("treats every non-ok status as refusal, including a later status after ok", () => {
    expect(
      parseAmStartOutput(`${starting}\nStatus: ok\nStatus: timeout\n`),
    ).toMatchObject({
      status: "refused",
      reportedStatus: "timeout",
      reason: "am start reported status: timeout",
    });
    expect(
      parseAmStartOutput(`${starting}\nStatus: future-value\n`),
    ).toMatchObject({
      status: "refused",
      reportedStatus: "future-value",
    });
  });

  it("gives hard errors in either stream priority over status and attempt", () => {
    expect(
      parseAmStartOutput(
        `${starting}\nStatus: timeout\nActivity: com.example/.Main\n`,
        "Exception: Activity class does not exist\n",
      ),
    ).toEqual({
      status: "refused",
      startedActivity: "act=android.intent.action.MAIN cmp=com.example/.Main",
      activity: "com.example/.Main",
      reportedStatus: "timeout",
      reason: "Activity class does not exist",
    });
    expect(
      parseAmStartOutput(
        `${starting}\nStatus: ok\nError: Activity class does not exist\n`,
      ),
    ).toMatchObject({
      status: "refused",
      reason: "Activity class does not exist",
    });
  });

  it("refuses an unprefixed Java exception even when Starting is present", () => {
    expect(
      parseAmStartOutput(
        `${starting}\njava.lang.SecurityException: Permission Denial\n`,
      ),
    ).toMatchObject({
      status: "refused",
      reason: "java.lang.SecurityException: Permission Denial",
    });
  });

  it("refuses a message-free Java exception even when Starting is present", () => {
    expect(
      parseAmStartOutput(`${starting}\njava.lang.NullPointerException\n`),
    ).toMatchObject({
      status: "refused",
      reason: "java.lang.NullPointerException",
    });
  });

  it("recognizes a base Java exception type with a message", () => {
    expect(
      parseAmStartOutput(`${starting}\njava.lang.Exception: failure\n`),
    ).toMatchObject({
      status: "refused",
      reason: "java.lang.Exception: failure",
    });
  });

  it("prefers a specific Java exception over generic error headers", () => {
    expect(
      parseAmStartOutput(
        [
          starting,
          "Error type 3",
          "Exception occurred while executing command",
          "java.lang.SecurityException: Permission Denial",
        ].join("\n"),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "java.lang.SecurityException: Permission Denial",
    });

    expect(
      parseAmStartOutput(
        [
          starting,
          "Error: Generic launch failure",
          "java.lang.SecurityException: Permission Denial",
        ].join("\n"),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "java.lang.SecurityException: Permission Denial",
    });
  });

  it("keeps Starting-only output compatible and refuses no-attempt output", () => {
    expect(parseAmStartOutput(starting)).toMatchObject({
      status: "started",
      reportedStatus: null,
      activity: null,
    });
    expect(
      parseAmStartOutput("Status: ok\nWarning: Activity not started\n"),
    ).toMatchObject({
      status: "refused",
      startedActivity: null,
      reportedStatus: "ok",
    });
  });
});

describe("parsePackageChangeOutput", () => {
  it.each(["", "Performing Streamed Install\n", "progress"])(
    "keeps an absent package-change verdict unknown: %j",
    (text) => {
      expect(parsePackageChangeOutput(text)).toEqual({
        status: "unknown",
        reason: null,
      });
    },
  );
  it("retains explicit failure even alongside success text", () => {
    expect(parsePackageChangeOutput("Success\nFailure [DENIED]\n")).toEqual({
      status: "failure",
      reason: "DENIED",
    });
    expect(parsePackageChangeOutput("Success\n")).toEqual({
      status: "success",
      reason: null,
    });
  });
});
