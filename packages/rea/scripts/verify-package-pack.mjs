import { importVerifierSource } from "./lib/verifier-source-loader.mjs";

import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FULL_CATALOG_IDENTITY } from "../dist/catalogIdentity.js";

import { parseTarListing } from "./lib/verify-package-listing.mjs";
import { verifyPackedBridge } from "./verify-packed-bridge.mjs";
import { pluginPackageMetadata } from "./lib/plugin-package.mjs";

const { parseSkillManifestMetadata } = await importVerifierSource(
  new URL("../src/domain/skillManifest.ts", import.meta.url).href,
  import.meta.url,
);

/** Create a tarball and assert production packaging constraints. */
export async function verifyPackagePack({ root, workspace, commands }) {
  const packDirectory = join(workspace, "pack");
  await mkdir(packDirectory);
  const stagingDirectory = join(workspace, "plugin-package");
  await mkdir(stagingDirectory);
  const [{ files }] = JSON.parse(
    (await commands.execNpm(["pack", "--dry-run", "--json"], { cwd: root }))
      .stdout,
  );
  // Reuse npm's file selection, then project metadata in an owned directory.
  // Source files and the development lock are never rewritten by packaging.
  for (const { path } of files) {
    const source = resolve(root, path);
    const contained = relative(root, source);
    if (
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    )
      throw new Error(`npm selected a path outside the package: ${path}`);
    const destination = join(stagingDirectory, contained);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  const { packageJson, shrinkwrap } = pluginPackageMetadata(
    JSON.parse(await readFile(join(root, "package.json"), "utf8")),
    JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")),
  );
  await writeFile(
    join(stagingDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeFile(
    join(stagingDirectory, "npm-shrinkwrap.json"),
    `${JSON.stringify(shrinkwrap, null, 2)}\n`,
  );
  // Materialize exactly the locked runtime tree without executing installers.
  await commands.execNpm(
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: stagingDirectory },
  );
  if (packageJson.dependencies?.["@lydell/node-pty"] !== undefined) {
    // npm ci filters foreign-platform optional packages. Include the exact locked
    // PTY archives as well, without re-resolving the installed dependency tree.
    const ptyManifest = JSON.parse(
      await readFile(
        join(stagingDirectory, "node_modules/@lydell/node-pty/package.json"),
        "utf8",
      ),
    );
    const platformDirectory = join(workspace, "plugin-platform-packages");
    await mkdir(platformDirectory);
    for (const dependency of Object.keys(ptyManifest.optionalDependencies)) {
      const destination = join(stagingDirectory, "node_modules", dependency);
      if (
        await access(destination).then(
          () => true,
          (cause) => {
            if (cause.code !== "ENOENT") throw cause;
            return false;
          },
        )
      )
        continue;
      const locked = shrinkwrap.packages[`node_modules/${dependency}`];
      if (locked?.version === undefined || locked.integrity === undefined)
        throw new Error(
          `Plugin platform dependency is not locked: ${dependency}`,
        );
      const [archive] = JSON.parse(
        (
          await commands.execNpm(
            [
              "pack",
              "--ignore-scripts",
              "--json",
              "--pack-destination",
              platformDirectory,
              `${dependency}@${locked.version}`,
            ],
            { cwd: platformDirectory },
          )
        ).stdout,
      );
      if (archive.integrity !== locked.integrity)
        throw new Error(
          `Plugin platform archive differs from the lock: ${dependency}`,
        );
      await mkdir(destination, { recursive: true });
      await commands.exec("tar", [
        "-xzf",
        join(platformDirectory, archive.filename),
        "-C",
        destination,
        "--strip-components=1",
      ]);
    }
  }
  const tarball = join(
    packDirectory,
    (
      await commands.execNpm(
        ["pack", "--silent", "--pack-destination", packDirectory],
        {
          cwd: stagingDirectory,
        },
      )
    ).stdout.trim(),
  );
  const packedFiles = parseTarListing(
    (await commands.exec("tar", ["-tf", tarball])).stdout,
  );
  const packedManifest = JSON.parse(
    (await commands.exec("tar", ["-xOf", tarball, "package/package.json"]))
      .stdout,
  );
  if (packedManifest.mcpName !== "io.github.morluto/rea")
    throw new Error("package did not retain its MCP Registry ownership marker");
  const packedLock = JSON.parse(
    (
      await commands.exec("tar", [
        "-xOf",
        tarball,
        "package/npm-shrinkwrap.json",
      ])
    ).stdout,
  );
  if (
    packedManifest.overrides !== undefined ||
    packedManifest.devDependencies !== undefined ||
    ![2, 3].includes(packedLock.lockfileVersion) ||
    packedLock.version !== packedManifest.version ||
    packedLock.packages?.[""].version !== packedManifest.version ||
    JSON.stringify(packedLock.packages?.[""].dependencies) !==
      JSON.stringify(packedManifest.dependencies) ||
    JSON.stringify(packedLock.packages?.[""].optionalDependencies) !==
      JSON.stringify(packedManifest.optionalDependencies)
  )
    throw new Error(
      "package is not installable under the Claude plugin dependency policy",
    );
  for (const dependency of Object.keys(packedManifest.dependencies))
    if (
      !packedFiles.includes(`package/node_modules/${dependency}/package.json`)
    )
      throw new Error(
        `Plugin runtime dependency is not bundled: ${dependency}`,
      );
  const pty = JSON.parse(
    (
      await commands.exec("tar", [
        "-xOf",
        tarball,
        "package/node_modules/@lydell/node-pty/package.json",
      ])
    ).stdout,
  );
  for (const dependency of Object.keys(pty.optionalDependencies))
    if (
      !packedFiles.includes(`package/node_modules/${dependency}/package.json`)
    )
      throw new Error(
        `Plugin PTY platform dependency is missing: ${dependency}`,
      );
  if (
    packedManifest.scripts?.postinstall !== undefined ||
    packedManifest.dependencies?.["node-pty"] !== undefined ||
    packedManifest.dependencies?.["@lydell/node-pty"] !== "1.1.0"
  )
    throw new Error("package retained a lifecycle-dependent PTY installation");
  if (
    packedManifest.bin?.rea !== "scripts/rea.mjs" ||
    packedManifest.bin?.["rea-agents"] !== "scripts/rea.mjs"
  )
    throw new Error("package did not expose both rea command entry points");
  if (!packedFiles.includes("package/scripts/lib/cli-process-environment.mjs"))
    throw new Error("package omitted the CLI process environment owner");
  if (packedFiles.some((path) => path.startsWith("package/.agents/")))
    throw new Error(
      "package included authored skill sources instead of only the generated bundle",
    );
  if (packedFiles.some((path) => path.startsWith("package/src/")))
    throw new Error(
      "Packaged runtime must not masquerade as a source checkout",
    );
  if (packedFiles.some((path) => path.startsWith("package/.cache/")))
    throw new Error("package included development cache or test metadata");
  const skill = (
    await commands.exec("tar", [
      "-xOf",
      tarball,
      "package/skills/reverse-engineer-anything/SKILL.md",
    ])
  ).stdout;
  const skillMetadata = parseSkillManifestMetadata(skill);
  if (
    !skillMetadata.ok ||
    skillMetadata.value.toolCount !== FULL_CATALOG_IDENTITY.counts.mcp_tools ||
    skillMetadata.value.hasCatalogDigest
  )
    throw new Error(
      "packaged skill metadata did not match the catalog shipped in the package",
    );
  for (const path of [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
  ]) {
    const manifest = JSON.parse(
      (await commands.exec("tar", ["-xOf", tarball, `package/${path}`])).stdout,
    );
    const serverConfig = path.startsWith(".codex")
      ? JSON.parse(
          (
            await commands.exec("tar", [
              "-xOf",
              tarball,
              "package/.codex-plugin/mcp.json",
            ])
          ).stdout,
        )
      : manifest;
    const expectedArgs = [
      `${path.startsWith(".claude") ? "${CLAUDE_PLUGIN_ROOT}/" : "./"}scripts/plugin-mcp-launcher.mjs`,
      packedManifest.version,
    ];
    if (
      manifest.version !== packedManifest.version ||
      manifest.skills !== "./skills" ||
      (path.startsWith(".codex")
        ? manifest.mcpServers !== "./.codex-plugin/mcp.json" ||
          serverConfig.mcpServers?.rea?.cwd !== "." ||
          serverConfig.mcpServers?.rea?.startup_timeout_sec !== 30
        : false) ||
      serverConfig.mcpServers?.rea?.command !== "node" ||
      JSON.stringify(serverConfig.mcpServers?.rea?.args) !==
        JSON.stringify(expectedArgs)
    )
      throw new Error(
        `Packaged plugin ${path} does not match the exact runtime and canonical skill release`,
      );
    const icons = path.startsWith(".codex")
      ? [manifest.interface?.logo, manifest.interface?.composerIcon]
      : [manifest.icon];
    for (const icon of icons)
      if (
        icon !== "./assets/rea-plugin.png" ||
        !packedFiles.includes(`package/${icon.slice(2)}`)
      )
        throw new Error(`Packaged plugin ${path} is missing its shared icon`);
  }
  if (packedFiles.includes("package/.mcp.json"))
    throw new Error("Plugin metadata must not register a project MCP server");
  if (!packedFiles.includes("package/.codex-plugin/mcp.json"))
    throw new Error("Packaged Codex MCP server declaration is missing");
  if (!packedFiles.includes("package/scripts/plugin-mcp-launcher.mjs"))
    throw new Error("Packaged plugin launcher is missing");
  if (
    skill.includes(`${packedManifest.name}@latest`) ||
    !skill.includes(`${packedManifest.name}@${packedManifest.version}`)
  )
    throw new Error(
      "Packaged plugin skill recovery is not pinned to the shipped runtime",
    );
  await verifyPackedBridge({ tarball, packedFiles, commands });
  return { tarball };
}
