import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ggufFixture } from "../../fixtures/model/model.js";

it.skipIf(process.platform === "win32")(
  "keeps descriptor exhaustion separate from valid GPU and model targets and recovers unchanged inputs",
  async () => {
    const directory = await createTestTempDirectory("rea-descriptor-pressure-");
    const gpu = join(directory, "selected.ptx");
    const model = join(directory, "selected.gguf");
    await writeFile(
      gpu,
      ".version 8.8\n.target sm_80\n.address_size 64\n.visible .entry k() { ret; }\n",
    );
    await writeFile(model, ggufFixture().bytes);
    const { stdout, stderr } = await promisify(execFile)(
      "/bin/sh",
      [
        "-c",
        'ulimit -n 64; exec "$@"',
        "descriptor-pressure",
        process.execPath,
        resolve("tests/fixtures/gpu/descriptorPressure.mjs"),
        process.cwd(),
        gpu,
        model,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.pressure).toEqual(
      ["gpu", "model"].map((name) =>
        expect.objectContaining({
          name,
          system_code: "EMFILE",
          projection: expect.objectContaining({
            code: "execution_failure",
            category: "execution_failure",
          }),
        }),
      ),
    );
    expect(result.after).toEqual([
      { name: "gpu", restored: true },
      { name: "model", restored: true },
    ]);
  },
);
