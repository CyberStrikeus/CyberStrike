import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decode } from "@toon-format/toon";
import { buildBinary } from "plist";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { afterAll, expect } from "vitest";
import { parse as parseYaml } from "yaml";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

afterAll(() => disposeMdItInstance());

const renderedText = (node: DefaultTreeAdapterTypes.Node): string =>
  node.nodeName === "#text" && "value" in node
    ? node.value
    : "childNodes" in node
      ? node.childNodes.map(renderedText).join("")
      : "";

cliTest.for([
  ["high", "probe:\ud800:end"],
  ["low", "probe:\udc00:end"],
  ["pair", "probe:😀:end"],
  ["replacement", "probe:�:end"],
  ["nul", "probe:\u0000:end"],
  ["literal", "probe:\\u0000:end"],
] as const)(
  "preserves binary keyed-archive code-unit identity across output formats (%s)",
  async ([label, value], { cli }) => {
    const root = await createTestTempDirectory("rea-keyed-text-unicode-");
    const renderer = await createMarkdownRenderer(root, { linkify: false });
    const path = join(root, `${label}.bplist`);
    await writeFile(
      path,
      buildBinary({
        $version: 100000,
        $archiver: "NSKeyedArchiver",
        $top: { root: { UID: 1 } },
        $objects: ["$null", value],
      }),
    );
    const run = (args: readonly string[]) => {
      const invocation = {
        arguments: ["inspect-keyed-archive", path, ...args],
      };
      return label === "high" || label === "pair"
        ? cli.run(invocation)
        : runFileCli(cli, invocation);
    };
    for (const format of ["json", "yaml"] as const) {
      const output = await run(["--format", format]);
      expect(output.exitCode, output.stderr).toBe(0);
      const document =
        format === "json"
          ? JSON.parse(output.stdout)
          : parseYaml(output.stdout);
      expect(document.normalized_result.objects[1].value).toBe(value);
    }
    for (const args of [[], ["--format", "toon"]] as const) {
      const output = await run(args);
      const document = decode(output.stdout) as {
        code?: string;
        normalized_result?: { objects: { value?: string }[] };
      };
      if (label === "high" || label === "low") {
        expect(output.exitCode).toBe(1);
        expect(document.code).toBe("invalid_request");
        expect(output.stdout).toContain("--format json");
        expect(output.stdout).not.toContain("�");
      } else {
        expect(output.exitCode, output.stderr).toBe(0);
        expect(document.normalized_result?.objects[1]?.value).toBe(value);
      }
    }
    const markdown = await run(["--format", "md"]);
    if (label === "high" || label === "low" || label === "nul") {
      expect(markdown.exitCode).toBe(1);
      expect(markdown.stdout).toContain("--format json");
      expect(markdown.stdout).not.toContain("�");
      return;
    }
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    const rendered = renderedText(
      parseFragment(renderer.render(markdown.stdout)),
    );
    expect(rendered).toContain(value);
  },
);

cliTest(
  "keeps NUL-bearing class names distinct in rendered Markdown",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-class-unicode-");
    const renderer = await createMarkdownRenderer(root, { linkify: false });
    for (const [label, name, expected] of [
      ["nul", "My\u0000Class", ""],
      ["replacement", "My�Class", "My�Class"],
      ["literal", "My\\u0000Class", "My\\u0000Class"],
    ] as const) {
      const path = join(root, `${label}.bplist`);
      await writeFile(
        path,
        buildBinary({
          $version: 100000,
          $archiver: "NSKeyedArchiver",
          $top: { root: { UID: 1 } },
          $objects: [
            "$null",
            { $class: { UID: 2 } },
            { $classname: name, $classes: [name, "NSObject"] },
            name,
            [name, "NSObject"],
            "NSObject",
          ],
        }),
      );
      const run = (args: readonly string[]) => {
        const invocation = {
          arguments: ["inspect-keyed-archive", path, ...args],
        };
        return label === "nul"
          ? cli.run(invocation)
          : runFileCli(cli, invocation);
      };
      const json = await run(["--json"]);
      expect(json.exitCode, json.stderr).toBe(0);
      expect(
        JSON.parse(json.stdout).normalized_result.objects[1].class_name,
      ).toBe(name);
      const toon = await run(["--format", "toon"]);
      expect(toon.exitCode, toon.stderr).toBe(0);
      const toonDocument = decode(toon.stdout) as {
        normalized_result: { objects: { class_name?: string }[] };
      };
      expect(toonDocument.normalized_result.objects[1]?.class_name).toBe(name);
      const markdown = await run(["--format", "md"]);
      if (label === "nul") {
        expect(markdown.exitCode).toBe(1);
        expect(markdown.stdout).toContain("--format json");
        continue;
      }
      expect(markdown.exitCode, markdown.stderr).toBe(0);
      const rendered = renderedText(
        parseFragment(renderer.render(markdown.stdout)),
      );
      expect(rendered).toContain(expected);
    }
  },
);
