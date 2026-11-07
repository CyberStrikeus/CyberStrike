import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform !== "darwin")(
  "preserves real plutil diagnostics and typed selection failures through MCP",
  async () => {
    const root = await createTestTempDirectory("rea-plist-diagnostic-mcp-");
    const program = join(root, "program");
    await writeFile(program, thinMach(0xfeedfacf, 0x100000c));
    await mkdir(join(root, "Contents"));
    const path = join(root, "Contents/Info.plist");
    // Malformed OpenStep remains conversion-only; supported XML now reads its
    // original source and keeps malformed scalar literals as explicit unknowns.
    const source = "{ number = ;";
    await writeFile(path, source);
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    const opened = await call("open_binary", { path: program });
    expect(opened.isError).not.toBe(true);
    for (const selected of [undefined, path]) {
      const result = await call(
        "inspect_plist",
        selected === undefined ? {} : { path: selected },
      );
      const { error } = parseMcpToolError(result);
      if (
        error.code !== "invalid_request" &&
        error.code !== "capability_unavailable"
      )
        throw new Error(`Unexpected failure: ${error.code}`);
      expect(error.code).toBe(
        selected === undefined ? "capability_unavailable" : "invalid_request",
      );
      const text =
        selected === undefined
          ? error.message
          : JSON.stringify(error.details?.issues);
      expect(text).toContain("Property List error:");
      expect(error.details).toMatchObject({
        captured_output: { exit_code: 1, truncated: false },
      });
      expect(JSON.stringify(error.details?.captured_output)).toContain(
        "Property List error:",
      );
    }
    const selectedTarget = await call("open_binary", { path });
    expect(selectedTarget.isError).not.toBe(true);
    const direct = parseMcpToolError(await call("inspect_plist", {})).error;
    expect(direct).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["path"],
            message: expect.stringContaining("Property List error:"),
          },
        ],
        captured_output: { exit_code: 1, truncated: false },
      },
    });
    expect(await readFile(path, "utf8")).toBe(source);
  },
);
