import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform !== "darwin")(
  "inspects a bundle with a literal backslash in its executable name",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-app-backslash-");
    const app = join(root, "Back.app");
    const programs = join(app, "Contents", "MacOS");
    const executable = join(programs, "App\\Name");
    await mkdir(programs, { recursive: true });
    await writeFile(
      join(app, "Contents", "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App\\Name</string></dict></plist>",
    );
    await copyFile("/usr/bin/true", executable);
    const original = await readFile(executable);
    const canonical = await realpath(executable);
    for (const command of [
      "inspect-macho",
      "list-architectures",
      "inspect-signature",
    ]) {
      const result = await cli.run({
        arguments: [command, app, "--json"],
        environment:
          process.env.DEVELOPER_DIR === undefined
            ? {}
            : { DEVELOPER_DIR: process.env.DEVELOPER_DIR },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = parseEvidence(result.json);
      expect(evidence.caller_input_path).toBe(app);
      expect(evidence.subject?.local_path).toBe(canonical);
    }
    expect((await readFile(executable)).equals(original)).toBe(true);
  },
);
