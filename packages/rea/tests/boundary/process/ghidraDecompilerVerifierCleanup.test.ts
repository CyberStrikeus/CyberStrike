import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest
  .skipIf(
    !["linux", "darwin"].includes(process.platform) ||
      !["x64", "arm64"].includes(process.arch),
  )
  .for([
    { outcome: "stopped", retained: false },
    { outcome: "incomplete", retained: true },
    { outcome: "unknown", retained: true },
  ])(
  "preserves the compiler failure and respects $outcome cleanup ownership",
  async ({ outcome, retained }, { processes }) => {
    const root = await createTestTempDirectory("rea-decompiler-cleanup-test-");
    const temporary = join(root, "temporary");
    await mkdir(temporary);
    const commandUrl = new URL(
      "../../../dist/process/OwnedCommand.js",
      import.meta.url,
    ).href;
    const installationUrl = new URL(
      "../../../scripts/lib/ghidra-installation-inspection.mjs",
      import.meta.url,
    ).href;
    const policyUrl = new URL(
      "../../../dist/ghidra/GhidraReleasePolicy.js",
      import.meta.url,
    ).href;
    // Execute the production entry point and its real filesystem cleanup.
    // Substitute only the two external prerequisites; no Ghidra is launched.
    const commandSource = `
      export * from ${JSON.stringify(`${commandUrl}?cleanup-test-original`)};
      import { OwnedCommandFailure } from ${JSON.stringify(`${commandUrl}?cleanup-test-original`)};
      import { writeFile } from "node:fs/promises";
      export async function runOwnedCommand(command) {
        await writeFile(command.arguments.at(-1), "partial compiler output");
        if (${JSON.stringify(outcome)} === "unknown") throw new Error("opaque compiler failure");
        throw new OwnedCommandFailure("process", "controlled compiler failure", null,
          ${JSON.stringify(outcome)} === "incomplete" ? "cleanup refused" : null,
          undefined, [], ${JSON.stringify(outcome)} === "incomplete" ? { retained: true } : undefined);
      }
    `;
    const installationSource = `
      import { SUPPORTED_GHIDRA_VERSION } from ${JSON.stringify(policyUrl)};
      export async function inspectVerifierGhidraInstallation() {
        return { status: "available", providerVersion: SUPPORTED_GHIDRA_VERSION };
      }
    `;
    const loader = join(root, "loader.mjs");
    await writeFile(
      loader,
      `import { registerHooks } from "node:module";
       registerHooks({ load(url, context, nextLoad) {
         if (url === ${JSON.stringify(commandUrl)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(commandSource)} };
         if (url === ${JSON.stringify(installationUrl)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(installationSource)} };
         return nextLoad(url, context);
       }});`,
    );
    const result = await processes.run(
      process.execPath,
      [
        "--import",
        loader,
        fileURLToPath(
          new URL(
            "../../../scripts/verify-real-ghidra-decompiler-failure.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary,
        },
        timeoutMs: 15_000,
      },
    );
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      outcome === "unknown"
        ? "opaque compiler failure"
        : "controlled compiler failure",
    );
    const workspaces = await readdir(temporary);
    expect(workspaces).toHaveLength(retained ? 1 : 0);
    if (retained) {
      expect(workspaces[0]).toMatch(/^rea-ghidra-decompiler-/u);
      expect(
        await readFile(
          join(
            temporary,
            workspaces[0]!,
            process.platform === "darwin"
              ? "cross-format.dylib"
              : "cross-format.so",
          ),
          "utf8",
        ),
      ).toBe("partial compiler output");
    }
  },
);
