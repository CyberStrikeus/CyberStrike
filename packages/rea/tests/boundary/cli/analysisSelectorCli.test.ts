import { describe, expect } from "vitest";

import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

const selectors = [
  ["function", "procedure", "analyze_function"],
  ["inspect-native-api", "procedure", "inspect_native_api"],
  ["instructions", "procedure", "read_function_instructions"],
  ["decompile", "procedure", "procedure_pseudo_code"],
  ["xrefs", "address", "xrefs"],
  ["search", "pattern", "search_strings"],
  ["trace", "query", "trace_feature"],
] as const;

describe("CLI analysis selector boundaries", () => {
  cliTest(
    "accepts file offsets and rejects mixed coordinate selectors before opening a target",
    async ({ cli }) => {
      const selected = await cli.run({
        arguments: [
          "decompile",
          "does-not-exist",
          "--file-offset=0x210",
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(selected.json).toMatchObject({ code: "target_unavailable" });
      const conflicting = await cli.run({
        arguments: [
          "decompile",
          "does-not-exist",
          "0x140001010",
          "--file-offset=0x210",
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(conflicting.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "procedure_pseudo_code",
          issues: [{ path: ["file-offset"], reason: "invalid_value" }],
        },
      });
    },
  );
  for (const [command, option, operation] of selectors) {
    cliTest(
      `rejects missing and conflicting ${command} selectors before opening a target`,
      async ({ cli }) => {
        for (const [selection, reason] of [
          [[], "missing_argument"],
          [["first", `--${option}=-second`], "invalid_value"],
        ] as const) {
          const result = await cli.run({
            arguments: [
              command,
              "does-not-exist",
              ...selection,
              "--format",
              "json",
            ],
            environment: { REA_LOG_LEVEL: "silent" },
          });
          expect(result.exitCode).not.toBe(0);
          expect(result.json).toMatchObject({
            code: "invalid_request",
            details: { operation, issues: [{ path: [option], reason }] },
          });
        }
      },
    );
    cliTest(
      `keeps named ${command} dash values out of global-option parsing`,
      async ({ cli }) => {
        const result = await cli.run({
          arguments: [
            command,
            "does-not-exist",
            `--${option}=--help`,
            "--format",
            "json",
          ],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.json).toMatchObject({ code: "target_unavailable" });
      },
    );
  }

  cliTest(
    "admits positional, named, and identical selectors before opening a missing target",
    async ({ cli }) => {
      for (const [command, option] of selectors) {
        for (const selection of [
          ["selector"],
          [`--${option}=selector`],
          ["selector", `--${option}=selector`],
        ]) {
          const label = `${command} ${selection.join(" ")}`;
          const result = await runFileCli(cli, {
            arguments: [
              command,
              "does-not-exist",
              ...selection,
              "--format",
              "json",
            ],
            environment: { REA_LOG_LEVEL: "silent" },
          });
          expect(result.exitCode, label).not.toBe(0);
          expect(result.json, label).toMatchObject({
            code: "target_unavailable",
          });
        }
      }
    },
  );
});

cliTest(
  "accepts an Objective-C instance method through inspect-native-api's named selector",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: [
        "inspect-native-api",
        "does-not-exist",
        "--procedure=-[Widget run]",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.json).toMatchObject({ code: "target_unavailable" });
  },
);
