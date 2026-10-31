import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { WabtArtifactProvider } from "../../../src/wasm/WabtArtifactProvider.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real subprocesses with WABT-shaped replies establish environment ownership,
// not the real WABT release's interpretation of these bytes.
it.skipIf(process.platform === "win32")(
  "keeps one WABT inspection coherent while accepting environment changes on the next call",
  async () => {
    const directory = await createTestTempDirectory("rea-wabt-environment-");
    const path = join(directory, "selected.wasm");
    const log = join(directory, "children.jsonl");
    await writeFile(path, Buffer.alloc(76, 1));
    const dump = await readFile(
      new URL("../../fixtures/wasm/objdump.txt", import.meta.url),
      "utf8",
    );
    for (const tool of ["wasm-validate", "wasm-objdump", "wasm2wat"]) {
      const output =
        tool === "wasm-objdump"
          ? dump
          : tool === "wasm2wat"
            ? '(module (@custom "test" "payload"))\n'
            : "";
      await writeFile(
        join(directory, tool),
        `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  marker: process.env.REA_TEST_MARKER,
  empty: process.env.REA_TEST_EMPTY,
  absent: Object.hasOwn(process.env, "REA_TEST_ABSENT")
}) + "\\n");
process.stdout.write(process.argv[2] === "--version" ? "1.0.42\\n" : ${JSON.stringify(output)});
`,
        { mode: 0o700 },
      );
    }
    const environment: NodeJS.ProcessEnv = {
      REA_WABT_BIN_DIRECTORY: directory,
      REA_TEST_MARKER: "selected-environment",
      REA_TEST_EMPTY: "",
    };
    let runtimeCreations = 0;
    const provider = new WabtArtifactProvider(environment, undefined, () => {
      runtimeCreations += 1;
      // Selection already succeeded, but version probes have not launched.
      if (runtimeCreations === 2) {
        environment.REA_WABT_BIN_DIRECTORY = join(directory, "unselected");
        environment.REA_TEST_MARKER = "changed-environment";
        environment.REA_TEST_EMPTY = "changed";
        environment.REA_TEST_ABSENT = "added";
      }
      return PrivateRuntimeRoot.create({ prefix: "rea-wabt-environment-" });
    });
    onTestFinished(() => provider.close());
    const input = { path, glue_paths: [], candidate_paths: [] };
    const first = await provider.inspect(input);
    if (!first.ok) throw first.error;

    const second = await provider.inspect(input);
    if (!second.ok) throw second.error;
    expect(second.value.result).toEqual(first.value.result);
    const children = (await readFile(log, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(children).toEqual(
      Array.from({ length: 12 }, () => ({
        marker: "selected-environment",
        empty: "",
        absent: false,
      })),
    );
    expect(JSON.stringify(second.value)).not.toContain("selected-environment");
    // Later calls intentionally observe reconfiguration, not a lifetime freeze.
    const third = await provider.inspect(input);
    expect(third).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
    expect(runtimeCreations).toBe(2);
  },
);
