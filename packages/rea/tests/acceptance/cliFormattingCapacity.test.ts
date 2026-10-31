import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "vitest";
import { parse as parseYaml } from "yaml";

import { buildManagedPeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";

// Exercise the real dispatcher and pinned formatter with an authored capacity
// failure. No engine-sized document or native target execution is needed.
const formatterFailure = `
  if (fmt !== "json" && fmt !== "jsonl" &&
      (value?.operation === "inspect_managed_artifact" ||
       value?.data?.operation === "inspect_managed_artifact" ||
       value?.code === "target_unavailable" ||
       value?.error?.code === "target_unavailable")) {
    process.stderr.write("REA_AUTHORED_FORMAT_CAPACITY\\n");
    throw new RangeError("Invalid string length");
  }
`;
const incurCapacityHook = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.endsWith("/incur/dist/Formatter.js")) return loaded;
    const source = String(loaded.source);
    const signature = "export function format(value, fmt = 'toon') {";
    if (!source.includes(signature)) throw new Error("Pinned formatter boundary changed");
    return { ...loaded, source: source.replace(signature, signature + ${JSON.stringify(formatterFailure)}) };
  },
});
`)}`;

// REA owns Markdown rendering. Fail one scalar's string materialization in the
// CLI child, restoring String before the recovery document uses that formatter.
// This does not depend on generated bundle names or compiled function text.
const markdownCapacityHook = `data:text/javascript,${encodeURIComponent(`
globalThis.String = new Proxy(String, {
  apply(target, receiver, args) {
    if (["inspect_managed_artifact", "target_unavailable"].includes(args[0])) {
      globalThis.String = target;
      process.stderr.write("REA_AUTHORED_FORMAT_CAPACITY\\n");
      throw new RangeError("Invalid string length");
    }
    return Reflect.apply(target, receiver, args);
  },
});
`)}`;

type FormattingScenario = {
  readonly name: string;
  readonly arguments: readonly string[];
  readonly full: boolean;
  readonly format?: "yaml" | "md";
  readonly human?: boolean;
};

const scenarios: readonly FormattingScenario[] = [
  { name: "default TOON", arguments: [], full: false },
  { name: "human TOON", arguments: [], full: false, human: true },
  { name: "full TOON", arguments: ["--full-output"], full: true },
  { name: "TOON token count", arguments: ["--token-count"], full: false },
  { name: "TOON token window", arguments: ["--token-limit", "3"], full: false },
  {
    name: "full TOON token window",
    arguments: ["--full-output", "--token-limit", "3"],
    full: true,
  },
  { name: "YAML", format: "yaml", arguments: [], full: false },
  {
    name: "full YAML",
    format: "yaml",
    arguments: ["--full-output"],
    full: true,
  },
  { name: "Markdown", format: "md", arguments: [], full: false },
  {
    name: "full Markdown",
    format: "md",
    arguments: ["--full-output"],
    full: true,
  },
  {
    name: "Markdown token window",
    format: "md",
    arguments: ["--token-limit", "3"],
    full: false,
  },
];

for (const scenario of scenarios)
  for (const outcome of ["success", "failure"] as const)
    workspaceCliTest(
      `${scenario.name} returns a typed formatting constraint after ${outcome}`,
      async ({ processes, workspace }) => {
        const target = resolve(workspace.root, "fixture.dll");
        if (outcome === "success")
          await writeFile(target, buildManagedPeFixture());
        const result = await processes.run(
          process.execPath,
          [
            "--import",
            scenario.human
              ? `data:text/javascript,${encodeURIComponent('Object.defineProperty(process.stdout, "isTTY", { value: true });')}`
              : "data:text/javascript,",
            "--import",
            scenario.format === "md" ? markdownCapacityHook : incurCapacityHook,
            resolve("scripts/rea.mjs"),
            "inspect-managed-artifact",
            target,
            ...(scenario.format ? ["--format", scenario.format] : []),
            ...scenario.arguments,
          ],
          { cwd: workspace.root, env: { PATH: process.env.PATH ?? "" } },
        );
        expect(result.exitCode, result.stderr).toBe(1);
        expect(result.stderr.trim()).toBe("REA_AUTHORED_FORMAT_CAPACITY");
        expect(result.stdout).toContain("resource_constraint");
        expect(result.stdout).toContain("--format json");
        expect(result.stdout).toContain("formatted_characters");
        expect(result.stdout).not.toContain("[truncated:");
        expect(result.stdout).not.toContain("UNKNOWN");
        if (outcome === "failure")
          expect(result.stdout).toContain("target_unavailable");
        if (scenario.format === "md" && scenario.full) {
          expect(result.stdout).toMatch(/^## ok\n\nfalse$/m);
          expect(result.stdout).toMatch(
            /^## error\.code\n\nresource_constraint$/m,
          );
          expect(result.stdout).toMatch(
            /^## meta\n\n(?:\|[^\n]*\|\n)*\| command +\| inspect-managed-artifact +\|$/m,
          );
        }
        if (scenario.format === "yaml") {
          const document = parseYaml(result.stdout);
          const error = scenario.full ? document.error : document;
          expect(analysisErrorProjectionSchema.parse(error)).toMatchObject({
            code: "resource_constraint",
            retryable: false,
            details: {
              resource: "memory",
              reported_limits: { formatted_characters: null },
            },
          });
          if (scenario.full)
            expect(document).toMatchObject({
              ok: false,
              meta: { command: "inspect-managed-artifact" },
            });
        }
      },
    );

workspaceCliTest.skipIf(process.platform === "win32")(
  "keeps the SIGPIPE outcome when the reader closes before formatting recovery",
  async ({ processes, workspace }) => {
    const child = processes.spawn(
      process.execPath,
      [
        "--import",
        incurCapacityHook,
        resolve("scripts/rea.mjs"),
        "inspect-managed-artifact",
        workspace.path("missing.dll"),
      ],
      { cwd: workspace.root, env: { PATH: process.env.PATH ?? "" } },
    );
    child.stdout.destroy();
    child.stdin.end();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (part: string) => {
      stderr += part;
    });
    const code = await new Promise<number | null>((done) =>
      child.once("close", done),
    );
    expect({ code, stderr }).toEqual({
      code: 141,
      stderr: "REA_AUTHORED_FORMAT_CAPACITY\n",
    });
  },
);
