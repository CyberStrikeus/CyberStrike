import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

import { captureProcessScenario } from "../../../src/process/capture/ProcessHarness.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";

itWithCaptureCapability(
  "normalizes wide terminal cells without inventing blank cells",
  async () => {
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: ["-e", 'process.stdout.write("界")'],
        terminal: { columns: 4, rows: 1, scrollback: 0 },
        normalization: {
          patterns: [{ pattern: " ", replacement: "_" }],
        },
      }),
    );
    if (!result.ok) throw result.error;
    expect(
      result.value.frames
        .map(({ raw_data, data }) => raw_data ?? data)
        .join(""),
    ).toBe("界");
    expect(result.value.rendered_frames.at(-1)).toMatchObject({
      columns: 4,
      cursor_x: 2,
      lines: ["界__"],
    });
    expect(result.value.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
  20_000,
);

itWithCaptureCapability(
  "captures one command's terminal output, selected files, and owned cleanup",
  async () => {
    const root = await createTestTempDirectory("rea-process-capture-");
    const script = join(root, "task.mjs");
    await writeFile(
      script,
      [
        'import { writeFile } from "node:fs/promises";',
        "process.stdout.write(`value:${process.env.CAPTURE_VALUE}\\n`);",
        'await writeFile("state.txt", "created");',
      ].join("\n"),
    );
    try {
      const result = await captureProcessScenario(
        processScenarioSchema.parse({
          executable: process.execPath,
          arguments: [script],
          working_directory: root,
          environment: { CAPTURE_VALUE: "caller-selected" },
          filesystem_observation_paths: ["."],
        }),
      );
      if (!result.ok) throw result.error;
      expect(result.value.frames.map(({ data }) => data).join("")).toContain(
        "value:caller-selected",
      );
      expect(result.value.files_after).toContainEqual(
        expect.objectContaining({ path: "root_0:state.txt" }),
      );
      expect(result.value.filesystem_effects).toContainEqual(
        expect.objectContaining({
          status: "created",
          path: "root_0:state.txt",
        }),
      );
      expect(result.value.cleanup).toMatchObject({
        owned_process_group: "verified",
        temporary_root: "removed",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20_000,
);

itWithCaptureCapability(
  "executes and observes the selected symlink/.. directory without touching its lexical decoy",
  async () => {
    const root = await createTestTempDirectory("rea-process-native-traversal-");
    const intended = join(root, "intended");
    await mkdir(join(intended, "nested"), { recursive: true });
    await symlink(join(intended, "nested"), join(root, "alias"));
    for (const [directory, label] of [
      [root, "decoy"],
      [intended, "intended"],
    ] as const) {
      await mkdir(join(directory, "observed"));
      await writeFile(join(directory, "observed", "state.txt"), "before");
      await writeFile(
        join(directory, "probe"),
        `#!/bin/sh\nprintf '${label}'\nprintf after > observed/state.txt\n`,
        { mode: 0o755 },
      );
    }
    const selected = `${root}/alias/..`;
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: `${selected}/probe`,
        working_directory: selected,
        filesystem_observation_paths: [`${selected}/observed`],
      }),
    );
    if (!result.ok) throw result.error;
    expect(result.value.frames.map(({ data }) => data).join("")).toBe(
      "intended",
    );
    expect(await readFile(join(root, "observed", "state.txt"), "utf8")).toBe(
      "before",
    );
    expect(
      await readFile(join(intended, "observed", "state.txt"), "utf8"),
    ).toBe("after");
    const before = result.value.files_before.find(
      ({ path }) => path === "root_0:state.txt",
    );
    const after = result.value.files_after.find(
      ({ path }) => path === "root_0:state.txt",
    );
    expect(before?.sha256).toBe(
      createHash("sha256").update("before").digest("hex"),
    );
    expect(after?.sha256).toBe(
      createHash("sha256").update("after").digest("hex"),
    );
    expect(result.value.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
  20_000,
);
