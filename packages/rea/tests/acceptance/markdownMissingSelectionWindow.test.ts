import { writeFile } from "node:fs/promises";

import { expect } from "vitest";

import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";

workspaceCliTest.for([
  { command: "inspect-byte-entropy", file: "target.bin", data: "fixture" },
  {
    command: "inspect-apple-ips",
    file: "report.ips",
    data:
      '{"bug_type":"309","app_name":"fixture"}\n' +
      '{"procName":"fixture","threads":[],"usedImages":[]}',
  },
])(
  "keeps the missing-selection Markdown document across $command token windows",
  async ({ command, file, data }, { cli, workspace }) => {
    const path = workspace.path(file);
    await writeFile(path, data);
    const run = async (...flags: string[]) => {
      const result = await cli.run({
        arguments: [
          command,
          path,
          "--format",
          "md",
          "--filter-output",
          "nope",
          ...flags,
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      return result.stdout;
    };

    const document = await run();
    expect(document).toBe("| Key | Value |\n|-----|-------|\n");
    expect(await run("--token-count")).toBe("13\n");
    expect(await run("--token-offset", "0")).toBe(document);
    expect(await run("--token-limit", "1000")).toBe(document);

    const first = await run("--token-limit", "5");
    const rest = await run("--token-offset", "5");
    const firstMarker = "\n[truncated: showing tokens 0–5 of 13]\n";
    const restMarker = "\n[truncated: showing tokens 5–13 of 13]\n";
    expect(first.endsWith(firstMarker)).toBe(true);
    expect(rest.endsWith(restMarker)).toBe(true);
    expect(
      first.slice(0, -firstMarker.length) + rest.slice(0, -restMarker.length),
    ).toBe(document.trimEnd());
    expect(await run("--token-offset", "1000")).toBe(
      "\n[truncated: showing tokens 13–13 of 13]\n",
    );
  },
);
