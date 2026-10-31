import { Cli } from "incur";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";

import type { JebAnalysisPort } from "../../../src/application/jeb/JebAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { registerJebCommands } from "../../../src/cli/jebCommands.js";
import { silentLogger } from "../../../src/logger.js";
import { ok } from "../../../src/domain/result.js";
import type { JebRequest } from "../../../src/domain/jeb/jebAnalysis.js";
import { jebResultSchemas } from "../../../src/domain/jeb/jebAnalysis.js";

const invoke = async (argv: readonly string[]) => {
  const requests: JebRequest[] = [];
  const provider: JebAnalysisPort = {
    async inspectAvailability() {
      throw new Error("unexpected provider probe");
    },
    async close() {},
    async execute(request) {
      requests.push(request);
      return ok(
        createAnalysisExecution(
          jebResultSchemas.list_jeb_units.parse({
            engine: {
              name: "JEB test provider",
              version: null,
              endpoint: "http://127.0.0.1:1/mcp",
              gui_client: null,
            },
            filter: null,
            parent_unit_path:
              request.operation === "list_jeb_units"
                ? (request.input.parent_unit_path ?? null)
                : null,
            index: 0,
            count: 100,
            units: [],
            coverage: "complete",
          }),
          { id: "jeb-test", name: "JEB test provider", version: null },
        ),
      );
    },
  };
  const cli = Cli.create("rea-jeb-input-test", { sync: false });
  registerJebCommands(cli, silentLogger, {}, provider);
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...argv], {
    env: {},
    exit: (code) => {
      exitCode = code;
    },
    stdout: (text) => {
      stdout += text;
    },
  });
  return {
    exitCode,
    output: JSON.parse(stdout) as Record<string, unknown>,
    requests,
  };
};

it("keeps JEB CLI correction details aligned with canonical list-unit validation", async () => {
  const invalid = await invoke([
    "list-jeb-units",
    "--parent-unit-path",
    "",
    "--json",
  ]);
  expect(invalid.output).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: [{ path: "parent-unit-path", code: "too_small" }],
  });
  expect(invalid.requests).toEqual([]);

  const valid = await invoke([
    "list-jeb-units",
    "--parent-unit-path",
    "sample.dex",
    "--json",
  ]);
  expect(valid.output).not.toHaveProperty("code");
  expect(valid.requests).toMatchObject([
    { input: { parent_unit_path: "sample.dex" } },
  ]);
});

it("advertises the canonical minimum for a JEB parent unit path", async () => {
  const { output } = await invoke(["list-jeb-units", "--schema", "--json"]);
  const schema = output.options as Parameters<Ajv2020["compile"]>[0];
  const validate = new Ajv2020({ strict: false }).compile(schema);
  expect(validate({ index: 0, count: 100 })).toBe(true);
  expect(validate({ index: 0, count: 100, "parent-unit-path": "" })).toBe(
    false,
  );
  expect(
    validate({ index: 0, count: 100, "parent-unit-path": "sample.dex" }),
  ).toBe(true);
});

it("advertises the canonical nonempty, NUL-free JEB project path", async () => {
  const { output } = await invoke(["open-jeb-project", "--schema", "--json"]);
  const schema = output.args as Parameters<Ajv2020["compile"]>[0];
  const validate = new Ajv2020({ strict: false }).compile(schema);
  expect(validate({ path: "sample.apk" })).toBe(true);
  expect(validate({ path: "" })).toBe(false);
  expect(validate({ path: "sample\u0000.apk" })).toBe(false);
});
