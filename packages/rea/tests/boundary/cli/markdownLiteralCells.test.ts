import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { afterAll, expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { modelArtifactSchema } from "../../../src/domain/model/modelArtifact.js";
import { renderCliDocument } from "../../../src/cliOutput.js";
import { safetensorsFixture } from "../../fixtures/model/model.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

afterAll(() => disposeMdItInstance());

const renderedCells = (html: string): string[] => {
  const text = (node: DefaultTreeAdapterTypes.Node): string =>
    node.nodeName === "#text" && "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join("")
        : "";
  const cells: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && (node.tagName === "th" || node.tagName === "td"))
      cells.push(text(node));
    else if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html));
  return cells;
};

const tableColumnByHeader = (html: string, header: string): string[] => {
  const text = (node: DefaultTreeAdapterTypes.Node): string =>
    node.nodeName === "#text" && "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join("")
        : "";
  const descendants = (
    node: DefaultTreeAdapterTypes.Node,
    tagName: string,
  ): DefaultTreeAdapterTypes.Element[] => {
    const elements: DefaultTreeAdapterTypes.Element[] = [];
    const visit = (candidate: DefaultTreeAdapterTypes.Node): void => {
      if ("tagName" in candidate && candidate.tagName === tagName)
        elements.push(candidate as DefaultTreeAdapterTypes.Element);
      if ("childNodes" in candidate) candidate.childNodes.forEach(visit);
    };
    visit(node);
    return elements;
  };
  const cellText = (row: DefaultTreeAdapterTypes.Element): string[] =>
    row.childNodes
      .filter(
        (node): node is DefaultTreeAdapterTypes.Element =>
          "tagName" in node && (node.tagName === "th" || node.tagName === "td"),
      )
      .map(text);

  for (const table of descendants(parseFragment(html), "table")) {
    const rows = descendants(table, "tr");
    const headerIndex = rows.findIndex((row) =>
      row.childNodes.some((node) => "tagName" in node && node.tagName === "th"),
    );
    if (headerIndex < 0) continue;
    const headerCells = cellText(rows[headerIndex]!);
    const columnIndex = headerCells.indexOf(header);
    if (columnIndex < 0) continue;
    return rows
      .slice(headerIndex + 1)
      .filter((row) =>
        row.childNodes.some(
          (node) => "tagName" in node && node.tagName === "td",
        ),
      )
      .map((row) => cellText(row)[columnIndex] ?? "");
  }
  throw new Error(`No Markdown table has a ${JSON.stringify(header)} column`);
};

cliTest(
  "preserves literal Evidence keys and values when Markdown tables are rendered",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-literal-cells-");
    const path = join(root, "bundle.json");
    const literal =
      "`code` **bold** _name_ ~~deleted~~ [label](target) ![alt](image)";
    const punctuation = "\\`tick` \\*star* \\[label](target) a|b <T> &copy;";
    const identifiers = "x__y__z _a_b_ 中_文 snake_case_";
    const edgeSpaceEntries = {
      "  leading ": "  leading ",
      leading: "leading",
      "trailing  ": "trailing  ",
      "\tleading tab": "trailing tab\t",
      " mixed\t ": " mixed\t ",
      " ": " ",
      "   ": "   ",
      "": "",
      "  中文🙂  ": "  中文🙂  ",
      " &#32; &copy; <T> a|b ": " &#32; &copy; <T> a|b ",
      "{.hidden}": "literal {.hidden}",
      "{name=value}": "{name=value}",
    };
    const row = {
      [literal]: literal,
      punctuation,
      nested: { text: literal, values: ["__name__", "plain"] },
      empty: "",
      zero: 0,
      disabled: false,
      absent: null,
      source_index: identifiers,
      ...edgeSpaceEntries,
    };
    const result = { scalar: { [literal]: literal }, rows: [row] };
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "ordinary-json", parameters: {}, result },
    );
    const saved = JSON.stringify(createEvidenceBundle([record]));
    await writeFile(path, saved);
    const base = [
      "inspect-evidence-bundle",
      JSON.stringify({ path, detail: "complete" }),
      "--filter-output",
      "records.0.normalized_result",
    ];
    const json = await cli.run({ arguments: [...base, "--json"] });
    const markdown = await cli.run({ arguments: [...base, "--format", "md"] });
    expect(json.exitCode, json.stderr).toBe(0);
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      records: { "0": { normalized_result: result } },
    });
    expect(await readFile(path, "utf8")).toBe(saved);
    // Intraword underscores cannot form emphasis, so identifiers stay readable.
    expect(markdown.stdout).toContain(" source_index ");
    expect(markdown.stdout).toContain(
      " x__y__z \\_a_b\\_ 中_文 snake_case\\_ ",
    );

    const renderer = await createMarkdownRenderer(root, { linkify: false });
    const html = renderer.render(markdown.stdout);
    const expectedCells = [
      "Key",
      "Value",
      literal,
      literal,
      ...Object.keys(row),
      literal,
      punctuation,
      JSON.stringify(row.nested),
      "",
      "0",
      "false",
      "null",
      identifiers,
      ...Object.values(edgeSpaceEntries),
    ];
    expect(renderedCells(html)).toEqual(expectedCells);
    expect(html).not.toMatch(/<(?:em|strong|s|code|img)(?:\s|>)/u);

    // Standalone reports share the same table owner as command output.
    expect(
      renderedCells(renderer.render(renderCliDocument(result, "md", false))),
    ).toEqual(expectedCells);
  },
);

cliTest(
  "preserves capability provider identities in rendered Markdown",
  async ({ cli }) => {
    const json = await cli.run({ arguments: ["capabilities", "--json"] });
    const markdown = await runFileCli(cli, {
      arguments: ["capabilities", "--format", "md"],
    });
    expect(json.exitCode, json.stderr).toBe(0);
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    const data = JSON.parse(json.stdout) as {
      capabilities: { provider: unknown }[];
    };
    const renderer = await createMarkdownRenderer(process.cwd(), {
      linkify: false,
    });
    expect(
      tableColumnByHeader(renderer.render(markdown.stdout), "provider"),
    ).toEqual(
      data.capabilities.map(({ provider }) => JSON.stringify(provider)),
    );
  },
);

cliTest(
  "keeps scalar markers, edge spaces, and emoji-like names literal in rendered reports",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-literal-markers-");
    const path = join(root, "bundle.json");
    const result = {
      container: "::: details",
      trailing: "archive ",
      trailingTab: "archive\t",
      trailingMixed: "archive \t ",
      emoji: ":)",
      shortcuts: ":smile: :D :-( ;) ;-() x-) X-) 8-) B-) <3 &amp;",
      rows: [{ value: ":)", nested: { path: ";) :smile: 8-)" } }],
      after: "still visible",
    };
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "ordinary-json", parameters: {}, result },
    );
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));
    const base = [
      "inspect-evidence-bundle",
      JSON.stringify({ path, detail: "complete" }),
      "--filter-output",
      "records.0.normalized_result",
    ];
    const markdown = await runFileCli(cli, {
      arguments: [...base, "--format", "md"],
    });
    const json = await cli.run({ arguments: [...base, "--json"] });
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(json.exitCode, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      records: { "0": { normalized_result: result } },
    });
    const renderer = await createMarkdownRenderer(root, { linkify: false });
    const html = renderer.render(markdown.stdout);
    const text = (node: DefaultTreeAdapterTypes.Node): string =>
      node.nodeName === "#text" && "value" in node
        ? node.value
        : "childNodes" in node
          ? node.childNodes.map(text).join("")
          : "";
    const children = parseFragment(html).childNodes;
    for (const [key, value] of Object.entries(result).filter(
      ([, value]) => typeof value === "string",
    )) {
      const index = children.findIndex(
        (node) =>
          "tagName" in node &&
          node.tagName === "h2" &&
          text(node).replaceAll("\u200b", "").trim().endsWith(`.${key}`),
      );
      expect(index, key).toBeGreaterThanOrEqual(0);
      const body = children.slice(index + 1).find((node) => "tagName" in node);
      expect(body && "tagName" in body ? body.tagName : undefined, key).toBe(
        "p",
      );
      expect(body ? text(body) : undefined, key).toBe(value);
    }
    expect(html).not.toMatch(/<(?:details|ol|li)(?:\s|>)/u);
    expect(renderedCells(html)).toContain(
      JSON.stringify(result.rows[0]?.nested),
    );
    expect(renderedCells(html)).toContain(":)");
  },
);

cliTest(
  "preserves safetensors identifier edge spaces in rendered CLI tables",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-edge-spaces-");
    const path = join(root, "model.safetensors");
    const names = ["  leading ", "leading", "trailing  ", "plain"];
    const header = JSON.stringify(
      Object.fromEntries(
        names.map((name, index) => [
          name,
          {
            dtype: "F32",
            shape: [1],
            data_offsets: [index * 4, index * 4 + 4],
          },
        ]),
      ),
    );
    await writeFile(
      path,
      safetensorsFixture(header, Buffer.alloc(names.length * 4)).bytes,
    );
    const base = ["inspect-model-artifact", path, "--detail", "complete"];
    const json = await cli.run({ arguments: [...base, "--json"] });
    const markdown = await runFileCli(cli, {
      arguments: [...base, "--format", "md"],
    });
    expect(json.exitCode, json.stderr).toBe(0);
    expect(markdown.exitCode, markdown.stderr).toBe(0);

    const response = toolContract("inspect_model_artifact").outputSchema.parse(
      json.json,
    );
    const report = modelArtifactSchema.parse(response.normalized_result);
    const expectedNames = report.tensors.map(({ name }) => name);
    expect(expectedNames).toEqual([
      "  leading ",
      "leading",
      "plain",
      "trailing  ",
    ]);

    const renderer = await createMarkdownRenderer(root, { linkify: false });
    expect(
      tableColumnByHeader(renderer.render(markdown.stdout), "name"),
    ).toEqual(expectedNames);
  },
);

cliTest(
  "preserves literal scalar, array, and heading Evidence facts",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-markdown-literal-text-");
    const path = join(root, "bundle.json");
    const literal = "**literal** [source](wrong) <T> &copy;";
    const heading = "**key**\n# injected";
    const result = {
      [heading]: literal,
      list: [literal],
      bullet: "- literal",
      numbered: "1. literal",
      rule: "---",
      indented: "    literal\n- next\n# heading",
      nested: { value: 1 },
    };
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "ordinary-json", parameters: {}, result },
    );
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));
    const base = [
      "inspect-evidence-bundle",
      JSON.stringify({ path, detail: "complete" }),
      "--filter-output",
      "records.0.normalized_result",
    ];
    const markdown = await runFileCli(cli, {
      arguments: [...base, "--format", "md"],
    });
    const json = await cli.run({ arguments: [...base, "--json"] });
    expect(markdown.exitCode, markdown.stderr).toBe(0);
    expect(json.exitCode, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      records: { "0": { normalized_result: result } },
    });
    const renderer = await createMarkdownRenderer(root, { linkify: false });
    for (const document of [
      markdown.stdout,
      renderCliDocument(result, "md", false),
    ]) {
      const html = renderer.render(document);
      const text = (node: DefaultTreeAdapterTypes.Node): string =>
        node.nodeName === "#text" && "value" in node
          ? node.value
          : "childNodes" in node
            ? node.childNodes.map(text).join("")
            : "";
      expect(text(parseFragment(html))).toContain(literal);
      expect(html).toContain("**key**<br># injected");
      expect(html).toContain("literal<br>- next<br># heading");
      expect(html).not.toMatch(/<(?:strong|em|ul|ol|li|T|pre|hr)(?:\s|>)/u);
      expect(html).not.toContain('href="wrong"');
      expect(html).not.toContain("<h1");
    }
  },
);
