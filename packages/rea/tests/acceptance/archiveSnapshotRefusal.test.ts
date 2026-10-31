import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createSingleEntryZip } from "../fixtures/zipNames.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "archive snapshot refusal preserves the session and explains the missing replay binding",
  async () => {
    const root = await createTestTempDirectory("rea-archive-snapshot-refusal-");
    const archive = join(root, "sample.zip");
    const snapshot = join(root, "snapshot.json");
    const bytes = await createSingleEntryZip("sample.txt");
    await writeFile(archive, bytes);
    const { call } = await connectLocalToolsMcp();
    expect((await call("open_binary", { path: archive })).isError).not.toBe(
      true,
    );
    const failure = parseMcpToolError(
      await call("close_binary", { snapshot_path: snapshot }),
    );
    expect(failure.error).toMatchObject({
      code: "capability_unavailable",
      retryable: false,
      message: expect.stringContaining("Analysis snapshot unavailable"),
      remediation: {
        action: expect.stringContaining("close_binary without snapshot_path"),
      },
    });
    expect(
      await access(snapshot).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect((await call("binary_session", {})).structuredContent).toMatchObject({
      result: { open: true },
    });
    expect((await call("close_binary", {})).isError).not.toBe(true);
    expect((await call("binary_session", {})).structuredContent).toMatchObject({
      result: { open: false },
    });
    expect(
      Buffer.from(await readFile(archive)).equals(Buffer.from(bytes)),
    ).toBe(true);
  },
);
