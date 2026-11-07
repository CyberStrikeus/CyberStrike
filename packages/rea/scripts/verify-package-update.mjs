import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

/** Exercise the packaged updater with real npm and a local release registry fixture. */
export async function verifyPackageUpdate({
  prefix,
  packageRoot,
  tarball,
  workspace,
  environment,
  commands,
}) {
  const metadataPath = join(packageRoot, "package.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const archive = await readFile(tarball);
  const entry = join(packageRoot, "scripts", "rea.mjs");
  const home = join(workspace, "update-home");
  const codexPath = join(home, ".codex", "config.toml");
  const originalConfig =
    '[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@0.0.0", "mcp"]\n';
  await mkdir(dirname(codexPath), { recursive: true });
  await writeFile(codexPath, originalConfig);
  let fixtureFailure;
  const fixture = new AbortController();
  const server = createServer((request, response) => {
    void serveRegistry(request, response).catch((error) => {
      fixtureFailure ??= { cause: error };
      fixture.abort(fixtureFailure.cause);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500);
      response.end(String(error));
    });
  });
  let registry;
  async function serveRegistry(request, response) {
    const pathname = new URL(request.url, registry).pathname;
    if (pathname === "/rea-agents") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          name: metadata.name,
          "dist-tags": { latest: metadata.version },
          versions: {
            [metadata.version]: {
              ...metadata,
              dist: {
                tarball: `${registry}/release.tgz`,
                integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
              },
            },
          },
        }),
      );
    } else if (pathname === "/release.tgz") {
      response.end(archive);
    } else if (request.method === "POST") {
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
    } else {
      const upstream = await fetch(`https://registry.npmjs.org${request.url}`);
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      response.end(body);
    }
  }
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return withVerifierCleanup(async () => {
    try {
      const address = server.address();
      if (typeof address !== "object" || address === null)
        throw new Error("Registry fixture did not bind");
      registry = `http://127.0.0.1:${address.port}`;
      // Model an older installed release's identity while retaining the new updater
      // under test. The registry supplies the unmodified packed target artifact.
      const generatedPath = join(
        packageRoot,
        "dist",
        "generatedPackageMetadata.js",
      );
      const generated = await readFile(generatedPath, "utf8");
      const previousVersion = "0.0.0";
      const previousGenerated = generated.replace(
        `version: "${metadata.version}"`,
        `version: "${previousVersion}"`,
      );
      if (previousGenerated === generated)
        throw new Error("Could not create previous-release identity fixture");
      await writeFile(generatedPath, previousGenerated);
      await writeFile(
        metadataPath,
        JSON.stringify({ ...metadata, version: previousVersion }),
      );
      const runtimeEnvironment = {
        ...environment,
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, "AppData", "Roaming"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
        CLAUDE_CONFIG_DIR: home,
        CODEX_HOME: join(home, ".codex"),
        COPILOT_HOME: join(home, ".copilot"),
        GROK_HOME: join(home, ".grok"),
        SAND_DATA_ROOT: join(home, ".grokbot"),
        OMP_PROFILE: undefined,
        PI_CODING_AGENT_DIR: undefined,
        PI_CONFIG_DIR: undefined,
        PI_PROFILE: undefined,
        XDG_CONFIG_HOME: join(home, ".config"),
        OPENCODE_CONFIG: join(home, ".config", "opencode", "opencode.json"),
        npm_config_prefix: prefix,
        npm_config_registry: registry,
      };
      const previous = (
        await commands.exec(process.execPath, [entry, "--version"], {
          env: runtimeEnvironment,
        })
      ).stdout.trim();
      if (previous !== previousVersion)
        throw new Error(`Previous-release fixture reported ${previous}`);
      const harness = join(workspace, "verify-update.mjs");
      await writeFile(
        harness,
        `
import { runUpdate } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist/application/Update.js")).href)};
import { systemUpdateHost } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist/application/UpdateRuntime.js")).href)};
const host = systemUpdateHost(${JSON.stringify(packageRoot)}, ${JSON.stringify(home)});
const result = await runUpdate(${JSON.stringify(previousVersion)}, host, "structured");
process.stdout.write(JSON.stringify(result));
if (result.status === "failed") process.exitCode = 1;
`,
      );
      const result = JSON.parse(
        (
          await commands.exec(process.execPath, [harness], {
            env: runtimeEnvironment,
            cwd: workspace,
            signal: fixture.signal,
            diagnosticBytes: 16 * 1024 * 1024,
          })
        ).stdout,
      );
      if (
        result.status !== "updated" ||
        result.installedVersion !== metadata.version ||
        result.command.at(-1) !== `${metadata.name}@${metadata.version}` ||
        result.maintenance.status !== "planned" ||
        result.maintenance.scope.clients.join(",") !== "codex" ||
        result.maintenance.scope.skill !== false
      )
        throw new Error(
          `Packaged updater failed its exact-release contract: ${JSON.stringify(result)}`,
        );
      if ((await readFile(codexPath, "utf8")) !== originalConfig)
        throw new Error(
          "Update applied integration maintenance without approval",
        );
      const current = (
        await commands.exec(process.execPath, [entry, "--version"], {
          env: runtimeEnvironment,
        })
      ).stdout.trim();
      if (current !== metadata.version)
        throw new Error(`Updated executable reported ${current}`);
      const help = (
        await commands.exec(process.execPath, [entry, "--help"], {
          env: runtimeEnvironment,
        })
      ).stdout;
      if (!/^\s{2}update\s/mu.test(help) || /^\s{2}upgrade\s/mu.test(help))
        throw new Error(
          "Updated CLI did not expose update as its sole maintenance command",
        );
      if (fixtureFailure !== undefined) throw fixtureFailure.cause;
      return {
        installed_version: result.installedVersion,
        exact_release: true,
        maintenance_read_only: true,
      };
    } catch (error) {
      // The registry owns its failure; command cleanup remains with commands.
      throw fixtureFailure === undefined ? error : fixtureFailure.cause;
    }
  }, [
    async () => {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) =>
        server.close((error) =>
          error === undefined ? resolveClose() : reject(error),
        ),
      );
    },
  ]);
}
