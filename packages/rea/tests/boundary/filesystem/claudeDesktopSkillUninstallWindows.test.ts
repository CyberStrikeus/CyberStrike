import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CLAUDE_DESKTOP_PACKAGE_FAMILY } from "../../../src/application/ClaudeDesktopConfigLocation.js";
import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

// Explicit win32 skill destinations must be exercised on the native filesystem.
// A junction models the package's redirected AppData without symlink privilege.
it.runIf(process.platform === "win32").each([true, false])(
  "preflights native managed skill removal with redirected AppData: %s",
  async (redirected) => {
    const home = await createTestTempDirectory("rea-claude-skill-uninstall-");
    const env = {
      APPDATA: join(home, "AppData", "Roaming"),
      LOCALAPPDATA: join(home, "AppData", "Local"),
    };
    const privateClaude = join(
      env.LOCALAPPDATA,
      "Packages",
      CLAUDE_DESKTOP_PACKAGE_FAMILY,
      "LocalCache",
      "Roaming",
      "Claude",
    );
    await mkdir(privateClaude, { recursive: true });
    await writeFile(join(privateClaude, "Preferences"), "{}");
    await mkdir(env.APPDATA, { recursive: true });
    if (redirected)
      await symlink(privateClaude, join(env.APPDATA, "Claude"), "junction");
    const agents = join(env.APPDATA, "dsh", "agents");
    const manifests = [
      join(agents, "skills", "reverse-engineer-anything", "SKILL.md"),
      join(home, ".claude", "skills", "reverse-engineer-anything", "SKILL.md"),
    ];
    const contents =
      "---\nname: reverse-engineer-anything\n---\nmanaged fixture\n";
    for (const manifest of manifests) {
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(manifest, contents);
    }
    const result = await runUninstall(
      false,
      systemUninstallHost(
        home,
        undefined,
        { ...env, DSH_AGENTS_HOME: agents },
        "win32",
      ),
    );
    expect(result.status).toBe(redirected ? "failed" : "complete");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "skill",
        status: redirected ? "failed" : "removed",
        ...(redirected
          ? { detail: expect.stringContaining("redirects its writes") }
          : {}),
      }),
    );
    for (const manifest of manifests) {
      if (redirected) expect(await readFile(manifest, "utf8")).toBe(contents);
      else
        await expect(access(manifest)).rejects.toMatchObject({
          code: "ENOENT",
        });
    }
  },
);
