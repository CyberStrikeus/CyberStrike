import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "packs through the selected npm entrypoint even when PATH contains another npm",
  async () => {
    const root = await createTestTempDirectory("rea-agentenv-npm-selection-");
    const bin = join(root, "bin");
    await mkdir(bin);
    const selected = join(root, "selected-npm.mjs");
    const selectedMarker = join(root, "selected-called");
    const pathMarker = join(root, "path-called");
    const runner = join(root, "agent-env.mjs");
    const docker = join(root, "docker.mjs");
    await writeFile(
      selected,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(selectedMarker)}, process.argv[2]);\nprocess.exit(23);\n`,
    );
    await writeFile(
      join(bin, "npm"),
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pathMarker)}, 'called');\nprocess.exit(66);\n`,
      { mode: 0o755 },
    );
    await writeFile(
      runner,
      "#!/usr/bin/env node\nprocess.stdout.write('agent-env 0.9.1334\\n');\n",
      { mode: 0o755 },
    );
    await writeFile(docker, "#!/usr/bin/env node\nprocess.exit(0);\n", {
      mode: 0o755,
    });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../scripts/verify-agentenv-environment.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          npm_execpath: selected,
          REA_AGENT_ENV_COMMAND: runner,
          REA_DOCKER_COMMAND: docker,
        },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(await readFile(selectedMarker, "utf8")).toBe("pack");
    await expect(readFile(pathMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

// The local framework and these executable shebang fixtures target POSIX hosts.
it.skipIf(process.platform === "win32").each([
  ["agent-env 0.9.9999", false],
  ["other-runner 0.9.1334", false],
  ["agent-env 0.9.1334", true],
] as const)(
  "admits the observed executable identity %s before Docker: %s",
  async (version, accepted) => {
    const root = await createTestTempDirectory("rea-agentenv-identity-");
    const runner = join(root, "agent-env.mjs");
    const docker = join(root, "docker.mjs");
    const marker = join(root, "docker-called");
    await writeFile(
      runner,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${version}\n`)});\n`,
      { mode: 0o755 },
    );
    await writeFile(
      docker,
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'called');\nprocess.exit(97);\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../scripts/verify-agentenv-environment.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          REA_AGENT_ENV_COMMAND: runner,
          REA_DOCKER_COMMAND: docker,
        },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `"agent_env_version": ${JSON.stringify(version)}`,
    );
    expect(result.stderr).toContain('"public_cases": 0');
    expect(result.stderr).not.toContain('"status": "passed"');
    if (accepted) expect(await readFile(marker, "utf8")).toBe("called");
    else
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
