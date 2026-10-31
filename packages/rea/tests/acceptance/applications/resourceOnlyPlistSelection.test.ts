import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildBinary } from "plist";
import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform !== "darwin")(
  "resource-only MCP plist selections retain symlink-parent and directory semantics",
  async () => {
    const root = await createTestTempDirectory("rea-resource-plist-selection-");
    const app = join(root, "Fixture.app");
    const contents = join(app, "Contents");
    const physical = join(contents, "physical");
    await mkdir(join(physical, "child"), { recursive: true });
    const defaultPath = join(contents, "Info.plist");
    const sourcePath = join(physical, "Selected.plist");
    const decoyPath = join(contents, "Selected.plist");
    const source = buildBinary({ Marker: "physical source" });
    const decoy = buildBinary({ Marker: "lexical decoy" });
    await writeFile(
      defaultPath,
      buildBinary({ CFBundleIdentifier: "fixture" }),
    );
    await writeFile(sourcePath, source);
    await writeFile(decoyPath, decoy);
    await symlink("physical/child", join(contents, "alias"));
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    expect(
      (await call("open_bundle_resources", { path: app })).isError,
    ).not.toBe(true);
    const defaultResult = await call("inspect_plist", {});
    expect(defaultResult.isError).not.toBe(true);
    expect(
      parseEvidence(defaultResult.structuredContent).normalized_result,
    ).toMatchObject({
      source_path: defaultPath,
      value: { CFBundleIdentifier: "fixture" },
    });
    for (const requested of [
      "Contents/alias/../Selected.plist",
      `${contents}/alias/../Selected.plist`,
      sourcePath,
    ]) {
      const response = await call("inspect_plist", { path: requested });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(
        parseEvidence(response.structuredContent).normalized_result,
      ).toMatchObject({
        source_path: requested.startsWith("/")
          ? requested
          : `${app}/${requested}`,
        value: { Marker: "physical source" },
        resource_root: { canonical_path: app, executable_sha256: null },
      });
    }
    expect(
      parseMcpToolError(
        await call("inspect_plist", { path: "Contents/Selected.plist/" }),
      ).error,
    ).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["path"] }] },
    });
    expect(
      Buffer.compare(await readFile(sourcePath), Buffer.from(source)),
    ).toBe(0);
    expect(Buffer.compare(await readFile(decoyPath), Buffer.from(decoy))).toBe(
      0,
    );
  },
);
