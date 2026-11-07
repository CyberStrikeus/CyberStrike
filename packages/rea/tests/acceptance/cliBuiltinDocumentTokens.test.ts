import { estimateTokenCount } from "tokenx";
import { expect } from "vitest";

import { workspaceCliTest } from "../support/cli/workspaceCliFixture.js";
import { runFileCli } from "../support/cli/cliFixture.js";

workspaceCliTest(
  "applies token controls to SDK manifest and schema documents",
  async ({ cli }) => {
    const run = async (...arguments_: string[]) => {
      const invocation = { arguments: arguments_ };
      const freshTokenCount = arguments_.join(" ") === "--llms --token-count";
      const freshTokenLimit =
        arguments_.join(" ") === "--llms-full --token-limit 1";
      const result = await (!freshTokenCount &&
      !freshTokenLimit &&
      (arguments_.includes("--token-count") ||
        arguments_.includes("--token-limit"))
        ? runFileCli(cli, invocation)
        : cli.run(invocation));
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      return result.stdout;
    };

    for (const args of [
      ["--llms"],
      ["--llms-full"],
      ["--llms-full", "--format", "json"],
      ["inspect-devicetree", "--schema"],
      ["inspect-devicetree", "--schema", "--format", "json"],
    ]) {
      const document = await run(...args);
      expect(await run(...args, "--token-count")).toBe(
        `${estimateTokenCount(document)}\n`,
      );
    }

    const document = await run("--llms-full");
    const page = await run("--llms-full", "--token-limit", "1");
    expect(page.length).toBeLessThan(document.length);
    expect(page).toMatch(/\[truncated: showing tokens 0–1 of \d+\]\n$/);
    expect(await run("--llms-full", "--token-limit", "1000000")).toBe(document);
    expect(
      await run("inspect-devicetree", "--schema", "--token-limit", "1"),
    ).toMatch(/\[truncated: showing tokens 0–1 of \d+\]\n$/);

    // Schema does not outrank help or plain version in Incur's dispatch.
    expect(
      await run("inspect-devicetree", "--schema", "--help", "--token-count"),
    ).toBe(await run("inspect-devicetree", "--schema", "--help"));
    expect(await run("--schema", "--version", "--token-count")).toBe(
      await run("--schema", "--version"),
    );
    expect(await run("completions", "bash", "--schema", "--token-count")).toBe(
      await run("completions", "bash", "--schema"),
    );

    const unknown = await cli.run({
      arguments: ["no-such-command", "--schema"],
    });
    const unknownCount = await cli.run({
      arguments: ["no-such-command", "--schema", "--token-count"],
    });
    expect(unknown.exitCode).toBe(1);
    expect(unknownCount.exitCode).toBe(1);
    expect(unknownCount.stdout).toBe(unknown.stdout);
    const structuredWindow = await cli.run({
      arguments: ["--llms-full", "--format", "json", "--token-limit", "1"],
    });
    expect(structuredWindow.exitCode).toBe(1);
    expect(structuredWindow.stdout).toContain("UNSUPPORTED_OUTPUT_COMBINATION");
  },
);
