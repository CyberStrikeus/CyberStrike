import { describe, expect } from "vitest";

import {
  cliTest,
  runFileCli,
  type CliResult,
} from "../../support/cli/cliFixture.js";

const SESSION_ID = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
const NON_INTEGER_TEXT = [
  "",
  " ",
  "\t",
  "1\n",
  "0x1",
  "0b1",
  "1e0",
  "+1",
  "1.0",
  "9007199254740992",
];
const NON_INTEGER_OPTION_TEXT = [...NON_INTEGER_TEXT, "-0"];

const expectCliValidationError = (result: CliResult, field: string): void => {
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining(field) }),
    ]),
  });
};

describe("CLI integer arguments", () => {
  // Run independent processes before retaining the shared validation worker.
  cliTest.for(NON_INTEGER_OPTION_TEXT)(
    "rejects %j as an Android method overload index",
    async (value, { cli }) => {
      const result = await cli.run({
        arguments: [
          "inspect-android-method",
          "/nonexistent/missing.apk",
          "com.example.Main",
          "run",
          `--overload-index=${value}`,
          "--json",
        ],
      });

      expectCliValidationError(result, "overloadIndex");
    },
  );

  cliTest(
    "keeps an explicit decimal zero as an Android method overload index",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "inspect-android-method",
          "/nonexistent/missing.apk",
          "com.example.Main",
          "run",
          "--overload-index=0",
          "--json",
        ],
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "target_unavailable",
      });
    },
  );

  cliTest(
    "keeps an explicit decimal zero as an Android reference overload index",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "trace-android-references",
          "/nonexistent/missing.apk",
          "com.example.Main",
          "--overload-index=0",
          "--json",
        ],
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "target_unavailable",
      });
    },
  );

  cliTest(
    "keeps the one-based source line lower bound at the CLI boundary",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "trace-web-source-location",
          "/nonexistent/manifest.json",
          "0",
          "/nonexistent/app.js.map",
          "https://example.test/app.js.map",
          "0",
          "0",
          "--json",
        ],
      });

      expectCliValidationError(result, "line");
    },
  );

  cliTest.for(NON_INTEGER_OPTION_TEXT)(
    "rejects %j as an Android reference overload index",
    async (value, { cli }) => {
      const result = await runFileCli(cli, {
        arguments: [
          "trace-android-references",
          "/nonexistent/missing.apk",
          "com.example.Main",
          `--overload-index=${value}`,
          "--json",
        ],
      });

      expectCliValidationError(result, "overloadIndex");
    },
  );

  cliTest.for(NON_INTEGER_TEXT)(
    "rejects %j as a Cutter expected generation",
    async (value, { cli }) => {
      const result = await runFileCli(cli, {
        arguments: ["cutter-command", SESSION_ID, value, "pdi", "--json"],
      });

      expectCliValidationError(result, "expectedGeneration");
    },
  );

  cliTest.for(NON_INTEGER_TEXT)(
    "rejects %j as a web module script index",
    async (value, { cli }) => {
      const result = await runFileCli(cli, {
        arguments: [
          "trace-web-module-imports",
          "/nonexistent/manifest.json",
          value,
          "--json",
        ],
      });

      expectCliValidationError(result, "scriptIndex");
    },
  );

  cliTest.for(NON_INTEGER_OPTION_TEXT)(
    "rejects %j in a repeated web capture record selector",
    async (value, { cli }) => {
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-web-network-capture",
          "/nonexistent/capture.qlog",
          "qlog",
          "--record",
          "0",
          "--record",
          value,
          "--json",
        ],
      });

      expectCliValidationError(result, "record");
    },
  );
});
