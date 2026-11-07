import { join, resolve } from "node:path";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "../domain/result.js";
import {
  runUpdate,
  type ReleaseLookupFailure,
  type UpdateHost,
  type UpdateInstallation,
  type UpdateOutput,
} from "./Update.js";
import {
  bunGlobalDirectory,
  detectBunInstallation,
  detectNpmInstallation,
  type BunInstallationHost,
  type NpmInstallationHost,
} from "./UpdateRuntime.js";
import type { IntegrationMaintenance } from "./UpdateMaintenance.js";
import { isUpdateFailure } from "./UpdateFailure.js";

class FakeUpdateHost implements UpdateHost {
  release: Result<string, ReleaseLookupFailure> = ok("3.3.0");
  installationResult: UpdateInstallation | undefined = {
    manager: "npm",
    prefix: "/fixture",
    packageRoot: "/fixture/lib/node_modules/rea-agents",
  };
  installResult: Result<void, string> = ok(undefined);
  verified: Result<string, string> = ok("3.3.0");
  maintenance: IntegrationMaintenance = {
    status: "current",
    plannedActions: [],
  };
  installedVersions: string[] = [];
  installationInspected = false;
  verifiedInstallation: UpdateInstallation | undefined;
  maintenanceInspected = false;
  output: UpdateOutput | undefined;
  cleanupFailure: string | undefined;

  installation = (): Promise<UpdateInstallation | undefined> => {
    this.installationInspected = true;
    return Promise.resolve(this.installationResult);
  };
  latestVersion = (): Promise<Result<string, ReleaseLookupFailure>> =>
    Promise.resolve(this.release);
  installVersion = (
    _installation: UpdateInstallation,
    version: string,
    output: UpdateOutput,
  ): Promise<Result<void, string>> => {
    this.installedVersions.push(version);
    this.output = output;
    return Promise.resolve(this.installResult);
  };
  installedVersion = (
    installation: UpdateInstallation,
  ): Promise<Result<string, string>> => {
    this.verifiedInstallation = installation;
    return Promise.resolve(this.verified);
  };
  planMaintenance = (): Promise<IntegrationMaintenance> => {
    this.maintenanceInspected = true;
    return Promise.resolve(this.maintenance);
  };
  close = (): Promise<string | undefined> =>
    Promise.resolve(this.cleanupFailure);
}

describe("REA update", () => {
  it("identifies an already-current installation without mutation", async () => {
    const host = new FakeUpdateHost();
    expect(await runUpdate("3.3.0", host)).toEqual({
      status: "current",
      currentVersion: "3.3.0",
      latestVersion: "3.3.0",
      installMethod: "npm",
    });
    expect(host.installationInspected).toBe(true);
    expect(host.installedVersions).toEqual([]);
    expect(host.maintenanceInspected).toBe(false);
  });

  it("preserves update status while marking incomplete resource cleanup as failure", async () => {
    const host = new FakeUpdateHost();
    host.cleanupFailure = "Regular file remains open: /fixture/skill/SKILL.md";

    const result = await runUpdate("3.3.0", host);

    expect(result).toMatchObject({
      status: "current",
      currentVersion: "3.3.0",
      cleanupFailure: host.cleanupFailure,
    });
    expect(isUpdateFailure(result)).toBe(true);
  });

  it("reports an unknown current installation honestly", async () => {
    const host = new FakeUpdateHost();
    host.installationResult = undefined;
    expect(await runUpdate("3.3.0", host)).toMatchObject({
      status: "current",
      installMethod: "unknown",
    });
    expect(host.installedVersions).toEqual([]);
  });

  it("installs the resolved release and verifies the same package root", async () => {
    const host = new FakeUpdateHost();
    expect(await runUpdate("3.2.1", host, "structured")).toMatchObject({
      status: "updated",
      previousVersion: "3.2.1",
      latestVersion: "3.3.0",
      installedVersion: "3.3.0",
      command: [
        "npm",
        "install",
        "--global",
        "--ignore-scripts",
        "--prefix",
        "/fixture",
        "rea-agents@3.3.0",
      ],
    });
    expect(host.installedVersions).toEqual(["3.3.0"]);
    expect(host.verifiedInstallation).toEqual(host.installationResult);
    expect(host.output).toBe("structured");
  });

  it("updates a Bun global installation with Bun and verifies the same package root", async () => {
    const host = new FakeUpdateHost();
    host.installationResult = {
      manager: "bun",
      globalDirectory: "/home/user/.bun/install/global",
      packageRoot: "/home/user/.bun/install/global/node_modules/rea-agents",
    };
    expect(await runUpdate("3.2.1", host, "structured")).toMatchObject({
      status: "updated",
      installMethod: "bun",
      installedVersion: "3.3.0",
      command: [
        "bun",
        "add",
        "--global",
        "--ignore-scripts",
        "rea-agents@3.3.0",
      ],
    });
    expect(host.verifiedInstallation).toEqual(host.installationResult);
    expect(await runUpdate("3.3.0", host)).toMatchObject({
      status: "current",
      installMethod: "bun",
    });
  });

  it("does not report success or plan maintenance when the installed version differs", async () => {
    const host = new FakeUpdateHost();
    host.verified = ok("3.4.0");
    expect(await runUpdate("3.2.1", host)).toMatchObject({
      status: "failed",
      reason: "verification",
      latestVersion: "3.3.0",
      installedVersion: "3.4.0",
    });
    expect(host.maintenanceInspected).toBe(false);
  });

  it("preserves executable verification diagnostics after npm succeeded", async () => {
    const host = new FakeUpdateHost();
    host.verified = err("ENOENT /fixture/scripts/rea.mjs");
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({ status: "failed", reason: "verification" });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("ENOENT /fixture/scripts/rea.mjs"),
    );
    expect(host.maintenanceInspected).toBe(false);
  });

  it("returns integration maintenance without applying it", async () => {
    const host = new FakeUpdateHost();
    host.maintenance = {
      status: "planned",
      scope: { clients: ["codex"], skill: false },
      command: ["rea", "setup", "--client", "codex", "--skill=false"],
      plannedActions: [
        {
          id: "configure_client:codex",
          kind: "configure_client",
          label: "Codex",
          target: "/home/.codex/config.toml",
          detail: "Refresh REA",
          external: false,
          operation: "update",
        },
      ],
    };
    expect(await runUpdate("3.2.1", host)).toMatchObject({
      status: "updated",
      maintenance: host.maintenance,
    });
  });

  it("keeps a verified update successful when maintenance planning fails", async () => {
    const host = new FakeUpdateHost();
    host.maintenance = {
      status: "unavailable",
      remediation: "EACCES /home/.codex/config.toml",
    };
    expect(await runUpdate("3.2.1", host)).toMatchObject({
      status: "updated",
      installedVersion: "3.3.0",
      maintenance: host.maintenance,
    });
  });
});

describe("update failures and version boundaries", () => {
  it("normalizes accepted release metadata before installing and comparing versions", async () => {
    const host = new FakeUpdateHost();
    host.release = ok("v3.3.0");
    expect(await runUpdate("3.2.1", host)).toMatchObject({
      status: "updated",
      latestVersion: "3.3.0",
      installedVersion: "3.3.0",
    });
    expect(host.installedVersions).toEqual(["3.3.0"]);
  });

  it("preserves registry errors without installation", async () => {
    const host = new FakeUpdateHost();
    host.release = err({
      kind: "unavailable",
      detail: "npm registry returned HTTP 503",
    });
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({
      status: "failed",
      reason: "version-check",
      latestVersion: null,
    });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("HTTP 503"),
    );
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("registry access"),
    );
    expect(host.installedVersions).toEqual([]);
  });

  it("distinguishes local package-manager startup from registry failure", async () => {
    const host = new FakeUpdateHost();
    host.release = err({
      kind: "package-manager-unavailable",
      manager: "bun",
      detail: "spawn bun ENOENT",
    });
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({
      status: "failed",
      reason: "version-check",
      latestVersion: null,
      remediation: expect.stringContaining("spawn bun ENOENT"),
    });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("repair its launcher"),
    );
    expect(result).toHaveProperty(
      "remediation",
      expect.not.stringContaining("registry access"),
    );
    expect(host.installedVersions).toEqual([]);
  });

  it.each(["latest", "", "3.3", "$(echo bad)"])(
    "rejects invalid release metadata %s before installation",
    async (version) => {
      const host = new FakeUpdateHost();
      host.release = ok(version);
      expect(await runUpdate("3.2.1", host)).toMatchObject({
        status: "failed",
        reason: "version-check",
      });
      expect(host.installedVersions).toEqual([]);
    },
  );

  it("describes invalid release metadata without blaming registry access", async () => {
    const host = new FakeUpdateHost();
    host.release = err({
      kind: "invalid-metadata",
      detail: "expected one version string",
    });
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({
      status: "failed",
      reason: "version-check",
      latestVersion: null,
    });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("expected one version string"),
    );
    expect(result).toHaveProperty(
      "remediation",
      expect.not.stringContaining("registry access"),
    );
    expect(host.installedVersions).toEqual([]);
  });

  it.each([
    ["3.4.0", "3.3.0"],
    ["3.3.0", "3.3.0-rc.1"],
  ])("does not downgrade %s to %s", async (currentVersion, release) => {
    const host = new FakeUpdateHost();
    host.release = ok(release);
    expect(await runUpdate(currentVersion, host)).toMatchObject({
      status: "current",
    });
    expect(host.installedVersions).toEqual([]);
  });

  it("updates a prerelease to its final release", async () => {
    const host = new FakeUpdateHost();
    expect(await runUpdate("3.3.0-rc.1", host)).toMatchObject({
      status: "updated",
      installedVersion: "3.3.0",
    });
  });

  it("refuses to create a global installation for an unrelated invocation", async () => {
    const host = new FakeUpdateHost();
    host.installationResult = undefined;
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({
      status: "failed",
      reason: "unknown-install-method",
    });
    expect(result).toHaveProperty(
      "remediation",
      expect.not.stringContaining("npm install --global"),
    );
    expect(host.installedVersions).toEqual([]);
  });

  it("reports actual npm failures and skips verification", async () => {
    const host = new FakeUpdateHost();
    host.installResult = err("EACCES /fixture/lib/node_modules/rea-agents");
    const result = await runUpdate("3.2.1", host);
    expect(result).toMatchObject({ status: "failed", reason: "install" });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("EACCES /fixture/lib/node_modules/rea-agents"),
    );
    expect(host.verifiedInstallation).toBeUndefined();
  });
});

describe("npm installation ownership", () => {
  const host = (root: string, prefix = "/usr/local"): NpmInstallationHost => ({
    canonicalPath: (path) => Promise.resolve(path),
    globalRoot: () => Promise.resolve(root),
    globalPrefix: () => Promise.resolve(prefix),
  });

  it("identifies the global prefix and package root", async () => {
    const packageRoot = "/usr/local/lib/node_modules/rea-agents";
    await expect(
      detectNpmInstallation(packageRoot, host("/usr/local/lib/node_modules")),
    ).resolves.toEqual({ manager: "npm", prefix: "/usr/local", packageRoot });
  });

  it("retains the curl installer's custom Unix prefix", async () => {
    const packageRoot = "/home/user/.local/lib/node_modules/rea-agents";
    await expect(
      detectNpmInstallation(packageRoot, host("/usr/local/lib/node_modules")),
    ).resolves.toEqual({
      manager: "npm",
      prefix: "/home/user/.local",
      packageRoot,
    });
  });

  it.each([
    "/work/rea",
    "/work/node_modules/rea-agents",
    "/cache/_npx/abc/node_modules/rea-agents",
  ])("rejects unrelated invocation %s", async (packageRoot) => {
    await expect(
      detectNpmInstallation(packageRoot, host("/usr/local/lib/node_modules")),
    ).resolves.toBeUndefined();
  });

  it("does not trust an unresolvable installation path", async () => {
    const failing = {
      ...host("/usr/local/lib/node_modules"),
      canonicalPath: (): Promise<string> => Promise.reject(new Error("EACCES")),
    };
    await expect(
      detectNpmInstallation(
        "/home/.local/lib/node_modules/rea-agents",
        failing,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("Bun installation ownership", () => {
  const globalDirectory = "/home/user/.bun/install/global";
  const packageRoot = `${globalDirectory}/node_modules/rea-agents`;
  // Fixture paths are POSIX; join() may produce Windows separators on Windows hosts.
  const host = (
    manifests: readonly string[] = [`${globalDirectory}/package.json`],
  ): BunInstallationHost => ({
    canonicalPath: (path) => Promise.resolve(path.replaceAll("\\", "/")),
    isFile: (path) =>
      Promise.resolve(manifests.includes(path.replaceAll("\\", "/"))),
  });

  it.skipIf(process.platform === "win32")(
    "preserves native symlink traversal through detection and pins the canonical global project",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "rea-bun-global-"));
      try {
        await mkdir(join(directory, "outer", "inner"), { recursive: true });
        await symlink(
          join(directory, "outer", "inner"),
          join(directory, "alias"),
        );
        const selected = `${directory}/alias/../global`;
        expect(
          bunGlobalDirectory({ BUN_INSTALL: selected }, process.platform),
        ).toBe(resolve(selected, "install", "global"));
        expect(
          bunGlobalDirectory({ XDG_CACHE_HOME: selected }, process.platform),
        ).toBe(resolve(selected, ".bun", "install", "global"));
        const selectedPackage = join(
          directory,
          "outer",
          "global",
          "node_modules",
          "rea-agents",
        );
        await mkdir(selectedPackage, { recursive: true });
        await writeFile(`${selected}/package.json`, "{}");
        // The lexical alternative is also a valid project; it must not win.
        await mkdir(join(directory, "global", "node_modules", "rea-agents"), {
          recursive: true,
        });
        await writeFile(join(directory, "global", "package.json"), "{}");
        const installation = await detectBunInstallation(
          selectedPackage,
          bunGlobalDirectory(
            { BUN_INSTALL_GLOBAL_DIR: selected },
            process.platform,
          ),
          {
            canonicalPath: realpath,
            isFile: async (path) => (await stat(path)).isFile(),
          },
        );
        expect(installation).toEqual({
          manager: "bun",
          globalDirectory: await realpath(selected),
          packageRoot: await realpath(selectedPackage),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("identifies the package inside Bun's global project", async () => {
    await expect(
      detectBunInstallation(packageRoot, globalDirectory, host()),
    ).resolves.toEqual({ manager: "bun", globalDirectory, packageRoot });
  });

  it("refuses a global directory without its manifest, which Bun would resolve to an ancestor project", async () => {
    await expect(
      detectBunInstallation(packageRoot, globalDirectory, host([])),
    ).resolves.toBeUndefined();
  });

  it.each([
    "/home/user/project/node_modules/rea-agents",
    "/usr/local/lib/node_modules/rea-agents",
    "/home/user/.bun/install/cache/rea-agents@6.4.0@@@1",
  ])("rejects package root %s outside the global project", async (root) => {
    await expect(
      detectBunInstallation(root, globalDirectory, host()),
    ).resolves.toBeUndefined();
  });

  it("does not trust an unresolvable installation path", async () => {
    await expect(
      detectBunInstallation(packageRoot, globalDirectory, {
        ...host(),
        canonicalPath: () => Promise.reject(new Error("ENOENT")),
      }),
    ).resolves.toBeUndefined();
  });

  it("follows Bun's global directory precedence", () => {
    const home = { HOME: "/home/user" };
    expect(bunGlobalDirectory(home, "linux")).toBe(
      resolve("/home/user", ".bun", "install", "global"),
    );
    expect(
      bunGlobalDirectory({ ...home, XDG_CACHE_HOME: "/cache" }, "linux"),
    ).toBe(resolve("/cache", ".bun", "install", "global"));
    expect(
      bunGlobalDirectory(
        { ...home, XDG_CACHE_HOME: "/cache", BUN_INSTALL: "/opt/bun" },
        "linux",
      ),
    ).toBe(resolve("/opt/bun", "install", "global"));
    expect(
      bunGlobalDirectory(
        {
          ...home,
          BUN_INSTALL: "/opt/bun",
          BUN_INSTALL_GLOBAL_DIR: "/srv/bun-global",
        },
        "linux",
      ),
    ).toBe(resolve("/srv/bun-global"));
    const profile = resolve("profile");
    expect(
      bunGlobalDirectory(
        { USERPROFILE: profile, HOME: resolve("other-home") },
        "win32",
      ),
    ).toBe(join(profile, ".bun", "install", "global"));
  });

  it("resolves relative installation and cache roots before appending the global layout", () => {
    expect(bunGlobalDirectory({ BUN_INSTALL: "bun" }, "linux")).toBe(
      resolve("bun", "install", "global"),
    );
    expect(bunGlobalDirectory({ XDG_CACHE_HOME: "cache" }, "linux")).toBe(
      resolve("cache", ".bun", "install", "global"),
    );
  });
});
