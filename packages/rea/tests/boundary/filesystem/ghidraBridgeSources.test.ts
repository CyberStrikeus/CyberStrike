import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { GHIDRA_BRIDGE_SOURCES } from "../../../src/ghidra/GhidraBridgeSources.js";
import {
  SUPPORTED_GHIDRA_JAVA_MAJOR,
  SUPPORTED_GHIDRA_VERSION,
} from "../../../src/ghidra/GhidraReleasePolicy.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

/** A stand-in compiler proves admission and cleanup, not real Java compilation. */
const installation = async (
  properties = "application.version=12.1.4\n",
  compilerStatus = 0,
) => {
  const root = await createTestTempDirectory("rea-ghidra-bridge-test-");
  const install = join(root, "Ghidra SDK");
  await mkdir(join(install, "Ghidra/Framework/lib"), { recursive: true });
  await writeFile(
    join(install, "Ghidra/application.properties"),
    properties,
    "latin1",
  );
  await writeFile(join(install, "Ghidra/Framework/lib/Generic.jar"), "");
  const javaHome = join(root, "JDK home");
  await mkdir(join(javaHome, "bin"), { recursive: true });
  const javac = join(javaHome, "bin/javac");
  await writeFile(
    javac,
    [
      "#!/bin/sh",
      'if [ "$1" = "-version" ]; then echo "javac 21.0.12"; exit 0; fi',
      ...(compilerStatus === 0
        ? ["exit 0"]
        : [
            'echo "bridge/ghidra/ReaGhidraBridge.java:1: error: cannot find symbol" >&2',
            "exit 1",
          ]),
    ].join("\n"),
  );
  await chmod(javac, 0o755);
  const scratchParent = join(root, "scratch");
  await mkdir(scratchParent);
  return {
    scratchParent,
    environment: {
      ...process.env,
      GHIDRA_INSTALL_DIR: install,
      JAVA_HOME: javaHome,
      TMPDIR: scratchParent,
    },
  };
};

type AdmissionCase = {
  name: string;
  properties: string;
  compilerStatus?: number;
  expectedVersion?: string;
  error?: string;
};
const admissionCases: readonly AdmissionCase[] = [
  { name: "compiler succeeds", properties: "application.version=12.1.4\n" },
  {
    name: "compiler fails",
    properties: "application.version=12.1.4\n",
    compilerStatus: 1,
    error: "bridge/ghidra/ReaGhidraBridge.java:1: error: cannot find symbol",
  },
  { name: "colon separator", properties: "application.version : 12.1.4\n" },
  {
    name: "escaped key and continued value",
    properties: "application\\u002eversion=12.1.\\\n  4\n",
  },
  {
    name: "Latin-1 distro suffix",
    properties: "application.version=12.1.4-é\n",
    expectedVersion: "12.1.4-é",
  },
  {
    name: "trailing version whitespace",
    properties: "application.version=12.1.4 \n",
    error: 'Observed application.version="12.1.4 ".',
  },
  {
    name: "malformed Unicode escape",
    properties: "application.version=12.1.4\nother=\\u00xx\n",
    error: "malformed_unicode_escape",
  },
];

// Only the stand-in executable is POSIX-specific. Real compilation runs in its
// hosted lane; the installed provider's Properties tests cover the parser too.
it.skipIf(process.platform === "win32").each(admissionCases)(
  "preserves version admission and scratch cleanup: $name",
  async ({ properties, compilerStatus, expectedVersion = "12.1.4", error }) => {
    const fixture = await installation(properties, compilerStatus);
    const run = execute(
      process.execPath,
      ["scripts/verify-ghidra-bridge-sources.mjs"],
      {
        cwd: process.cwd(),
        env: fixture.environment,
        timeout: 30_000,
      },
    );
    if (error === undefined)
      await expect(run).resolves.toMatchObject({
        stdout: expect.stringContaining(
          `"ghidra_version":${JSON.stringify(expectedVersion)}`,
        ),
      });
    else
      await expect(run).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(error),
      });
    expect(await readdir(fixture.scratchParent)).toEqual([]);
  },
);

it.skipIf(process.platform === "win32").each([
  { source: GHIDRA_BRIDGE_SOURCES.prepareCom, action: "deleted" },
  { source: GHIDRA_BRIDGE_SOURCES.applySeeds, action: "renamed" },
  { source: "UnregisteredHelper.java", action: "added" },
])(
  "rejects a $action launcher source before compilation: $source",
  async ({ source, action }) => {
    const repository = await createTestTempDirectory("rea-ghidra-source-set-");
    await mkdir(join(repository, "scripts"));
    await mkdir(join(repository, "src/ghidra"), { recursive: true });
    await writeFile(join(repository, "package.json"), '{"type":"module"}\n');
    for (const path of [
      "scripts/verify-ghidra-bridge-sources.mjs",
      "src/ghidra/GhidraBridgeSources.ts",
      "src/ghidra/GhidraJavaProperties.ts",
      "src/ghidra/GhidraReleasePolicy.ts",
    ])
      await copyFile(resolve(path), join(repository, path));
    await cp(resolve("bridge/ghidra"), join(repository, "bridge/ghidra"), {
      recursive: true,
    });
    const path = join(repository, "bridge/ghidra", source);
    if (action === "added")
      await writeFile(path, "class UnregisteredHelper {}\n");
    else if (action === "deleted") await unlink(path);
    else {
      const className = source.slice(0, -".java".length);
      await writeFile(
        path,
        (await readFile(path, "utf8")).replaceAll(
          className,
          `Renamed${className}`,
        ),
      );
      await rename(path, join(repository, "bridge/ghidra", `Renamed${source}`));
    }
    const fixture = await installation();
    await expect(
      execute(
        process.execPath,
        [join(repository, "scripts/verify-ghidra-bridge-sources.mjs")],
        {
          cwd: repository,
          env: fixture.environment,
          timeout: 30_000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        action === "added"
          ? `Ghidra bridge sources absent from the manifest: ${source}`
          : `Required Ghidra bridge source is missing: bridge/ghidra/${source}`,
      ),
    });
    expect(await readdir(fixture.scratchParent)).toEqual([]);
  },
);

it("rejects an omitted auxiliary source at the actual package verification boundary", async () => {
  const source = GHIDRA_BRIDGE_SOURCES.prepareCom;
  const packedFiles = [
    "package/bridge/hopper_bridge.py",
    "package/bridge/cutter/rea_bridge.py",
    ...Object.values(GHIDRA_BRIDGE_SOURCES)
      .filter((name) => name !== source)
      .map((name) => `package/bridge/ghidra/${name}`),
  ];
  await expect(
    execute(process.execPath, [
      "--input-type=module",
      "-e",
      `import { verifyPackedBridge } from "./scripts/verify-packed-bridge.mjs";
       import { createPackageVerifierCommands } from "./scripts/lib/verify-package-commands.mjs";
       import { withVerifierCleanup } from "./scripts/lib/verifier-cleanup.mjs";
       import { PrivateRuntimeRoot } from "./dist/process/PrivateRuntimeRoot.js";
       const root = await PrivateRuntimeRoot.create({ prefix: "rea-bridge-admission-" });
       let commands;
       await withVerifierCleanup(async () => {
         commands = await createPackageVerifierCommands({ workspace: root });
         await verifyPackedBridge({ tarball: "unused-because-admission-must-fail", packedFiles: JSON.parse(process.argv[1]), commands });
       }, [() => commands === undefined ? root.close() : commands.close()]);`,
      JSON.stringify(packedFiles),
    ]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      `package omitted package/bridge/ghidra/${source}`,
    ),
  });
});

it("binds the workflow SDK pin and verified compile mode to the canonical release", async () => {
  const { jobs } = z
    .object({
      jobs: z.object({
        "ghidra-bridge-sources": z.object({
          env: z.object({
            GHIDRA_RELEASE_URL: z.string(),
            GHIDRA_RELEASE_SHA256: z.string(),
          }),
          steps: z.array(
            z.object({ run: z.string().optional() }).passthrough(),
          ),
        }),
      }),
    })
    .parse(
      parseYaml(
        await readFile(
          resolve(".github/workflows/ghidra-bridge-sources.yml"),
          "utf8",
        ),
      ),
    );
  const job = jobs["ghidra-bridge-sources"];
  const pinIndex = job.steps.findIndex((step) =>
    step.run?.includes("--check-sdk-pin"),
  );
  const downloadIndex = job.steps.findIndex((step) =>
    step.run?.includes("curl "),
  );
  expect(pinIndex).toBeGreaterThanOrEqual(0);
  expect(downloadIndex).toBeGreaterThan(pinIndex);
  expect(job.steps.some((step) => step.run?.includes("--verified-sdk"))).toBe(
    true,
  );
  const command = [
    "scripts/verify-ghidra-bridge-sources.mjs",
    "--check-sdk-pin",
  ];
  await expect(
    execute(process.execPath, command, {
      env: { ...process.env, ...job.env },
    }),
  ).resolves.toMatchObject({
    stdout: `GHIDRA_JAVA_MAJOR=${SUPPORTED_GHIDRA_JAVA_MAJOR}\n`,
  });
  for (const env of [
    {
      ...job.env,
      GHIDRA_RELEASE_URL: job.env.GHIDRA_RELEASE_URL.replaceAll(
        SUPPORTED_GHIDRA_VERSION,
        "0.0.0",
      ),
    },
    { ...job.env, GHIDRA_RELEASE_SHA256: "not-a-digest" },
  ])
    await expect(
      execute(process.execPath, command, {
        env: { ...process.env, ...env },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "SDK URL and SHA256 must match verified Ghidra",
      ),
    });
});
