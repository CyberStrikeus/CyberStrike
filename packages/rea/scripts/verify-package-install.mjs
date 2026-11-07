import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Install the packed CLI globally with and without optional dependencies and verify PTY degradation. */
export async function verifyPackageInstall({
  tarball,
  prefix,
  workspace,
  environment,
  commands,
}) {
  await commands.execNpm(
    [
      "install",
      "--global",
      "--ignore-scripts",
      "--omit=dev",
      "--install-strategy=nested",
      "--prefix",
      prefix,
      tarball,
    ],
    { env: environment },
  );
  const cli = join(prefix, "bin", "rea");
  const packageRunnerCli = join(prefix, "bin", "rea-agents");
  if (
    !(await commands.run(packageRunnerCli, ["--help"], environment)).includes(
      "setup",
    )
  )
    throw new Error("packaged rea-agents alias did not expose setup");
  const processCaptureCapabilityUrl = pathToFileURL(
    join(
      prefix,
      "lib/node_modules/rea-agents/dist/process/capture/ProcessCaptureCapability.js",
    ),
  ).href;
  const processCaptureCapability = JSON.parse(
    (
      await commands.exec(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const { probeProcessCaptureCapability } = await import(${JSON.stringify(processCaptureCapabilityUrl)}); process.stdout.write(JSON.stringify(await probeProcessCaptureCapability()));`,
        ],
        { env: environment },
      )
    ).stdout,
  );
  if (processCaptureCapability.available !== true)
    throw new Error(
      `packaged PTY backend failed without lifecycle scripts: ${JSON.stringify(processCaptureCapability)}`,
    );
  const noOptionalPrefix = join(workspace, "prefix-no-optional");
  await commands.execNpm(
    [
      "install",
      "--global",
      "--ignore-scripts",
      "--omit=optional",
      "--prefix",
      noOptionalPrefix,
      tarball,
    ],
    { env: environment },
  );
  const noOptionalCli = join(noOptionalPrefix, "bin", "rea");
  await rm(
    join(
      noOptionalPrefix,
      "lib/node_modules/rea-agents/node_modules/@lydell",
      `node-pty-${process.platform}-${process.arch}`,
    ),
    { recursive: true, force: true },
  );
  const noOptionalCapabilityUrl = pathToFileURL(
    join(
      noOptionalPrefix,
      "lib/node_modules/rea-agents/dist/process/capture/ProcessCaptureCapability.js",
    ),
  ).href;
  const noOptionalCapability = JSON.parse(
    (
      await commands.exec(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const { probeProcessCaptureCapability } = await import(${JSON.stringify(noOptionalCapabilityUrl)}); process.stdout.write(JSON.stringify(await probeProcessCaptureCapability()));`,
        ],
        { env: environment },
      )
    ).stdout,
  );
  if (
    !(await commands.run(noOptionalCli, ["--help"], environment)).includes(
      "setup",
    ) ||
    noOptionalCapability.available !== false
  )
    throw new Error(
      `packaged CLI did not degrade without the optional PTY binary: ${JSON.stringify(noOptionalCapability)}`,
    );
  await verifyInstalledPackageCanRepack(commands, prefix, environment);
  return { cli, packageRunnerCli };
}

const verifyInstalledPackageCanRepack = async (
  commands,
  prefix,
  environment,
) => {
  const installedPackageRoot = join(prefix, "lib/node_modules/rea-agents");
  const repackedTarball = (
    await commands.execNpm(["pack", "--silent"], {
      cwd: installedPackageRoot,
      env: environment,
    })
  ).stdout.trim();
  await rm(join(installedPackageRoot, repackedTarball), { force: true });
};
