import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import { createGoBinaryFixture } from "../../fixtures/go/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// POSIX follows `link` before `..`, so `link/../sample` names target/sample.
describe.skipIf(process.platform === "win32")(
  "caller paths through a directory symlink and ..",
  () => {
    cliTest(
      "inspects the file the filesystem selects, not its lexical sibling",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-symlink-parent-");
        await mkdir(join(root, "target/child"), { recursive: true });
        await symlink("target/child", join(root, "link"));
        const selected = createGoBinaryFixture({ goVersion: "go1.26.0" }).bytes;
        const sibling = createGoBinaryFixture({ goVersion: "go1.25.0" }).bytes;
        await writeFile(join(root, "target/sample"), selected);
        await writeFile(join(root, "sample"), sibling);
        const selectedDigest = createHash("sha256")
          .update(selected)
          .digest("hex");
        for (const [command, operation] of [
          ["inspect-go-binary", "inspect_go_binary"],
          ["inspect-rust-binary", "inspect_rust_binary"],
        ] as const)
          // Concatenate: path.join would collapse `link/..` itself.
          for (const path of ["link/../sample", `${root}/link/../sample`]) {
            const result = await cli.run({
              arguments: [command, path, "--json"],
              cwd: root,
            });
            expect(result.exitCode, result.stderr).toBe(0);
            const evidence = toolContract(operation).outputSchema.parse(
              result.json,
            );
            expect(evidence.subject?.digest.sha256, `${command} ${path}`).toBe(
              selectedDigest,
            );
          }
      },
      30_000,
    );

    cliTest(
      "reads PE resources from the file the filesystem selects",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-symlink-parent-pe-");
        await mkdir(join(root, "target/child"), { recursive: true });
        await symlink("target/child", join(root, "link"));
        const image = (payload: string) =>
          peResourceFixture(true, [
            {
              type: 10,
              name: 1,
              language: 1033,
              payload: Buffer.from(payload),
            },
          ]).bytes;
        await writeFile(join(root, "target/sample.exe"), image("SELECTED"));
        await writeFile(join(root, "sample.exe"), image("OTHER"));
        const selectedDigest = createHash("sha256")
          .update(image("SELECTED"))
          .digest("hex");
        for (const path of [
          "link/../sample.exe",
          `${root}/link/../sample.exe`,
        ]) {
          const result = await cli.run({
            arguments: ["inspect-pe-resources", path, "--json"],
            cwd: root,
          });
          expect(result.exitCode, result.stderr).toBe(0);
          const evidence = toolContract(
            "inspect_pe_resources",
          ).outputSchema.parse(result.json);
          expect(evidence.subject?.digest.sha256, path).toBe(selectedDigest);
        }
      },
      30_000,
    );
  },
);
