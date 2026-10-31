import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cli, z } from "incur";
import { expect, it } from "vitest";

import { createCli } from "../../../src/cli.js";
import { rejectSurplusCliArguments } from "../../../src/cli/strictPositionals.js";
import {
  excludeDeclaredSensitiveArguments,
  explicitSensitiveValueOptions,
} from "../../../src/cli/explicitSensitiveArguments.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

type CliInstance = ReturnType<typeof Cli.create>;
const serve = async (cli: CliInstance, argv: string[]) => {
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...argv, "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  return { stdout, exitCode };
};
const installAdmission = (cli: CliInstance) => {
  const strict = rejectSurplusCliArguments(cli);
  const declared = excludeDeclaredSensitiveArguments(cli);
  const original = cli.serve.bind(cli);
  cli.serve = (argv = [], options = {}) =>
    strict(argv, options, (tokens, selected) =>
      declared(tokens, selected, original),
    );
};

it("rejects surplus public CLI inputs before importing and retains the one-path control", async () => {
  const directory = await createTestTempDirectory(
    "rea-strict-cli-positionals-",
  );
  const path = join(directory, "bundle.json");
  await writeFile(
    path,
    JSON.stringify({
      artifacts: [],
      captures: [],
      environments: [],
      providers: [],
      records: [],
      scenarios: [],
      unknowns: [],
    }),
  );
  const cli = createCli({});
  for (const extra of [["ignored"], ["ignored", "second"]]) {
    const result = await serve(cli, ["evidence-import", path, ...extra]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Unexpected positional arguments");
    for (const value of extra) expect(result.stdout).toContain(value);
  }
  const missingFile = await serve(cli, [
    "evidence-import",
    join(directory, "absent"),
    "extra",
  ]);
  expect(missingFile.exitCode).toBe(1);
  expect(missingFile.stdout).toContain("Unexpected positional arguments");
  const valid = await serve(cli, ["evidence-import", path]);
  expect(valid.exitCode).toBe(0);
  expect(JSON.parse(valid.stdout)).toMatchObject({ imported: 0, total: 0 });
  expect((await serve(cli, ["providers", "ignored"])).exitCode).toBe(1);
  const unknown = await serve(cli, ["providers", "--bogus"]);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stdout).toContain("Unknown flag: --bogus");
});

it("keeps parser-owned aliases, option values and optional arguments without rerunning transforms", async () => {
  let runs = 0;
  let transforms = 0;
  let defaults = 0;
  const cli = Cli.create("strict-fixture", { sync: false });
  cli.command("scalar", {
    args: z.object({
      first: z.string().transform((value) => {
        transforms++;
        return value;
      }),
      second: z.string().optional(),
    }),
    options: z.object({
      selectedValue: z.string(),
      enabled: z.boolean().default(false),
      tag: z.array(z.string()).default([]),
      supplied: z.string().default(() => {
        defaults++;
        return "default";
      }),
      ...explicitSensitiveValueOptions,
    }),
    alias: { selectedValue: "s", enabled: "e" },
    run: ({ args, options }) => {
      runs++;
      return { args, options };
    },
  });
  installAdmission(cli);
  const valid = await serve(cli, [
    "scalar",
    "one",
    "-es",
    "option value",
    "--tag=a",
    "--tag",
    "b",
  ]);
  expect(valid.exitCode).toBe(0);
  expect(JSON.parse(valid.stdout)).toMatchObject({
    args: { first: "one" },
    options: { enabled: true, selectedValue: "option value", tag: ["a", "b"] },
  });
  expect({ runs, transforms, defaults }).toEqual({
    runs: 1,
    transforms: 1,
    defaults: 1,
  });
  const invalid = await serve(cli, [
    "scalar",
    "one",
    "two",
    "sensitive-extra",
    "-s",
    "value",
    "--sensitive-value",
    "sensitive-extra",
  ]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stdout).toContain("Unexpected positional arguments");
  expect(invalid.stdout).not.toContain("sensitive-extra");
  expect({ runs, transforms, defaults }).toEqual({
    runs: 1,
    transforms: 1,
    defaults: 1,
  });
  expect(
    (await serve(cli, ["scalar", "one", "two", "-s", "value"])).exitCode,
  ).toBe(0);
});

it("uses resolved group and alias paths and preserves declared variadic inputs", async () => {
  const group = Cli.create("group", { sync: false });
  group.command("scalar", {
    aliases: ["alias"],
    args: z.object({ value: z.string() }),
    run: ({ args }) => args,
  });
  group.command("many", {
    args: z.object({ values: z.array(z.string()) }),
    run: ({ args }) => args,
  });
  const cli = Cli.create("strict-groups", { sync: false }).command(group);
  installAdmission(cli);
  expect((await serve(cli, ["group", "scalar", "one"])).exitCode).toBe(0);
  expect((await serve(cli, ["group", "scalar", "one", "extra"])).exitCode).toBe(
    1,
  );
  expect((await serve(cli, ["group", "alias", "one"])).exitCode).toBe(0);
  expect((await serve(cli, ["group", "alias", "one", "extra"])).exitCode).toBe(
    1,
  );
  const many = await serve(cli, ["group", "many", "one", "two", "three"]);
  expect(many.exitCode).toBe(0);
  expect(JSON.parse(many.stdout)).toMatchObject({
    values: ["one", "two", "three"],
  });
});

it("preserves counted aliases and negated booleans while checking the positional tail", async () => {
  let runs = 0;
  const cli = Cli.create("strict-counted-flags", { sync: false });
  cli.command("capture", {
    args: z.object({ path: z.string() }),
    options: z.object({
      enabled: z.boolean().default(true),
      verbosity: z.number().default(0).meta({ count: true }),
    }),
    alias: { verbosity: "v" },
    run: ({ args, options }) => {
      runs++;
      return { args, options };
    },
  });
  installAdmission(cli);
  const valid = await serve(cli, ["capture", "one", "--no-enabled", "-vvv"]);
  expect(valid.exitCode).toBe(0);
  expect(JSON.parse(valid.stdout)).toMatchObject({
    args: { path: "one" },
    options: { enabled: false, verbosity: 3 },
  });
  const surplus = await serve(cli, [
    "capture",
    "one",
    "--no-enabled",
    "-vvv",
    "extra",
  ]);
  expect(surplus.exitCode).toBe(1);
  expect(surplus.stdout).toContain("Unexpected positional arguments");
  expect(runs).toBe(1);
});
