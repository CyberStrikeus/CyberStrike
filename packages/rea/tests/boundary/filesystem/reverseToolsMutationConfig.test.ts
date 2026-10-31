import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const runNode = (source: string, ...arguments_: string[]): string =>
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e", source, ...arguments_],
    { cwd: root, encoding: "utf8" },
  );

describe("reverse-tools mutation configuration", () => {
  it("loads nonempty targets and distinct report destinations from both actual Stryker configs", () => {
    const result = runNode(
      `const [mainUrl, semanticsUrl] = process.argv.slice(1);
       const main = await import(mainUrl);
       const semantics = await import(semanticsUrl);
       process.stdout.write(JSON.stringify([main.default, semantics.default].map(config => ({
         targets: config.mutate.length,
         json: config.jsonReporter?.fileName,
         html: config.htmlReporter?.fileName,
         dryRunOnly: config.dryRunOnly ?? false,
         reporters: config.reporters,
       }))));`,
      pathToFileURL(join(root, "stryker.config.mjs")).href,
      pathToFileURL(join(root, "stryker.semantics.config.mjs")).href,
    );
    const configs = z
      .array(
        z.object({
          targets: z.number().int().positive(),
          json: z.string().regex(/^reports\/mutation\/.+\.json$/u),
          html: z.string().regex(/^reports\/mutation\/.+\.html$/u),
          dryRunOnly: z.literal(false),
          reporters: z.array(z.string()),
        }),
      )
      .length(2)
      .parse(JSON.parse(result));
    expect(
      new Set(
        configs.flatMap(({ json, html }) => [
          resolve(root, json),
          resolve(root, html),
        ]),
      ).size,
    ).toBe(4);
    for (const config of configs)
      expect(config.reporters).toEqual(
        expect.arrayContaining(["json", "html"]),
      );
  });

  it("fails closed when an owned mutation method is missing", async () => {
    const directory = await createTestTempDirectory("rea-mutation-selector-");
    const source = join(directory, "source.ts");
    await writeFile(source, "class Present { run() {} }\n");

    const result = runNode(
      `import { mutationRanges } from "./scripts/lib/reverse-tools-mutation-targets.mjs";
       const [source] = process.argv.slice(1);
       try {
         mutationRanges(source, [{ kind: "method", owner: "Missing", name: "run" }]);
         throw new Error("missing owner unexpectedly selected");
       } catch (error) {
         if (!(error instanceof Error) || !error.message.includes("found 0")) throw error;
         process.stdout.write(error.message);
       }`,
      source,
    );
    expect(result).toMatch(/found 0/u);
  });

  it("fails closed when an owned mutation method is ambiguous", async () => {
    const directory = await createTestTempDirectory("rea-mutation-selector-");
    const source = join(directory, "source.ts");
    await writeFile(source, "class Owner { run() {} run(value: string) {} }\n");

    const result = runNode(
      `import { mutationRanges } from "./scripts/lib/reverse-tools-mutation-targets.mjs";
       const [source] = process.argv.slice(1);
       try {
         mutationRanges(source, [{ kind: "method", owner: "Owner", name: "run" }]);
         throw new Error("ambiguous target unexpectedly selected");
       } catch (error) {
         if (!(error instanceof Error) || !error.message.includes("found 2")) throw error;
         process.stdout.write(error.message);
       }`,
      source,
    );
    expect(result).toMatch(/found 2/u);
  });
});
