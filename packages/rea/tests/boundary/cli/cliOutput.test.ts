import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

import {
  normalizeCliArguments,
  adaptCliOutputArgumentsForIncur,
} from "../../../src/cliBuiltinArguments.js";
import {
  renderCliOutputArgumentError,
  renderCliDocument,
  renderEmptyFilteredCliOutput,
  renderVersionReport,
  parseCliOutputArguments,
} from "../../../src/cliOutput.js";

const CLI_INTEGRATION_TIMEOUT_MS = 60_000;

describe("CLI output argument boundary", () => {
  it("requires an exact row selector and explicit columns for delimited formats", () => {
    expect(
      parseCliOutputArguments(["rows", "--format", "csv"]).validation,
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OUTPUT_COMBINATION",
    });
    expect(
      parseCliOutputArguments([
        "rows",
        "--format",
        "tsv",
        "--filter-output",
        "normalized_result.items",
        "--columns",
        "name, version",
      ]),
    ).toMatchObject({
      columns: ["name", "version"],
      validation: { ok: true },
    });
    for (const fields of ["name,,version", "name,name"])
      expect(
        parseCliOutputArguments([
          "rows",
          "--format",
          "csv",
          "--filter-output",
          "items",
          "--columns",
          fields,
        ]).validation,
      ).toMatchObject({ ok: false, code: "INVALID_OUTPUT_VALUE" });
    expect(
      parseCliOutputArguments([
        "rows",
        "--format",
        "csv",
        "--filter-output",
        "items",
        "--columns",
        "",
      ]).validation,
    ).toMatchObject({ ok: false, code: "MISSING_OUTPUT_VALUE" });
    expect(
      parseCliOutputArguments([
        "rows",
        "--format",
        "csv",
        "--filter-output",
        "items",
        "--columns",
        "name",
        "--token-count",
      ]).validation,
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_OUTPUT_COMBINATION" });
  });

  it("adapts REA-owned delimited options only at the Incur boundary", () => {
    expect(
      adaptCliOutputArgumentsForIncur([
        "inspect-analysis-view",
        "--format",
        "csv",
        "--columns",
        "name,version",
        "--filter-output",
        "normalized_result.items",
      ]),
    ).toEqual([
      "inspect-analysis-view",
      "--format",
      "json",
      "--filter-output",
      "normalized_result.items",
    ]);
  });

  it("uses the shared Markdown table formatter for standalone reports", () => {
    const value = { text: "left|right\\path\nnext" };
    expect(renderCliDocument(value, "md", false)).toContain(
      "left\\|right\\\\path<br>next",
    );
    expect(JSON.parse(renderCliDocument(value, "json", false))).toEqual(value);
  });

  it("preserves literal HTML and entity text in Markdown table headers and cells", () => {
    const value = [{ "List<T>": "&copy; <br>\r\nnext" }];
    const markdown = renderCliDocument(value, "md", false);
    expect(markdown).toContain("List&lt;T&gt;");
    expect(markdown).toContain("&amp;copy; &lt;br&gt;<br>next");
    expect(JSON.parse(renderCliDocument(value, "json", false))).toEqual(value);
  });

  it("rejects token windows that would corrupt structured output", () => {
    for (const format of ["json", "jsonl", "yaml"] as const) {
      const validation = parseCliOutputArguments([
        "providers",
        "--token-limit",
        "5",
        "--format",
        format,
      ]).validation;
      expect(validation).toMatchObject({
        ok: false,
        format,
        code: "UNSUPPORTED_OUTPUT_COMBINATION",
      });
      if (!validation.ok) {
        const rendered = renderCliOutputArgumentError(validation);
        expect(rendered).not.toContain("[truncated:");
        if (format === "jsonl")
          expect(JSON.parse(rendered)).toMatchObject({
            $rea: "jsonl/v1",
            type: "error",
            result: {
              ok: false,
              error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
            },
          });
        else if (format === "json")
          expect(JSON.parse(rendered)).toMatchObject({
            ok: false,
            error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
          });
        else
          expect(rendered).toMatch(
            /^ok: false\nerror:\n  code: UNSUPPORTED_OUTPUT_COMBINATION\n/u,
          );
      }
    }
    expect(
      parseCliOutputArguments([
        "providers",
        "--token-limit",
        "5",
        "--format",
        "toon",
      ]).validation,
    ).toEqual({ ok: true });
    expect(
      parseCliOutputArguments(["providers", "--token-count", "--json"])
        .validation,
    ).toEqual({ ok: true });
  });
});

it("formats arrays of empty objects without column keys as JSON in Markdown", () => {
  expect(renderCliDocument([{}], "md", false)).toBe("\\[\\{\\}\\]\n");
  expect(renderCliDocument([{}, {}], "md", false)).toBe(
    "\\[\\{\\},\\{\\}\\]\n",
  );
  expect(renderCliDocument({ empty: [{}] }, "md", false)).toBe(
    "## empty\n\n\\[\\{\\}\\]\n",
  );
});

it("preserves flag-shaped values consumed by valued output options", () => {
  expect(
    adaptCliOutputArgumentsForIncur([
      "--filter-output",
      "--columns",
      "providers",
      "--json",
    ]),
  ).toEqual(["--filter-output", "--columns", "providers", "--json"]);
});

describe("CLI output value admission", () => {
  it.each(["--token-limit", "--token-offset"])(
    "rejects invalid %s values before dispatch and preserves later JSON selection",
    (flag) => {
      for (const value of [
        "-1",
        "0.5",
        "NaN",
        "Infinity",
        "9007199254740992",
      ]) {
        const validation = parseCliOutputArguments([
          "providers",
          flag,
          value,
          "--json",
        ]).validation;
        expect(validation).toMatchObject({
          ok: false,
          format: "json",
          code: "INVALID_OUTPUT_VALUE",
        });
        if (!validation.ok)
          expect(
            JSON.parse(renderCliOutputArgumentError(validation)),
          ).toMatchObject({
            ok: false,
            error: { code: "INVALID_OUTPUT_VALUE" },
          });
      }
      for (const value of ["0", "1", "9007199254740991"])
        expect(
          parseCliOutputArguments(["providers", flag, value]).validation,
        ).toEqual({ ok: true });
    },
  );

  it("excludes explicitly declared literals from early output diagnostics", () => {
    const validation = parseCliOutputArguments([
      "--format",
      "private-marker",
      "--sensitive-value=private-marker",
      "--json",
    ]).validation;
    expect(validation).toMatchObject({
      ok: false,
      format: "json",
      code: "INVALID_OUTPUT_VALUE",
      message: expect.stringContaining("[REDACTED]"),
    });
    expect(JSON.stringify(validation)).not.toContain("private-marker");
  });

  it("retains valid output selections on either side of a malformed value", () => {
    for (const arguments_ of [
      ["--json", "--format", "invalid"],
      ["--format", "invalid", "--json"],
      ["--token-limit", "invalid", "--json"],
    ])
      expect(parseCliOutputArguments(arguments_).validation).toMatchObject({
        ok: false,
        format: "json",
        code: "INVALID_OUTPUT_VALUE",
      });
    expect(
      parseCliOutputArguments(["--format", "jsonl", "--format", "invalid"])
        .validation,
    ).toMatchObject({
      ok: false,
      format: "jsonl",
      code: "INVALID_OUTPUT_VALUE",
    });
    expect(
      parseCliOutputArguments(["--format", "yaml", "--token-offset", "-1"])
        .validation,
    ).toMatchObject({
      ok: false,
      format: "yaml",
      code: "INVALID_OUTPUT_VALUE",
    });
  });
});

describe("CLI output flag value forms", () => {
  it.each(["--filter-output", "--format", "--token-limit", "--token-offset"])(
    "preserves a flag-shaped spaced value owned by %s",
    (flag) => {
      expect(
        normalizeCliArguments([flag, "--format=json", "providers", "--json"]),
      ).toEqual([flag, "--format=json", "providers", "--json"]);
    },
  );

  workspaceCliTest(
    "keeps a flag-shaped filter value equivalent in spaced and equals forms",
    async ({ cli }) => {
      for (const filter of [
        ["--filter-output", "--format=json"],
        ["--filter-output=--format=json"],
      ]) {
        const result = await cli.run({
          arguments: [...filter, "providers", "--json"],
          timeoutMs: 10_000,
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({});
        expect(result.stderr).toBe("");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  it("splits only the equals forms of valued output flags", () => {
    expect(
      normalizeCliArguments([
        "inspect-sqlite-database",
        "--table=a=b",
        "--format=json",
        "--filter-output=a.b,c[0,1]",
        "--token-limit=5",
        "--token-offset=",
        "--json",
        "--format-hint=x",
      ]),
    ).toEqual([
      "inspect-sqlite-database",
      "--table=a=b",
      "--format",
      "json",
      "--filter-output",
      "a.b,c[0,1]",
      "--token-limit",
      "5",
      "--token-offset",
      "",
      "--json",
      "--format-hint=x",
    ]);
  });

  it("reports a missing value only for a flag the parser did not consume", () => {
    expect(
      parseCliOutputArguments([
        "capabilities",
        "--json",
        "--filter-output",
        "--format",
      ]).validation,
    ).toEqual({ ok: true });
    expect(
      parseCliOutputArguments(["capabilities", "--json", "--format"])
        .validation,
    ).toMatchObject({ ok: false, code: "MISSING_OUTPUT_VALUE" });
  });
});

describe("unclosed CLI output filter slices", () => {
  it.each([
    "providers[",
    "providers[0,1].name[",
    "name,providers[",
    "][,]",
    "providers],name[0,1]",
  ])("rejects %s before the filter parser runs", (filter) => {
    expect(
      parseCliOutputArguments([
        "providers",
        "--json",
        "--filter-output",
        filter,
      ]).validation,
    ).toMatchObject({ ok: false, code: "INVALID_OUTPUT_FILTER" });
  });

  it("preserves effective-filter and earlier flag-error precedence", () => {
    for (const arguments_ of [
      [
        "--filter-output",
        "providers[",
        "--filter-output",
        "capabilities[0,1].provider.id,open",
      ],
      ["--filter-output", "capabilities[-1,].provider.id"],
      ["--filter-output", "capabilities[[0,1]"],
    ])
      expect(parseCliOutputArguments(arguments_).validation).toEqual({
        ok: true,
      });
  });

  workspaceCliTest(
    "fails promptly across output formats without invoking the command",
    async ({ cli }) => {
      for (const format of ["json", "jsonl", "yaml", "toon", "md"]) {
        const result = await cli.run({
          arguments: [
            "analyze",
            "/absent/target",
            "--format",
            format,
            "--filter-output",
            "result[0,1].name[",
          ],
          timeoutMs: 3000,
        });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("INVALID_OUTPUT_FILTER");
        expect(result.stdout).toContain("closing ]");
        expect(result.stderr).toBe("");
      }
      const splitPath = await cli.run({
        arguments: ["providers", "--json", "--filter-output", "][,]"],
        timeoutMs: 3000,
      });
      expect(splitPath.exitCode).toBe(1);
      expect(splitPath.json).toMatchObject({
        ok: false,
        error: { code: "INVALID_OUTPUT_FILTER" },
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "retains closed slices and multiple filter paths",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "providers",
          "--json",
          "--filter-output",
          "capabilities[0,1].provider.id,open",
        ],
        timeoutMs: 3000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toEqual({
        capabilities: [{ provider: { id: expect.any(String) } }],
        open: false,
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("CLI output valued-flag parsing", () => {
  workspaceCliTest(
    "preserves complete JSON errors when native builtin flags follow unusual arguments",
    async ({ cli }) => {
      for (const arguments_ of [
        ["providers", "--", "--json", "--token-limit", "5"],
        ["providers", "--format=json", "--token-limit=5"],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).not.toContain("[truncated:");
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: false,
          error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
        });
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "fails before emitting a truncated JSON document",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: ["providers", "--token-limit", "5", "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "names missing output values and honors equals-style output values",
    async ({ cli }) => {
      for (const [arguments_, flag] of [
        [["capabilities", "--json", "--format", ""], "--format"],
        [["capabilities", "--json", "--filter-output", ""], "--filter-output"],
        [["capabilities", "--json", "--token-limit", ""], "--token-limit"],
        [["capabilities", "--json", "--token-offset="], "--token-offset"],
        [["capabilities", "--format"], "--format"],
      ] as const) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).not.toContain("[truncated:");
        expect(result.json).toMatchObject({
          ok: false,
          error: {
            code: "MISSING_OUTPUT_VALUE",
            message: expect.stringContaining(`${flag} requires a value`),
          },
        });
      }
      const equalsForms = await cli.run({
        arguments: [
          "capabilities",
          "--format=json",
          "--filter-output=capabilities[0,1]",
        ],
      });
      expect(equalsForms.exitCode).toBe(0);
      expect(equalsForms.json).toMatchObject({
        capabilities: [expect.any(Object)],
      });
      const equalsTokenWindow = await cli.run({
        arguments: ["capabilities", "--json", "--token-limit=5"],
      });
      expect(equalsTokenWindow.exitCode).toBe(1);
      expect(equalsTokenWindow.json).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });
      const validTokenWindow = await cli.run({
        arguments: ["capabilities", "--json", "--token-limit", "5"],
      });
      expect(validTokenWindow.exitCode).toBe(1);
      expect(validTokenWindow.json).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });
      const emptyFormatWithTokenWindow = await cli.run({
        arguments: [
          "capabilities",
          "--json",
          "--format",
          "",
          "--token-limit",
          "5",
        ],
      });
      expect(emptyFormatWithTokenWindow.exitCode).toBe(1);
      expect(emptyFormatWithTokenWindow.stdout).not.toContain("[truncated:");
      expect(emptyFormatWithTokenWindow.json).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });

      for (const arguments_ of [
        ["capabilities", "--json", "--token-limit", "not-a-number"],
        [
          "capabilities",
          "--format",
          "unsupported-format",
          "--json",
          "--token-limit",
          "5",
        ],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          ok: false,
          error: { code: "INVALID_OUTPUT_VALUE" },
        });
        expect(result.stdout).not.toContain("[truncated:");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("CLI output argument boundary", () => {
  it("renders an explicit empty projection for structured filtered output", () => {
    for (const format of ["json", "jsonl", "yaml"])
      expect(
        renderEmptyFilteredCliOutput(
          parseCliOutputArguments([
            "providers",
            "--format",
            format,
            "--filter-output",
            "missing",
          ]),
        ),
      ).toBe("{}\n");
    expect(
      renderEmptyFilteredCliOutput(
        parseCliOutputArguments(["providers", "--filter-output", "missing"]),
      ),
    ).toBeUndefined();
    expect(
      renderEmptyFilteredCliOutput(
        parseCliOutputArguments(["providers", "--format", "json"]),
      ),
    ).toBeUndefined();
  });
});

describe("compiled CLI output boundary", () => {
  workspaceCliTest(
    "emits valid JSON when an output filter misses the top-level result",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "analyze-javascript-application",
          "tests/conformance/readiness/javascript-cli",
          "--format",
          "json",
          "--filter-output",
          "summary",
        ],
      });
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "{}\n",
        stderr: expect.stringContaining('"rea_progress":'),
        json: {},
      });
      const nested = await cli.run({
        arguments: [
          "analyze-javascript-application",
          "tests/conformance/readiness/javascript-cli",
          "--format",
          "json",
          "--filter-output",
          "normalized_result.not_a_field",
        ],
      });
      expect(nested).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining('"rea_progress":'),
        json: { normalized_result: {} },
      });
      const selected = await cli.run({
        arguments: [
          "analyze-javascript-application",
          "tests/conformance/readiness/javascript-cli",
          "--format",
          "json",
          "--filter-output",
          "normalized_result.summary",
        ],
      });
      expect(selected).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining('"rea_progress":'),
        json: {
          normalized_result: {
            summary: expect.objectContaining({ browser_windows: 0 }),
          },
        },
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "preserves missing-argument coordinates through every dispatcher formatter",
    async ({ cli }) => {
      const json = await cli.run({ arguments: ["--json", "analyze"] });
      expect(json).toMatchObject({
        exitCode: 1,
        json: {
          code: "VALIDATION_ERROR",
          message: expect.stringMatching(/\S/u),
          fieldErrors: [
            {
              path: "path",
              code: "invalid_type",
              missing: true,
              expected: "string",
            },
          ],
        },
      });
      for (const arguments_ of [
        ["analyze"],
        ["--format", "yaml", "analyze"],
        ["--full-output", "analyze"],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("VALIDATION_ERROR");
        expect(result.stdout).toContain("fieldErrors");
        expect(result.stdout).toContain("path");
        expect(result.stdout).toContain("expected string");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "preserves invalid option names and enum constraints in structured diagnostics",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "search",
          "/caller/local/input",
          "needle",
          "--kind",
          "unrecognized",
          "--json",
        ],
      });
      expect(result).toMatchObject({
        exitCode: 1,
        json: {
          code: "VALIDATION_ERROR",
          fieldErrors: [
            {
              path: "kind",
              code: "invalid_value",
              missing: false,
              message: expect.stringContaining('"strings"|"procedures"'),
            },
          ],
        },
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "prints field-specific missing-argument recovery in terminal mode",
    async ({ processes }) => {
      const result = await processes.run(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          [
            'import { createCli } from "./dist/cli.js";',
            'Object.defineProperty(process.stdout, "isTTY", { value: true });',
            'await createCli({}).serve(["analyze"], { exit: (code) => { process.exitCode = code; } });',
          ].join("\n"),
        ],
        { cwd: process.cwd() },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        "Error: missing required argument <path>",
      );
      expect(result.stdout).toContain("See below for usage.");
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("compiled CLI artifact diagnostics", () => {
  workspaceCliTest(
    "preserves artifact diagnostics in JSON output",
    async ({ cli, workspace }) => {
      const source = workspace.path("source");
      await mkdir(source);
      await writeFile(join(source, "main.js"), "console.log('ok');\n");
      const archive = workspace.path("fixture.asar");
      await createPackageWithOptions(source, archive, { unpack: "*.js" });
      await writeFile(join(`${archive}.unpacked`, "main.js"), "changed();\n");

      const result = await cli.run({
        arguments: ["--json", "inspect-artifact", archive],
      });
      expect(result.exitCode).toBe(1);
      const sha256 = (value: string) =>
        createHash("sha256").update(value).digest("hex");
      expect(result.json).toMatchObject({
        code: "artifact_integrity_mismatch",
        details: {
          logical_path: "main.js",
          declared_sha256: sha256("console.log('ok');\n"),
          calculated_sha256: sha256("changed();\n"),
          unpacked: true,
        },
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});

describe("CLI update root alias", () => {
  it.each([
    [["--update"], ["update"]],
    [
      ["--json", "--update", "--filter-output=status"],
      ["update", "--json", "--filter-output", "status"],
    ],
    [
      ["--format=yaml", "--update", "--full-output"],
      ["update", "--format", "yaml", "--full-output"],
    ],
    [
      ["--update", "--token-limit=100", "--token-count"],
      ["update", "--token-limit", "100", "--token-count"],
    ],
    [["--update", "--update"], ["update"]],
    [
      ["--filter-output", "--update"],
      ["--filter-output", "--update"],
    ],
    [
      ["--filter-output=--update", "--update"],
      ["update", "--filter-output", "--update"],
    ],
    [
      ["--update", "--help"],
      ["--update", "--help"],
    ],
    [
      ["--incur-update-check", "--update"],
      ["--incur-update-check", "--update"],
    ],
    [
      ["providers", "--update"],
      ["providers", "--update"],
    ],
    [
      ["--", "--update"],
      ["--", "--update"],
    ],
    [
      ["--config", "--update"],
      ["--config", "--update"],
    ],
    [
      ["update", "--json"],
      ["update", "--json"],
    ],
  ])(
    "routes only an unambiguous root update while retaining option data: %j",
    (input, expected) => {
      expect(normalizeCliArguments(input)).toEqual(expected);
      expect(normalizeCliArguments(expected)).toEqual(expected);
    },
  );
});

describe("version report requests", () => {
  it.each([
    [["--version", "--json"], "json"],
    [["--json", "--version"], "json"],
    [["--version", "--format", "yaml"], "yaml"],
    [normalizeCliArguments(["--version", "--format=toon"]), "toon"],
    // Without an explicit format, Incur prints the bare version.
    [["--version"], undefined],
    // Help keeps precedence over --version.
    [["--version", "--json", "--help"], undefined],
    [["-h", "--version", "--json"], undefined],
    // A command keeps its own --version option.
    [["providers", "--version", "--json"], undefined],
    [["--version", "1", "--json"], undefined],
    // Other output controls keep Incur's handling.
    [["--version", "--json", "--filter-output", "version"], undefined],
    [["--version", "--json", "--token-count"], undefined],
    [["--version", "--format", "xml"], undefined],
    [["--version", "--format"], undefined],
    [["--json"], undefined],
  ] as const)("reads %j as format %s", (arguments_, expected) => {
    expect(parseCliOutputArguments(arguments_).versionReportFormat).toBe(
      expected,
    );
  });
});

describe("version report rendering", () => {
  const host = {
    packageName: "rea-agents",
    packageVersion: "6.7.0",
    versions: { node: "24.22.1" },
    platform: "linux",
    architecture: "x64",
  };

  it("indents JSON for a terminal and compacts it when piped", () => {
    const terminal = renderVersionReport(
      parseCliOutputArguments(["--version", "--json"]),
      host,
      true,
    );
    const piped = renderVersionReport(
      parseCliOutputArguments(["--version", "--json"]),
      host,
      false,
    );

    expect(terminal?.split("\n").length).toBeGreaterThan(2);
    expect(piped?.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(terminal ?? "")).toEqual(JSON.parse(piped ?? ""));
  });

  it("leaves plain --version to Incur", () => {
    expect(
      renderVersionReport(parseCliOutputArguments(["--version"]), host, true),
    ).toBeUndefined();
  });
});
