import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { expect } from "vitest";
import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for([
  {
    name: "flat ZIP",
    extension: "zip",
    payload: true,
    deep: false,
    roots: [],
    platforms: [],
  },
  {
    name: "flat IPA",
    extension: "ipa",
    payload: true,
    deep: false,
    roots: ["Payload/Main.app"],
    platforms: ["ios"],
  },
  {
    name: "deep ZIP",
    extension: "zip",
    payload: false,
    deep: true,
    roots: ["Extras/Helper.app"],
    platforms: ["macos"],
  },
  {
    name: "IPA with unrooted deep helper",
    extension: "ipa",
    payload: true,
    deep: true,
    roots: ["Payload/Main.app"],
    platforms: ["ios"],
  },
])(
  "keeps format-specific Apple roots through CLI and MCP ($name)",
  async (fixture, { cli }) => {
    const root = await createTestTempDirectory("rea-apple-root-format-");
    const path = join(root, `Sample.${fixture.extension}`);
    const writer = new ZipWriter(new Uint8ArrayWriter());
    if (fixture.payload)
      await writer.add(
        "Payload/Main.app/Info.plist",
        new TextReader("<plist><dict/></plist>"),
      );
    await writer.add(
      "Extras/Other.app/Info.plist",
      new TextReader("<plist><dict/></plist>"),
    );
    if (fixture.deep) {
      await writer.add(
        "Extras/Helper.app/Contents/Info.plist",
        new TextReader("<plist><dict/></plist>"),
      );
      const macho = Buffer.concat([
        Buffer.from("cffaedfe070000010300008002000000", "hex"),
        Buffer.alloc(40),
      ]);
      await writer.add(
        "Extras/Helper.app/Contents/MacOS/Helper",
        new Uint8ArrayReader(macho),
      );
      await writer.add("Shared/other.js", new TextReader("console.log(2)"));
    }
    const bytes = await writer.close();
    await writeFile(path, bytes);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const source = parseEvidence(inspected.json);
    const input = { inventory_evidence: [source] };
    const request = join(root, "request.json");
    await writeFile(request, JSON.stringify(input));
    const projected = await cli.run({
      arguments: ["project-apple-application-graph", request, "--json"],
    });
    expect(projected.exitCode, projected.stderr).toBe(0);
    const cliGraph = appleApplicationProjectionResultSchema.parse(
      parseEvidence(projected.json).normalized_result,
    );
    expect(cliGraph.root_format).toBe(fixture.extension);
    expect(cliGraph.application_roots).toEqual(fixture.roots);
    expect(cliGraph.platforms).toEqual(fixture.platforms);
    if (fixture.deep && fixture.extension === "ipa")
      expect(cliGraph.bridge_candidates).toContainEqual({
        source_path: "Shared/other.js",
        native_path: "Extras/Helper.app/Contents/MacOS/Helper",
        basis: "javascript-and-native-content",
      });
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Missing production MCP session");
    const reply = await call("project_apple_application_graph", input);
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const mcpGraph = appleApplicationProjectionResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(mcpGraph).toEqual(cliGraph);
    expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
  },
);
