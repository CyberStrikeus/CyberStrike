import { join } from "node:path";
import { Writable } from "node:stream";
import { Cli } from "incur";
import { expect, it } from "vitest";
import { createMarkdownRenderer } from "vitepress";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import {
  parseCliOutputArguments,
  renderCliDocument,
} from "../../../src/cliOutput.js";
import {
  createCliResultOutput,
  streamCliCommandResults,
} from "../../../src/cli/cliResultOutput.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

it("keeps source keys literal in Markdown headings through CLI result output", async () => {
  const value = Object.freeze({
    "<schema>&amp;": 0,
    "[link](target)": Object.freeze([Object.freeze({ retained: true })]),
    "*bundle*": Object.freeze({ leaf: "seen" }),
    _under_: Object.freeze({ leaf: "literal underscores" }),
    plain_field: 0,
    "parent\\": Object.freeze({
      "`code`\r\n\r## fake": Object.freeze({ leaf: "retained" }),
    }),
    plain: Object.freeze({ nested: Object.freeze({ value: false }) }),
  });
  const original = JSON.stringify(value);
  const cli = Cli.create("heading-facts-test", { sync: false });
  cli.command("facts", { run: () => value });
  const args = ["facts", "--format", "md"];
  const chunks: Buffer[] = [];
  const output = createCliResultOutput(
    parseCliOutputArguments(args),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  if (output === undefined) throw new Error("Missing CLI result output owner");
  streamCliCommandResults(cli, output);
  let fallback = "";
  await cli.serve(args, {
    exit: (code) => expect(code).toBe(0),
    stdout: (text) => {
      if (!output.handled) fallback += text;
    },
  });
  expect(fallback).toBe("");
  expect(output.handled).toBe(true);
  expect(output.failed).toBe(false);
  const markdown = Buffer.concat(chunks).toString("utf8");
  expect(markdown.match(/^## .+$/gmu)).toEqual([
    "## &lt;schema&gt;&amp;amp;",
    "## \\[link\\](target)",
    "## \\*bundle\\*",
    "## \\_under\\_",
    "## plain_field",
    "## parent\\\\.\\`code\\`<br><br>\\#\\# fake",
    "## plain.nested",
  ]);
  expect(markdown).toContain("| retained |\n|----------|\n| true     |");
  expect(markdown).toContain("| leaf | seen  |");
  expect(markdown).toContain("| value | false |");
  expect(JSON.parse(renderCliDocument(value, "json", false))).toEqual(value);
  expect(JSON.stringify(value)).toBe(original);
});

it("retains nested facts in standalone Markdown table cells and mixed arrays", async () => {
  const value = [
    {
      details: { path: "alpha.txt" },
      entries: [{ path: "sub/beta.txt" }],
      mixed: ["selected", { nested: "caller|value" }],
    },
  ];
  const markdown = renderCliDocument(value, "md", false);
  const renderer = await createMarkdownRenderer(process.cwd(), {
    linkify: false,
  });
  const text = (node: DefaultTreeAdapterTypes.Node): string =>
    node.nodeName === "#text" && "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join("")
        : "";
  const rendered = text(parseFragment(renderer.render(markdown)));
  expect(rendered).toContain('{"path":"alpha.txt"}');
  expect(rendered).toContain('[{"path":"sub/beta.txt"}]');
  const literal = "colon: :) ;-) x) #tag &#58;";
  const document = renderCliDocument({ [literal]: literal }, "md", false);
  const renderedLiteral = text(parseFragment(renderer.render(document)));
  expect(renderedLiteral.split(literal)).toHaveLength(3);
  expect(rendered).toContain("caller|value");
  expect(rendered).not.toContain("[object Object]");
  const mixed = renderCliDocument(
    { mixed: [1, { path: "retained" }] },
    "md",
    false,
  );
  expect(text(parseFragment(renderer.render(mixed)))).toContain(
    '{"path":"retained"}',
  );
  expect(JSON.parse(renderCliDocument(value, "json", false))).toEqual(value);
});

workspaceCliTest(
  "preserves archive inventory facts through public Markdown and JSON output",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-archive-facts-");
    const archive = join(root, "fixture.zip");
    await writeOrderedZip(archive, ["alpha.txt", "sub/beta.txt"]);
    const markdown = await cli.run({
      arguments: ["inspect-artifact", archive, "--format", "md"],
    });
    const json = await cli.run({
      arguments: ["inspect-artifact", archive, "--json"],
    });
    expect(markdown.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    for (const entry of ["alpha.txt", "sub/beta.txt"]) {
      expect(markdown.stdout).toContain(entry);
      expect(json.stdout).toContain(entry);
    }
    expect(markdown.stdout).not.toContain("[object Object]");
  },
);
