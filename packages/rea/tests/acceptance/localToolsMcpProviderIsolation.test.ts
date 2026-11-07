import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it("isolates Ghidra PATH discovery while honoring an explicit installation override", async () => {
  const root = await createTestTempDirectory("rea-local-tools-provider-");
  await mkdir(join(root, "Ghidra"), { recursive: true });
  await mkdir(join(root, "support"), { recursive: true });
  await writeFile(
    join(root, "Ghidra", "application.properties"),
    "application.version=12.1.4\napplication.java.min=21\n",
  );
  await writeFile(
    join(root, process.platform === "win32" ? "ghidraRun.bat" : "ghidraRun"),
    "",
    { mode: 0o700 },
  );
  await writeFile(
    join(
      root,
      "support",
      process.platform === "win32" ? "analyzeHeadless.bat" : "analyzeHeadless",
    ),
    "",
    { mode: 0o700 },
  );
  const path = [root, process.env.PATH ?? ""].join(delimiter);
  const probe = async (environment: Readonly<Record<string, string>>) => {
    const { call } = await connectLocalToolsMcp({ PATH: path, ...environment });
    const response = await call("open_binary", {
      path: process.execPath,
      provider_id: "ghidra",
    });
    expect(response.isError).toBe(true);
    const error = parseMcpToolError(response);
    const details = z
      .object({
        rejections: z.array(
          z.object({ provider_id: z.string(), diagnostics: z.unknown() }),
        ),
      })
      .parse(error.error.details);
    const rejection = details.rejections.find(
      (item) => item.provider_id === "ghidra",
    );
    if (rejection === undefined) throw new Error("Missing Ghidra rejection");
    return z.object({ install_dir: z.string() }).parse(rejection.diagnostics)
      .install_dir;
  };

  expect(await probe({})).toBe(process.execPath);
  expect(await probe({ GHIDRA_INSTALL_DIR: root })).toBe(root);
});
