import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { demangleSwiftSchema } from "../../../src/domain/native/nativeInspection.js";
import { evidenceResultOf } from "../../../src/contracts/toolOutputSchemaPrimitives.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";

const demangledSchema = evidenceResultOf(demangleSwiftSchema);
const execute = promisify(execFile);

describe.skipIf(process.platform !== "darwin")(
  "native Swift demangling through MCP",
  () => {
    mcpTest(
      "passes option-like symbols to swift-demangle as symbols",
      async ({ mcp, onTestFinished }) => {
        const target = join(
          await createTestTempDirectory("rea-demangle-mcp-"),
          "tool",
        );
        await copyFile("/usr/bin/true", target);
        const client = await openProductionTarget(mcp, onTestFinished, target);

        const called = await client.callTool({
          name: "demangle_swift",
          arguments: {
            symbols: ["-help", "--simplified", "$s4main3FooV", "carriage\r"],
          },
        });
        expect(called.isError, JSON.stringify(called.content)).not.toBe(true);
        expect(
          demangledSchema.parse(called.structuredContent).normalized_result
            .symbols,
        ).toEqual([
          { input: "-help", output: "-help", status: "unchanged" },
          {
            input: "--simplified",
            output: "--simplified",
            status: "unchanged",
          },
          { input: "$s4main3FooV", output: "main.Foo", status: "demangled" },
          { input: "carriage\r", output: "carriage\r", status: "unchanged" },
        ]);

        const spanning = await client.callTool({
          name: "demangle_swift",
          arguments: { symbols: ["$s4main\n3FooV"] },
        });
        expect(spanning.isError).toBe(true);
        expect(JSON.stringify(spanning.content)).toContain(
          "Each Swift symbol must be one line.",
        );
        const invalidNativeString = await client.callTool({
          name: "demangle_swift",
          arguments: { symbols: ["$s4main\0FooV"] },
        });
        expect(invalidNativeString.isError).toBe(true);
        expect(JSON.stringify(invalidNativeString.content)).toContain(
          "Swift symbols cannot contain NUL.",
        );
      },
    );

    mcpTest(
      "reports undecodable symbols with any Swift mangling prefix as invalid",
      async ({ mcp, onTestFinished }) => {
        const target = join(
          await createTestTempDirectory("rea-demangle-mcp-"),
          "tool",
        );
        await copyFile("/usr/bin/true", target);
        const client = await openProductionTarget(mcp, onTestFinished, target);
        // Embedded Swift ($e) decoding depends on the installed toolchain, so
        // only manglings every supported demangler decodes are expected valid.
        const decodable = ["_T0", "$S", "_$S"];
        const prefixes = [...decodable, "$e", "_$e"];

        const called = await client.callTool({
          name: "demangle_swift",
          arguments: {
            symbols: [
              ...decodable.map((prefix) => `${prefix}4main3FooV`),
              ...prefixes.map((prefix) => `${prefix}Bogus`),
              "_Tprintf",
              // Current swift-demangle prints these undecoded names as
              // _T0Bogus, __stack_chk_fail and $strlen.
              "__T0Bogus",
              "___stack_chk_fail",
              "strlen",
            ],
          },
        });
        expect(called.isError, JSON.stringify(called.content)).not.toBe(true);
        const result = demangledSchema.parse(
          called.structuredContent,
        ).normalized_result;
        const { symbols } = result;
        expect(symbols.map(({ status }) => status)).toEqual([
          ...decodable.map(() => "demangled"),
          ...prefixes.map(() => "invalid"),
          "unchanged",
          "invalid",
          "unchanged",
          "unchanged",
        ]);
        // Toolchain versions can differ in their undecoded spelling. Compare
        // retained Evidence with the actual producer instead of rewriting it
        // to match the input or requiring one toolchain's adjustment.
        const command = result.provenance.find(
          ({ tool }) => tool === "swift-demangle",
        )?.command;
        const executable = command?.[0];
        if (executable === undefined || command === undefined)
          throw new Error("Missing demangler command provenance");
        const { stdout } = await execute(executable, command.slice(1));
        expect(symbols.map(({ output }) => output)).toEqual(
          stdout.replace(/\n$/u, "").split("\n"),
        );
      },
    );
  },
);
