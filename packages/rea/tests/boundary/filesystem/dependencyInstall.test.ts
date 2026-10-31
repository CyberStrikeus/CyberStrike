import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const script = join(process.cwd(), "scripts", "check-dependency-install.mjs");
const sourceRoot = process.cwd();

const fixture = async (
  installedVersion?: string,
  omitDevDependency = false,
) => {
  const root = await createTestTempDirectory("rea-deps-");
  await mkdir(join(root, "node_modules"));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "": {
          dependencies: { alpha: "1.0.0" },
          devDependencies: { beta: "2.0.0" },
        },
        "node_modules/alpha": { version: "1.0.0" },
        "node_modules/beta": { version: "2.0.0" },
      },
    }),
  );
  await writeFile(
    join(root, "node_modules", ".package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/alpha": { version: installedVersion ?? "1.0.0" },
        ...(omitDevDependency
          ? {}
          : { "node_modules/beta": { version: "2.0.0" } }),
        "node_modules/unrelated": { version: "9.0.0" },
      },
    }),
  );
  return root;
};

describe("dependency install freshness", () => {
  it("accepts matching direct packages and ignores extraneous packages", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture(),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("reports a direct version mismatch with one remediation", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture("0.9.0"),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("alpha: installed 0.9.0, expected 1.0.0");
    expect(result.stderr).toContain("npm ci");
  });

  it("reports a missing direct development dependency", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture(undefined, true),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "beta: missing from the installed dependency lockfile",
    );
    expect(result.stderr).toContain("npm ci");
  });

  it("runs from a script path containing URL-escaped characters", async () => {
    const root = await fixture("0.9.0");
    const scriptDirectory = join(root, "path with spaces");
    const copiedScript = join(scriptDirectory, "check-dependency-install.mjs");
    await mkdir(scriptDirectory);
    await copyFile(script, copiedScript);

    const result = spawnSync(process.execPath, [copiedScript], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("alpha: installed 0.9.0, expected 1.0.0");
  });

  it("checks installed dependencies before restoring a cached build", async () => {
    const root = await createBuildCacheFixture();
    const seeded = await runNpm(root, ["run", "build:cached"]);
    expect(seeded.status, `${seeded.stdout}${seeded.stderr}`).toBe(0);

    const rootLock = asRecord(
      JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")),
    );
    const lockPackages = asRecord(rootLock?.packages);
    const rootPackage = asRecord(lockPackages?.[""]);
    const directDependencies = {
      ...asRecord(rootPackage?.dependencies),
      ...asRecord(rootPackage?.devDependencies),
    };
    const dependencyName = Object.keys(directDependencies).sort()[0];
    if (dependencyName === undefined)
      throw new Error("fixture has no direct dependencies");
    const dependencyPath = `node_modules/${dependencyName}`;
    const expectedDependency = asRecord(lockPackages?.[dependencyPath]);
    if (typeof expectedDependency?.version !== "string")
      throw new Error(
        `fixture is missing the locked ${dependencyName} version`,
      );
    const installedLockPath = join(root, "node_modules", ".package-lock.json");
    const installedLock = asRecord(
      JSON.parse(await readFile(installedLockPath, "utf8")),
    );
    const packages = asRecord(installedLock?.packages);
    const installedDependency = asRecord(packages?.[dependencyPath]);
    if (installedDependency === undefined)
      throw new Error(`fixture is missing installed ${dependencyName}`);
    installedDependency.version = "0.0.0";
    await writeFile(installedLockPath, JSON.stringify(installedLock));

    const blocked = await runNpm(root, ["run", "build:cached"]);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain(
      `${dependencyName}: installed 0.0.0, expected ${expectedDependency.version}`,
    );

    const cached = await runTurbo(root);
    expect(cached.status, cached.stderr).toBe(0);
    expect(`${cached.stdout}${cached.stderr}`).toMatch(/cache hit/u);
  }, 60_000);

  it("preserves caller resource controls in strict cached builds without hashing their values", async () => {
    const root = await createBuildCacheFixture();
    const environment = {
      ...process.env,
      TURBO_ENV_MODE: "strict",
      GOMAXPROCS: "1",
      GOMEMLIMIT: "384MiB",
      UV_THREADPOOL_SIZE: "2",
      REA_TEST_UNLISTED_ENV: "filtered",
    };

    const built = await runNpm(root, ["run", "build:cached"], environment);
    expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
    expect(
      JSON.parse(await readFile(join(root, "resource-controls.json"), "utf8")),
    ).toEqual({
      GOMAXPROCS: "1",
      GOMEMLIMIT: "384MiB",
      UV_THREADPOOL_SIZE: "2",
      REA_TEST_UNLISTED_ENV: null,
    });

    const cached = await runTurbo(root, {
      ...environment,
      GOMAXPROCS: "2",
      GOMEMLIMIT: "512MiB",
      UV_THREADPOOL_SIZE: "4",
    });
    expect(cached.status, `${cached.stdout}${cached.stderr}`).toBe(0);
    expect(`${cached.stdout}${cached.stderr}`).toMatch(/cache hit/u);
    expect(`${cached.stdout}${cached.stderr}`).not.toMatch(/cache miss/u);
  }, 60_000);
});

const createBuildCacheFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-build-cache-guard-");
  const packageJson = asRecord(
    JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")),
  );
  const scripts = asRecord(packageJson?.scripts);
  if (
    packageJson === undefined ||
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string" ||
    typeof scripts?.["build:cached"] !== "string"
  )
    throw new Error("package is missing its cached build command");
  const paths = [
    ".nvmrc",
    "package-lock.json",
    "turbo.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "scripts/check-dependency-install.mjs",
    "scripts/run-turbo.mjs",
    "scripts/run-typescript.mjs",
    "scripts/run-exclusive.mjs",
    "scripts/run-exclusive-command.mjs",
    "scripts/lib/windows-owned-command.mjs",
    "scripts/generate-skill-metadata.mjs",
    "scripts/clean-build-output.mjs",
    "scripts/generate-package-metadata.mjs",
    "scripts/lib/generated-file.mjs",
    "scripts/lib/verifier-source-loader.mjs",
    "src/domain/skillManifest.ts",
    "src/domain/result.ts",
    ".agents/skills/reverse-engineer-anything/SKILL.md",
    "src/generatedPackageMetadata.ts",
  ];
  await Promise.all(
    paths.map(async (path) => {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceRoot, path), destination);
    }),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      ...packageJson,
      scripts: {
        ...scripts,
        compile: "node scripts/cache-fixture-build.mjs",
      },
    }),
  );
  await writeFile(
    join(root, "scripts/cache-fixture-build.mjs"),
    `import { mkdir, writeFile } from "node:fs/promises";
await writeFile("resource-controls.json", JSON.stringify(Object.fromEntries(["GOMAXPROCS", "GOMEMLIMIT", "UV_THREADPOOL_SIZE", "REA_TEST_UNLISTED_ENV"].map((name) => [name, process.env[name] ?? null]))));
await mkdir("dist", { recursive: true });
await writeFile("dist/cache-fixture.js", "built");
await writeFile("dist/catalogIdentity.js", "export const FULL_CATALOG_IDENTITY = { counts: { mcp_tools: 1 } };\\n");
await writeFile("dist/identity.js", ${JSON.stringify(`export const PRODUCT_IDENTITY = ${JSON.stringify({ packageSpecifier: `${packageJson.name}@latest`, registrationPackageSpecifier: `${packageJson.name}@${packageJson.version}` })};\n`)});
`,
  );
  await createNodeModulesLinks(root);
  await writeFile(
    join(root, "node_modules", ".package-lock.json"),
    await readFile(join(sourceRoot, "node_modules", ".package-lock.json")),
  );
  return root;
};

const createNodeModulesLinks = async (root: string): Promise<void> => {
  const source = join(sourceRoot, "node_modules");
  const destination = join(root, "node_modules");
  await mkdir(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === ".package-lock.json") continue;
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      await mkdir(destinationPath);
      for (const packageName of await readdir(sourcePath))
        await symlink(
          join(sourcePath, packageName),
          join(destinationPath, packageName),
          process.platform === "win32" ? "junction" : undefined,
        );
    } else {
      await symlink(
        sourcePath,
        destinationPath,
        process.platform === "win32" ? "junction" : undefined,
      );
    }
  }
};

const runNpm = (
  cwd: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
) => run("npm", arguments_, cwd, environment);

const runTurbo = (cwd: string, environment: NodeJS.ProcessEnv = process.env) =>
  run(
    process.execPath,
    [
      join(cwd, "scripts", "run-turbo.mjs"),
      "run",
      "artifacts:skills",
      "--output-logs=full",
    ],
    cwd,
    environment,
  );

const run = (
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<{
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      cwd,
      env: environment,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (status) =>
      resolve({ status: status ?? 1, stdout, stderr }),
    );
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
