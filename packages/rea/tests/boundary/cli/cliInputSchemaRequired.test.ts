import { Ajv2020 } from "ajv/dist/2020.js";
import { Cli, z } from "incur";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createCli } from "../../../src/cli.js";
import { createCliInventory } from "../../../scripts/lib/catalog-cli.mjs";
import { registerAdbCommands } from "../../../src/cli/adbCommands.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { err } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { adbInputSchemas } from "../../../src/domain/adb/adbDeviceAnalysis.js";
import {
  apktoolInputSchemas,
  MAX_SELECTED_LOCALES,
} from "../../../src/domain/apktool/apktoolResourceAnalysis.js";
import { presentOmittableDefaults } from "../../../src/cli/omittableDefaults.js";

type CliInstance = ReturnType<typeof createCli>;
type CommandMap = NonNullable<ReturnType<typeof Cli.toCommands.get>>;

const INPUT_GROUPS = ["args", "options"] as const;
const registeredCommands: WeakMap<object, CommandMap> = Cli.toCommands;

const advertisedGroupSchema = z
  .object({
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .loose();
const advertisedInputSchema = z.object({
  args: advertisedGroupSchema.optional(),
  options: advertisedGroupSchema.optional(),
});

const serve = async (
  cli: CliInstance,
  argv: readonly string[],
): Promise<{ readonly stdout: string; readonly exitCode: number }> => {
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
  return { stdout, exitCode };
};

const advertisedSchema = async (cli: CliInstance, command: string) => {
  const result = await serve(cli, [command, "--schema", "--json"]);
  expect(result.exitCode, command).toBe(0);
  return advertisedInputSchema.parse(JSON.parse(result.stdout));
};

const parserSchema = (
  cli: CliInstance,
  command: string,
  group: (typeof INPUT_GROUPS)[number],
): z.ZodObject | undefined => {
  const entry = registeredCommands.get(cli)?.get(command);
  if (entry === undefined || !(group in entry)) return undefined;
  const schema: unknown = Reflect.get(entry, group);
  return schema instanceof z.ZodObject ? schema : undefined;
};

/**
 * Reject a key only when an object parse that omits it fails.
 * `exactOptional()` rejects explicit `undefined` and still accepts omission.
 */
const omissionRejected = (schema: z.ZodObject | undefined): string[] =>
  Object.entries(schema?.shape ?? {})
    .filter(([key, field]) => !acceptsOmittedKey(key, field))
    .map(([key]) => key)
    .sort();

const acceptsOmittedKey = (key: string, field: z.ZodType): boolean =>
  z.object({ [key]: field }).safeParse({}).success;

const registerParserAdvertisementInventoryTests = (): void => {
  it("require exactly the inputs whose omission the parser rejects", async () => {
    const cli = createCli({});
    const mismatches: string[] = [];
    for (const command of createCliInventory(cli).primary) {
      const advertised = await advertisedSchema(cli, command);
      for (const group of INPUT_GROUPS) {
        const parser = parserSchema(cli, command, group);
        const advertisedGroup = advertised[group];
        if (parser === undefined) {
          if (advertisedGroup !== undefined)
            mismatches.push(`${command} ${group}: advertised without parser`);
          continue;
        }
        if (advertisedGroup === undefined) {
          mismatches.push(`${command} ${group}: parser group not advertised`);
          continue;
        }
        const parserProperties = Object.keys(parser.shape).toSorted();
        const advertisedProperties = Object.keys(
          advertisedGroup.properties,
        ).toSorted();
        if (advertisedProperties.join() !== parserProperties.join())
          mismatches.push(
            `${command} ${group}: advertised properties [${advertisedProperties.join()}], parser properties [${parserProperties.join()}]`,
          );
        const required = (advertisedGroup.required ?? []).toSorted();
        const rejected = omissionRejected(parser);
        if (required.join() !== rejected.join())
          mismatches.push(
            `${command} ${group}: advertised [${required.join()}], parser rejects [${rejected.join()}]`,
          );
      }
    }
    expect(mismatches).toEqual([]);
  });
};

describe("CLI advertised input schemas", () => {
  registerParserAdvertisementInventoryTests();

  it("preserves client choices, selected path bounds and required decoded steps", async () => {
    const cli = createCli({});
    const ajv = new Ajv2020({ strict: false });
    for (const command of ["setup", "doctor"]) {
      const schema = await advertisedSchema(cli, command);
      const validate = ajv.compile(schema.options ?? {});
      for (const client of ["codex", "unsupported-client"]) {
        const input = { client: [client] };
        expect(validate(input)).toBe(client === "codex");
        expect(
          parserSchema(cli, command, "options")?.safeParse(input).success,
        ).toBe(client === "codex");
      }
    }
    const setup = await advertisedSchema(cli, "setup");
    const validateSkill = ajv.compile(setup.options ?? {});
    for (const skillClient of ["shared", "codex", "unsupported-client"]) {
      const input = { skillClient: [skillClient] };
      expect(validateSkill(input)).toBe(skillClient !== "unsupported-client");
      expect(
        parserSchema(cli, "setup", "options")?.safeParse(input).success,
      ).toBe(skillClient !== "unsupported-client");
    }
    for (const [command, field] of [
      ["inspect-wasm-artifact", "glue_paths"],
      ["inspect-wasm-artifact", "candidate_paths"],
      ["recover-javascript-sources", "additionalPath"],
    ] as const) {
      const schema = await advertisedSchema(cli, command);
      const validate = ajv.compile(schema.options ?? {});
      for (const count of [16, 17]) {
        const input = {
          [field]: Array.from({ length: count }, () => "./selected"),
        };
        expect(validate(input)).toBe(count === 16);
        expect(
          parserSchema(cli, command, "options")?.safeParse(input).success,
        ).toBe(count === 16);
      }
    }
    const scenario = await advertisedSchema(cli, "capture-native-ui-scenario");
    expect(scenario.options?.required).toContain("steps");
    expect(scenario.options?.properties.steps).toMatchObject({
      description: expect.stringContaining("one or more"),
    });
    const desktop = await advertisedSchema(cli, "inspect-desktop-application");
    const validate = ajv.compile(desktop.args ?? {});
    for (const path of ["", ".", "./selected"]) {
      expect(validate({ path })).toBe(path !== "");
      expect(
        parserSchema(cli, "inspect-desktop-application", "args")?.safeParse({
          path,
        }).success,
      ).toBe(path !== "");
    }
  });

  it("allows an omitted WASM timeout while validating explicitly supplied values", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "inspect-wasm-artifact");
    const options = parserSchema(cli, "inspect-wasm-artifact", "options");
    expect(options).toBeDefined();
    const validate = new Ajv2020({ strict: false }).compile(
      advertised.options ?? {},
    );

    expect(options?.safeParse({}).success).toBe(true);
    expect(validate({})).toBe(true);
    expect(options?.safeParse({ commandTimeoutMs: undefined }).success).toBe(
      false,
    );
    for (const commandTimeoutMs of [1, 30_000, 2_147_483_647]) {
      expect(options?.safeParse({ commandTimeoutMs }).success).toBe(true);
      expect(validate({ commandTimeoutMs })).toBe(true);
    }
    for (const commandTimeoutMs of [0, 1.5, 2_147_483_648]) {
      expect(options?.safeParse({ commandTimeoutMs }).success).toBe(false);
      expect(validate({ commandTimeoutMs })).toBe(false);
    }
  });

  it("accepts the one-argument keyed-archive call and keeps its constraints", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "inspect-keyed-archive");
    const ajv = new Ajv2020({ strict: false });
    const args = ajv.compile(advertised.args ?? {});
    const options = ajv.compile(advertised.options ?? {});

    expect(args({ path: "./keyed.plist" })).toBe(true);
    expect(args({})).toBe(false);
    expect(options({})).toBe(true);
    expect(options({ limit: 0 })).toBe(false);
    expect(advertised.args?.properties?.["archive"]).toMatchObject({
      default: ".",
    });
    expect(advertised.options?.properties?.["limit"]).toMatchObject({
      default: 20_000,
      minimum: 1,
    });
    expect(
      parserSchema(cli, "inspect-keyed-archive", "args")?.parse({ path: "x" }),
    ).toEqual({ path: "x", archive: "." });

    const help = await serve(cli, ["inspect-keyed-archive", "--help"]);
    expect(help.stdout).toContain(
      "Usage: rea inspect-keyed-archive <path> [archive] [options]",
    );
    expect(help.stdout).toContain(
      "archive  Relative archive path when the target is a bundle",
    );
  });

  it("advertises defaults as omittable on a mounted group root", async () => {
    const group = Cli.create("group", {
      args: z.object({ scope: z.enum(["all", "selected"]).default("all") }),
      run: () => ({ ok: true }),
    }).command("child", { run: () => ({ ok: true }) });
    const cli = Cli.create("group-root-test", { sync: false }).command(group);

    presentOmittableDefaults(cli as unknown as CliInstance);

    const advertised = await advertisedSchema(
      cli as unknown as CliInstance,
      "group",
    );
    expect(advertised.args?.properties.scope).toBeDefined();
    expect(advertised.args?.required ?? []).not.toContain("scope");
  });
});

describe("firmware CLI advertised input schema", () => {
  it("keeps limits and defaults from its shared input contract", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "extract-firmware");
    const ajv = new Ajv2020({ strict: false });
    const args = ajv.compile(advertised.args ?? {});
    const options = ajv.compile(advertised.options ?? {});

    expect(args({ path: "firmware.bin", outputDirectory: "output" })).toBe(
      true,
    );
    expect(args({ path: "", outputDirectory: "output" })).toBe(false);
    expect(args({ path: "firmware.bin", outputDirectory: "" })).toBe(false);
    expect(options({})).toBe(true);
    expect(options({ maxDepth: 0 })).toBe(false);
    expect(options({ maxDepth: 11 })).toBe(false);
    expect(options({ maxOutputBytes: 0 })).toBe(false);
    expect(options({ maxOutputBytes: 512 * 1024 * 1024 + 1 })).toBe(false);
    expect(options({ maxOutputFiles: 100_001 })).toBe(false);
    expect(advertised.options?.properties?.["maxDepth"]).toMatchObject({
      default: 3,
    });
    expect(advertised.options?.properties?.["maxOutputBytes"]).toMatchObject({
      default: 256 * 1024 * 1024,
    });
    expect(advertised.options?.properties?.["maxOutputFiles"]).toMatchObject({
      default: 10_000,
    });

    const maxOffset = Number.MAX_SAFE_INTEGER;
    expect(options({ offset: maxOffset + 1 })).toBe(false);
    expect(options({ length: maxOffset + 1 })).toBe(false);

    expect(
      parserSchema(cli, "extract-firmware", "options")?.parse({}),
    ).toMatchObject({
      maxDepth: 3,
      maxOutputBytes: 256 * 1024 * 1024,
      maxOutputFiles: 10_000,
    });
  });
});

describe("web module CLI advertised input schema", () => {
  it("advertises the shared path and URL constraints", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "trace-web-module-imports");
    const ajv = new Ajv2020({ strict: false });
    const args = ajv.compile(advertised.args ?? {});
    const options = ajv.compile(advertised.options ?? {});

    expect(
      args({ manifestPath: resolve("manifest.json"), scriptIndex: 0 }),
    ).toBe(true);
    expect(args({ manifestPath: "", scriptIndex: 0 })).toBe(false);
    expect(args({ manifestPath: "manifest\u0000.json", scriptIndex: 0 })).toBe(
      false,
    );
    expect(args({ manifestPath: "./manifest.json", scriptIndex: -1 })).toBe(
      false,
    );
    expect(options({})).toBe(true);
    expect(options({ importerUrl: "" })).toBe(false);
    expect(options({ importMapPath: "" })).toBe(false);
    expect(options({ importMapPath: "map\u0000.json" })).toBe(false);
    expect(options({ importMapBaseUrl: "" })).toBe(false);
  });
});

describe("ADB selector input schemas", () => {
  it("matches canonical serial constraints for every command that accepts a serial", async () => {
    const cli = createCli({});
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const values = [
      ["", false],
      ["bad serial", false],
      ['bad"serial', false],
      ["S", true],
      ["S".repeat(256), true],
      ["S".repeat(257), false],
    ] as const;
    let checked = 0;
    for (const command of createCliInventory(cli).primary.filter((name) =>
      name.includes("-adb-"),
    )) {
      const parser = parserSchema(cli, command, "args");
      const field = parser?.shape.serial as z.ZodType | undefined;
      if (field === undefined) continue;
      checked += 1;
      const advertised = await advertisedSchema(cli, command);
      expect(advertised.args!.properties.serial).toMatchObject({
        description: "Device serial exactly as `adb devices` reports it",
      });
      const serialSchema = z
        .record(z.string(), z.unknown())
        .parse(advertised.args!.properties.serial);
      const validate = ajv.compile(serialSchema);
      const operation = command.replaceAll(
        "-",
        "_",
      ) as keyof typeof adbInputSchemas;
      const owner = adbInputSchemas[operation];
      const canonical =
        owner && (Reflect.get(owner.shape, "serial") as z.ZodType | undefined);
      if (canonical === undefined)
        throw new Error(`Missing owner for ${command}`);
      for (const [value, expected] of values) {
        expect(canonical.safeParse(value).success, `${command}: owner`).toBe(
          expected,
        );
        expect(
          field.safeParse(value).success,
          `${command}: ${value.length}`,
        ).toBe(expected);
        expect(validate(value), `${command}: ${value.length}`).toBe(expected);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("ADB selector input schemas: package and activity", () => {
  it("preserves package and activity selector boundaries in parser and advertisement", async () => {
    const cli = createCli({});
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const descriptions: Record<string, string> = {
      "pull-adb-package:package": "Installed package name",
      "inspect-adb-package:package": "Package",
      "uninstall-adb-package:package": "Installed package to uninstall",
      "start-adb-app:package": "Installed package to start",
      "stop-adb-app:package": "Package to force-stop",
      "start-adb-activity:action": "Intent action to start",
      "start-adb-activity:data-uri": "Intent data URI (-d)",
      "start-adb-activity:component":
        "Explicit component in package/activity form (-n)",
    };
    const selections = [
      {
        commands: [
          "pull-adb-package",
          "inspect-adb-package",
          "uninstall-adb-package",
          "start-adb-app",
          "stop-adb-app",
        ],
        group: "args" as const,
        key: "package",
        canonical: adbInputSchemas.pull_adb_package.shape.package,
        values: ["", "bad pkg!", "android", "a".repeat(256), "a".repeat(257)],
        valid: [false, false, true, true, false],
      },
      {
        commands: ["start-adb-activity"],
        group: "args" as const,
        key: "action",
        canonical: adbInputSchemas.start_adb_activity.shape.action,
        values: [
          "",
          "bad action!",
          "android.intent.action.VIEW",
          "a".repeat(256),
          "a".repeat(257),
        ],
        valid: [false, false, true, true, false],
      },
      {
        commands: ["start-adb-activity"],
        group: "options" as const,
        key: "data-uri",
        canonical: adbInputSchemas.start_adb_activity.shape.data_uri,
        values: [
          undefined,
          "",
          "bad uri",
          "https://example.invalid/item",
          "a".repeat(2048),
          "a".repeat(2049),
        ],
        valid: [true, false, false, true, true, false],
      },
      {
        commands: ["start-adb-activity"],
        group: "options" as const,
        key: "component",
        canonical: adbInputSchemas.start_adb_activity.shape.component,
        values: [
          undefined,
          "",
          "bad component!",
          "com.example/.Main$Inner",
          "a".repeat(512),
          "a".repeat(513),
        ],
        valid: [true, false, false, true, true, false],
      },
    ];
    for (const selection of selections) {
      for (const command of selection.commands) {
        const parser = parserSchema(cli, command, selection.group);
        const field = parser?.shape[selection.key] as z.ZodType | undefined;
        if (field === undefined)
          throw new Error(`Missing ${command} ${selection.key}`);
        const advertised = await advertisedSchema(cli, command);
        const schema = advertised[selection.group];
        expect(schema?.properties[selection.key]).toMatchObject({
          description: descriptions[`${command}:${selection.key}`],
        });
        expect(schema?.required?.includes(selection.key) ?? false).toBe(
          selection.group === "args",
        );
        const validate = ajv.compile(schema ?? {});
        expect(selection.valid).toHaveLength(selection.values.length);
        for (const [index, value] of selection.values.entries()) {
          const expected = selection.valid[index];
          expect(
            selection.canonical.safeParse(value).success,
            `${command} owner`,
          ).toBe(expected);
          const base = selection.group === "args" ? { serial: "S" } : {};
          const input =
            value === undefined ? base : { ...base, [selection.key]: value };
          expect(
            field.safeParse(value).success,
            `${command} ${selection.key}`,
          ).toBe(expected);
          expect(
            parser?.safeParse(input).success,
            `${command} ${selection.key}`,
          ).toBe(expected);
          expect(validate(input), `${command} ${selection.key}`).toBe(expected);
        }
      }
    }
  });
});

describe("ADB selector input schemas: dispatch", () => {
  it("rejects malformed CLI selectors before an inert provider is called", async () => {
    const cli = Cli.create("rea-adb-selector-test", { sync: false });
    const provider = {
      inspectAvailability: vi.fn(async (): Promise<never> => {
        throw new Error("unexpected availability probe");
      }),
      execute: vi.fn(async (): Promise<never> => {
        throw new Error("unexpected provider execution");
      }),
      close: vi.fn(async () => undefined),
    };
    registerAdbCommands(cli, silentLogger, {}, provider);
    const requests = [
      ["inspect-adb-device", "bad serial"],
      ["inspect-adb-device", "S".repeat(257)],
      ["pull-adb-package", "S", "bad pkg!", "--output-directory", "."],
      ["pull-adb-package", "S", "a".repeat(257), "--output-directory", "."],
      ["start-adb-activity", "S", "bad action!"],
      ["start-adb-activity", "S", "a".repeat(257)],
      ["start-adb-activity", "S", "x", "--component", "bad component!"],
      ["start-adb-activity", "S", "x", "--component", "a".repeat(513)],
      ["start-adb-activity", "S", "x", "--data-uri", "bad uri"],
      ["start-adb-activity", "S", "x", "--data-uri", "a".repeat(2049)],
    ];
    for (const request of requests) {
      const result = await serve(cli, [...request, "--json"]);
      expect(result.exitCode, request[0]).not.toBe(0);
      expect(JSON.parse(result.stdout), request[0]).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(provider.inspectAvailability).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("preserves optional activity mapping and colon-containing extra values", async () => {
    const cli = Cli.create("rea-adb-selector-valid-test", { sync: false });
    const provider = {
      inspectAvailability: vi.fn(async (): Promise<never> => {
        throw new Error("unexpected availability probe");
      }),
      execute: vi.fn(async () =>
        err(new AnalysisInputError("start_adb_activity")),
      ),
      close: vi.fn(async () => undefined),
    };
    registerAdbCommands(cli, silentLogger, {}, provider);
    await serve(cli, [
      "start-adb-activity",
      "S",
      "x",
      "--data-uri",
      "https://example.invalid/a",
      "--component",
      "com.example/.Main$Inner",
      "--extra",
      "string:key:value:rest",
      "--json",
    ]);
    expect(provider.execute).toHaveBeenCalledOnce();
    expect(provider.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "start_adb_activity",
        input: {
          serial: "S",
          action: "x",
          data_uri: "https://example.invalid/a",
          component: "com.example/.Main$Inner",
          extras: [{ type: "string", key: "key", value: "value:rest" }],
        },
      }),
      expect.anything(),
    );
    expect(provider.inspectAvailability).not.toHaveBeenCalled();
  });
});

describe("ADB activity extra input schema", () => {
  it("matches the owning workflow's extra count through advertisement and CLI parsing", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "start-adb-activity");
    const parser = parserSchema(cli, "start-adb-activity", "options");
    if (parser === undefined)
      throw new Error("ADB activity options parser was not registered");
    const validate = new Ajv2020({ strict: false }).compile(
      advertised.options ?? {},
    );
    expect(advertised.options?.properties.extra).toMatchObject({
      type: "array",
      maxItems: 16,
      default: [],
    });
    const request = {
      serial: "emulator-5554",
      action: "android.intent.action.VIEW",
    };
    expect(validate({})).toBe(true);
    const omitted = adbInputSchemas.start_adb_activity.parse(request);
    expect(omitted.extras).toEqual([]);
    expect(parser.parse({}).extra).toEqual(omitted.extras);
    for (const count of [0, 16, 17]) {
      const extras = Array.from({ length: count }, (_, index) => ({
        type: "string",
        key: `key${index}`,
        value: `value${index}`,
      }));
      const input = {
        extra: extras.map(({ type, key, value }) => `${type}:${key}:${value}`),
      };
      const expected = adbInputSchemas.start_adb_activity.safeParse({
        ...request,
        extras,
      }).success;
      expect(expected).toBe(count <= 16);
      expect(parser.safeParse(input).success).toBe(expected);
      expect(validate(input)).toBe(expected);
    }
  });
});

describe("Apktool locale selection input schema", () => {
  it("preserves the owner's array bounds through CLI advertisement and parsing", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "decode-android-resources");
    expect(advertised.options?.properties?.locales).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: MAX_SELECTED_LOCALES,
    });
    const parser = parserSchema(cli, "decode-android-resources", "options");
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile({
      ...advertised.options,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
    for (const locales of [
      undefined,
      [],
      ["de"],
      Array<string>(MAX_SELECTED_LOCALES).fill("de"),
      Array<string>(MAX_SELECTED_LOCALES + 1).fill("de"),
      ["not a locale"],
    ]) {
      const input = locales === undefined ? {} : { locales };
      const expected = apktoolInputSchemas.decode_android_resources.safeParse({
        path: "/targets/app.apk",
        ...input,
      }).success;
      expect(parser?.safeParse(input).success).toBe(expected);
      expect(validate(input)).toBe(expected);
    }
  });
});

describe("reference-source outline-depth input schema", () => {
  it("parses decimal CLI tokens into the advertised safe integer schema", async () => {
    const cli = createCli({});
    const advertised = await advertisedSchema(cli, "import-reference-source");
    const outlineDepth = advertised.options?.properties?.outlineDepth;
    expect(outlineDepth).toMatchObject({ type: "integer", minimum: 0 });

    const parser = parserSchema(cli, "import-reference-source", "options");
    expect(parser?.safeParse({}).success).toBe(true);
    const parsedValues = [
      ["0", 0],
      ["2", 2],
      ["02", 2],
      [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ] as const;
    for (const [token, expected] of parsedValues) {
      const parsed = parser?.safeParse({ outlineDepth: token });
      expect(parsed?.success).toBe(true);
      if (parsed === undefined || !parsed.success)
        throw new Error(`Expected outline-depth token ${token} to parse`);
      expect(parsed.data).toMatchObject({ outlineDepth: expected });
    }
    for (const token of ["", "-1", "9007199254740992"]) {
      expect(parser?.safeParse({ outlineDepth: token }).success).toBe(false);
    }

    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile({
      ...advertised.options,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
    for (const [token] of parsedValues) {
      const parsed = parser?.safeParse({ outlineDepth: token });
      if (parsed === undefined || !parsed.success)
        throw new Error(`Expected outline-depth token ${token} to parse`);
      expect(validate(parsed.data)).toBe(true);
    }
    expect(validate({ outlineDepth: -1 })).toBe(false);
    expect(validate({ outlineDepth: 9007199254740992 })).toBe(false);
  });
});

const atLeastOneSelector = (alternatives: string): string =>
  `Supply at least one of ${alternatives}.`;
const ADDRESS_OR_PROCEDURE = atLeastOneSelector(
  "the positional address or --procedure",
);
const DECOMPILE_SELECTORS = `${ADDRESS_OR_PROCEDURE} Alternatively, use --file-offset alone.`;
const NAMED_ADDRESS = atLeastOneSelector("the positional address or --address");
const QUERY_SELECTOR = atLeastOneSelector("the positional query or --query");
const PATTERN_SELECTOR = atLeastOneSelector(
  "the positional pattern or --pattern",
);
const EXACTLY_ONE_SCRIPT = "Provide exactly one of --script or --script-file.";
const TARGET = "target.bin";

interface SelectorRequest {
  readonly args: Record<string, unknown>;
  readonly options: Record<string, unknown>;
}

interface SelectorField {
  readonly group: "args" | "options";
  readonly name: string;
  readonly preserved?: readonly string[];
}

interface SelectorDiscovery {
  readonly command: string;
  readonly guidance: string;
  readonly choice: "at least one" | "exactly one";
  readonly fields: readonly SelectorField[];
  /** Each side is valid alone, including when the other group omits its selector. */
  readonly representable: readonly SelectorRequest[];
  /** Cross-group omission stays valid because the schemas are separate. */
  readonly omitted: SelectorRequest;
  readonly rejected: readonly {
    readonly args?: Record<string, unknown>;
    readonly options?: Record<string, unknown>;
  }[];
}

const selectorDiscovery: readonly SelectorDiscovery[] = [
  {
    command: "inspect-native-api",
    guidance: ADDRESS_OR_PROCEDURE,
    choice: "at least one",
    fields: [
      { group: "args", name: "address" },
      {
        group: "options",
        name: "procedure",
        preserved: ["symbols beginning with a dash"],
      },
    ],
    representable: [
      { args: { path: TARGET, address: "main" }, options: {} },
      { args: { path: TARGET }, options: { procedure: "--help" } },
      {
        args: { path: TARGET, address: "main" },
        options: { procedure: "main" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, address: 1 } },
      { options: { procedure: 1 } },
    ],
  },
  {
    command: "function",
    guidance: ADDRESS_OR_PROCEDURE,
    choice: "at least one",
    fields: [
      { group: "args", name: "address" },
      {
        group: "options",
        name: "procedure",
        preserved: ["use --procedure=<value> for leading dashes"],
      },
    ],
    representable: [
      { args: { path: TARGET, address: "main" }, options: {} },
      { args: { path: TARGET }, options: { procedure: "--help" } },
      {
        args: { path: TARGET, address: "main" },
        options: { procedure: "main" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, address: "" } },
      { options: { procedure: "" } },
    ],
  },
  {
    command: "instructions",
    guidance: ADDRESS_OR_PROCEDURE,
    choice: "at least one",
    fields: [
      { group: "args", name: "address" },
      {
        group: "options",
        name: "procedure",
        preserved: ["use --procedure=<value> for leading dashes"],
      },
    ],
    representable: [
      { args: { path: TARGET, address: "main" }, options: {} },
      { args: { path: TARGET }, options: { procedure: "--help" } },
      {
        args: { path: TARGET, address: "main" },
        options: { procedure: "main" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, address: "" } },
      { options: { procedure: "" } },
    ],
  },
  {
    command: "decompile",
    guidance: DECOMPILE_SELECTORS,
    choice: "at least one",
    fields: [
      { group: "args", name: "address" },
      {
        group: "options",
        name: "procedure",
        preserved: ["use --procedure=<value> for leading dashes"],
      },
      {
        group: "options",
        name: "file-offset",
        preserved: [
          "Ghidra source-file byte offset",
          "mapped internally to an analysis address",
        ],
      },
    ],
    representable: [
      { args: { path: TARGET, address: "0x140001010" }, options: {} },
      { args: { path: TARGET }, options: { procedure: "--help" } },
      { args: { path: TARGET }, options: { "file-offset": "0x210" } },
      {
        args: { path: TARGET, address: "0x140001010" },
        options: { procedure: "0x140001010" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, address: "" } },
      { options: { procedure: "" } },
      { options: { "file-offset": "210" } },
      { options: { "file-offset": "0x" } },
    ],
  },
  {
    command: "xrefs",
    guidance: NAMED_ADDRESS,
    choice: "at least one",
    fields: [
      { group: "args", name: "address" },
      {
        group: "options",
        name: "address",
        preserved: ["use --address=<value> for leading dashes"],
      },
    ],
    representable: [
      { args: { path: TARGET, address: "main" }, options: {} },
      { args: { path: TARGET }, options: { address: "--help" } },
      {
        args: { path: TARGET, address: "main" },
        options: { address: "main" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, address: "" } },
      { options: { address: "" } },
    ],
  },
  {
    command: "trace",
    guidance: QUERY_SELECTOR,
    choice: "at least one",
    fields: [
      { group: "args", name: "query" },
      {
        group: "options",
        name: "query",
        preserved: ["use --query=<value> for leading dashes"],
      },
    ],
    representable: [
      { args: { path: TARGET, query: "feature" }, options: {} },
      { args: { path: TARGET }, options: { query: "--help" } },
      {
        args: { path: TARGET, query: "feature" },
        options: { query: "feature" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, query: "" } },
      { options: { query: "" } },
    ],
  },
  {
    command: "search",
    guidance: PATTERN_SELECTOR,
    choice: "at least one",
    fields: [
      { group: "args", name: "pattern" },
      {
        group: "options",
        name: "pattern",
        preserved: ["use --pattern=<value> for leading dashes"],
      },
    ],
    representable: [
      { args: { path: TARGET, pattern: "text" }, options: {} },
      { args: { path: TARGET }, options: { pattern: "--help" } },
      {
        args: { path: TARGET, pattern: "text" },
        options: { pattern: "text" },
      },
    ],
    omitted: { args: { path: TARGET }, options: {} },
    rejected: [
      { args: { path: TARGET, pattern: "" } },
      { options: { pattern: "" } },
    ],
  },
  {
    command: "instrument-with-frida",
    guidance: EXACTLY_ONE_SCRIPT,
    choice: "exactly one",
    fields: [
      { group: "options", name: "script" },
      { group: "options", name: "scriptFile" },
    ],
    representable: [
      {
        args: { mode: "attach", target: "71" },
        options: { script: "send(1)" },
      },
      {
        args: { mode: "attach", target: "71" },
        options: { scriptFile: "source.js" },
      },
      {
        args: { mode: "attach", target: "71" },
        options: { script: "send(1)", scriptFile: "source.js" },
      },
    ],
    omitted: { args: { mode: "attach", target: "71" }, options: {} },
    rejected: [
      { args: { mode: "attach", target: "" } },
      { args: { mode: "debug", target: "71" } },
      { options: { scriptFile: "" } },
    ],
  },
];

const propertyDescription = (property: unknown, label: string): string => {
  expect(property, label).toMatchObject({
    description: expect.any(String),
  });
  if (
    typeof property !== "object" ||
    property === null ||
    !("description" in property) ||
    typeof property.description !== "string"
  )
    throw new Error(`${label} description was not on the schema property`);
  return property.description;
};

describe("required CLI selector discovery", () => {
  it.each(selectorDiscovery)(
    "$command names every permitted selector alternative in schema, help, and the full LLM manifest",
    async (entry) => {
      const cli = createCli({});
      const advertised = await advertisedSchema(cli, entry.command);
      const otherChoice =
        entry.choice === "at least one" ? "exactly one" : "at least one";
      for (const field of entry.fields) {
        const label = `${entry.command} ${field.group}.${field.name}`;
        const description = propertyDescription(
          advertised[field.group]?.properties[field.name],
          label,
        );
        expect(description, label).toContain(entry.guidance);
        expect(description, label).toContain(entry.choice);
        expect(description, label).not.toContain(otherChoice);
        for (const preserved of field.preserved ?? [])
          expect(description, label).toContain(preserved);
        expect(advertised[field.group]?.required ?? [], label).not.toContain(
          field.name,
        );
      }

      const help = await serve(cli, [entry.command, "--help"]);
      const manifest = await serve(cli, [entry.command, "--llms-full"]);
      expect(help.exitCode, entry.command).toBe(0);
      expect(manifest.exitCode, entry.command).toBe(0);
      for (const surface of [help.stdout, manifest.stdout]) {
        expect(surface).toContain(entry.guidance);
        expect(surface).toContain(entry.choice);
        expect(surface).not.toContain(otherChoice);
        for (const field of entry.fields)
          for (const preserved of field.preserved ?? [])
            expect(surface).toContain(preserved);
      }

      const ajv = new Ajv2020({ strict: false });
      expect(advertised.args, entry.command).toBeDefined();
      expect(advertised.options, entry.command).toBeDefined();
      const validateArgs = ajv.compile(advertised.args ?? {});
      const validateOptions = ajv.compile(advertised.options ?? {});
      expect(validateArgs({}), entry.command).toBe(false);
      for (const request of [...entry.representable, entry.omitted]) {
        expect(
          validateArgs(request.args),
          `${entry.command} args ${JSON.stringify(validateArgs.errors)}`,
        ).toBe(true);
        expect(
          validateOptions(request.options),
          `${entry.command} options ${JSON.stringify(validateOptions.errors)}`,
        ).toBe(true);
      }
      for (const request of entry.rejected) {
        if (request.args !== undefined)
          expect(validateArgs(request.args), entry.command).toBe(false);
        if (request.options !== undefined)
          expect(validateOptions(request.options), entry.command).toBe(false);
      }
    },
  );
});

it("advertises and rejects an empty native-value procedure before opening a target", async () => {
  const cli = createCli({});
  const schema = await advertisedSchema(cli, "trace-native-values");
  expect(schema.args?.properties.procedure).toMatchObject({ minLength: 1 });
  const result = await serve(cli, [
    "trace-native-values",
    "/missing",
    "",
    "--json",
  ]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: expect.arrayContaining([
      expect.objectContaining({ path: "procedure" }),
    ]),
  });
});
