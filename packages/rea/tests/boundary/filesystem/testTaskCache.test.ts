import { execFile } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workflowGit } from "../../support/workflowGit.js";

const execute = promisify(execFile);

it.skipIf(process.platform === "android")(
  "reruns test validation after repository or external input changes while reusing preparation",
  async () => {
    const config = z
      .object({
        tasks: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
      .parse(
        JSON.parse(
          await readFile(
            new URL("../../../turbo.json", import.meta.url),
            "utf8",
          ),
        ),
      );
    const testTask = config.tasks["test:run"];
    const dependencies = z.array(z.string()).parse(testTask?.dependsOn);
    const root = await createTestTempDirectory("rea-test-cache-");
    const external = await createTestTempDirectory("rea-test-dependency-");
    const dependency = join(external, "provider.json");
    const scripts: Record<string, string> = { "test:run": "node check.mjs" };
    const tasks: Record<string, unknown> = { "test:run": testTask };
    for (const [index, task] of dependencies.entries()) {
      scripts[task] = `node prepare.mjs ${index}`;
      tasks[task] = {
        inputs: ["artifact-input.txt"],
        outputs: [`prepared-${index}.txt`],
      };
    }
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-cache-fixture",
        version: "1.0.0",
        private: true,
        type: "module",
        packageManager: "npm@11.16.0",
        scripts,
      }),
    );
    await writeFile(
      join(root, "package-lock.json"),
      JSON.stringify({
        name: "rea-cache-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "rea-cache-fixture", version: "1.0.0" } },
      }),
    );
    await writeFile(join(root, "turbo.json"), JSON.stringify({ tasks }));
    await writeFile(
      join(root, "artifact-input.txt"),
      "unchanged preparation input",
    );
    await writeFile(join(root, "README_zh.md"), "aligned");
    await writeFile(dependency, "healthy");
    await writeFile(
      join(root, "prepare.mjs"),
      'import { appendFileSync } from "node:fs"; appendFileSync(`prepared-${process.argv[2]}.txt`, "prepared\\n");',
    );
    await writeFile(
      join(root, "check.mjs"),
      `import { readFileSync } from "node:fs"; if(readFileSync("README_zh.md","utf8") !== "aligned" || readFileSync(${JSON.stringify(dependency)},"utf8") !== "healthy") throw new Error("current input is invalid");`,
    );
    await workflowGit(root, ["init", "--initial-branch=main"]);
    await workflowGit(root, ["add", "."]);
    await workflowGit(root, ["commit", "-m", "test: seed cache fixture"]);
    const run = (cwd = root) =>
      execute(
        process.execPath,
        [
          join(process.cwd(), "node_modules/turbo/bin/turbo"),
          "run",
          "test:run",
          "--output-logs=errors-only",
        ],
        { cwd, env: { ...process.env, TURBO_DAEMON: "false" } },
      );
    await run();
    await writeFile(join(root, "README_zh.md"), "wrong command");
    await expect(run()).rejects.toMatchObject({ code: 1 });
    await writeFile(join(root, "README_zh.md"), "aligned");
    await run();
    await writeFile(dependency, "faulty");
    await expect(run()).rejects.toMatchObject({ code: 1 });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    await writeFile(dependency, "healthy");
    await run();
    for (const index of dependencies.keys()) {
      expect(await readFile(join(root, `prepared-${index}.txt`), "utf8")).toBe(
        "prepared\n",
      );
    }
    // Provider jobs receive the producer's cache in a fresh checkout, not its
    // outputs. Turbo must restore identical inputs and rebuild changed ones.
    const consumer = await createTestTempDirectory("rea-cache-consumer-");
    await cp(root, consumer, {
      recursive: true,
      filter: (path) =>
        basename(path) !== ".turbo" &&
        !/^prepared-\d+\.txt$/u.test(basename(path)),
    });
    await cp(join(root, ".turbo/cache"), join(consumer, ".turbo/cache"), {
      recursive: true,
    });
    const restored = await run(consumer);
    expect(restored.stdout).toContain(`${dependencies.length} cached`);
    for (const index of dependencies.keys())
      expect(
        await readFile(join(consumer, `prepared-${index}.txt`), "utf8"),
      ).toBe("prepared\n");
    await writeFile(
      join(consumer, "artifact-input.txt"),
      "changed producer input",
    );
    await run(consumer);
    for (const index of dependencies.keys())
      expect(
        await readFile(join(consumer, `prepared-${index}.txt`), "utf8"),
      ).toBe("prepared\nprepared\n");
  },
);
