import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { build } from "plist";
import { expect } from "vitest";

import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "leaf"],
  $top: { root: { CF$UID: 1 } },
});

workspaceCliTest(
  "advertises the shared nonempty, NUL-free archive selector",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: ["inspect-keyed-archive", "--schema", "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const output = result.json as { args: Parameters<Ajv2020["compile"]>[0] };
    expect(output).toMatchObject({
      args: { properties: { archive: { minLength: 1, default: "." } } },
    });
    const validate = new Ajv2020({ strict: false }).compile(output.args);
    expect(validate({ path: "Static.app", archive: "" })).toBe(false);
    expect(validate({ path: "Static.app", archive: "Model\u0000.plist" })).toBe(
      false,
    );
    expect(
      validate({ path: "Static.app", archive: "Resources/Model.plist" }),
    ).toBe(true);
    expect(validate({ path: "Model.plist" })).toBe(true);
  },
);

workspaceCliTest(
  "identifies an empty archive argument before target admission",
  async ({ cli, workspace }) => {
    const bundle = workspace.path("Static.app");
    await mkdir(bundle);
    await writeFile(
      workspace.path("Static.app/Info.plist"),
      build({ CFBundleIdentifier: "org.example.staticarchive" }),
    );
    for (const target of [bundle, workspace.path("Missing.app")]) {
      const result = await cli.run({
        arguments: ["inspect-keyed-archive", target, "", "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [{ path: "archive", code: "too_small", missing: false }],
      });
    }
  },
);

workspaceCliTest(
  "retains explicit bundle paging and the default standalone selector",
  async ({ cli, workspace }) => {
    const bundle = workspace.path("Static.app");
    const member = "Contents/Resources/Model.plist";
    const path = workspace.path(`Static.app/${member}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      workspace.path("Static.app/Contents/Info.plist"),
      build({ CFBundleIdentifier: "org.example.staticarchive" }),
    );
    await writeFile(path, archive);
    for (const [target, selection] of [[bundle, member], [path]] as const) {
      const result = await cli.run({
        arguments: [
          "inspect-keyed-archive",
          target,
          ...(selection === undefined ? [] : [selection]),
          ...(selection === undefined
            ? []
            : ["--offset", "1", "--limit", "1", "--root", "root"]),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          archive_path: selection ?? "Model.plist",
          total_objects: 2,
          objects: expect.arrayContaining([
            expect.objectContaining({ value: "leaf" }),
          ]),
        },
      });
      if (selection !== undefined)
        expect(result.json).toMatchObject({
          normalized_result: { offset: 1, objects: [{ id: 1, value: "leaf" }] },
        });
    }
  },
);
