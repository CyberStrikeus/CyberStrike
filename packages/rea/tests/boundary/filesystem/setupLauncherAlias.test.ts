import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import {
  classifyClientRegistrationCommand,
  registrationRuntimePath,
} from "../../../src/application/ClientRegistrationIdentity.js";
import { readClientRegistrationInspections } from "../../../src/application/ClientRegistrationStatus.js";
import { javaScriptRuntime } from "../../../src/domain/runtimeVersion.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "registers a same-file PATH launcher whose manager-owned alias survives a version switch",
  async () => {
    const root = await createTestTempDirectory("rea-stable-launcher-alias-");
    const installs = join(root, "installs");
    const old = join(installs, "old");
    const next = join(installs, "next");
    const scriptWithin = (tag: string) =>
      join("node_modules", ".mise", `rea-agents@${tag}`, "scripts", "rea.mjs");
    for (const [version, tag] of [
      [old, "old"],
      [next, "next"],
    ] as const) {
      await mkdir(join(version, "bin"), { recursive: true });
      const script = join(version, scriptWithin(tag));
      await mkdir(dirname(script), { recursive: true });
      await writeFile(script, "#!/usr/bin/env node\n", { mode: 0o700 });
      await symlink(script, join(version, "bin", "rea"));
    }
    const latest = join(installs, "latest");
    await symlink(old, latest, "dir");
    const unstable = join(latest, scriptWithin("old"));
    const alias = join(latest, "bin", "rea");
    const command = currentClientRegistrationCommand({
      platform: "linux",
      entrypointPath: unstable,
      environment: { PATH: join(latest, "bin") },
    });
    expect(command).toEqual([process.execPath, alias, "mcp"]);
    expect(classifyClientRegistrationCommand(command, unstable)).toBe("owned");
    await rm(latest);
    await symlink(next, latest, "dir");
    await rm(old, { recursive: true });
    await expect(access(unstable)).rejects.toMatchObject({ code: "ENOENT" });
    await access(command[1]!);
    expect(await realpath(command[1]!)).toBe(join(next, scriptWithin("next")));
    expect(
      classifyClientRegistrationCommand(
        command,
        join(next, scriptWithin("next")),
      ),
    ).toBe("owned");
  },
);

it.skipIf(process.platform === "win32").each(["node", "bun"] as const)(
  "preserves a same-file %s runtime alias across a manager version switch",
  async (runtime) => {
    const root = await createTestTempDirectory("rea-stable-runtime-alias-");
    const old = join(root, "old");
    const next = join(root, "next");
    for (const [directory, contents] of [
      [old, "old runtime"],
      [next, "next runtime"],
    ] as const) {
      await mkdir(directory);
      await writeFile(join(directory, runtime), contents, { mode: 0o700 });
    }
    const latest = join(root, "latest");
    await symlink(old, latest, "dir");
    const executable = join(old, runtime);
    const alias = join(latest, runtime);
    const selected = registrationRuntimePath(
      executable,
      runtime,
      { PATH: latest },
      "linux",
    );
    expect(selected).toBe(alias);
    expect(await realpath(selected)).toBe(executable);

    await rm(latest);
    await symlink(next, latest, "dir");
    await rm(old, { recursive: true });
    await expect(access(executable)).rejects.toMatchObject({ code: "ENOENT" });
    await access(selected);
    expect(await realpath(selected)).toBe(join(next, runtime));
    expect(
      registrationRuntimePath(
        join(next, runtime),
        runtime,
        { PATH: latest },
        "linux",
      ),
    ).toBe(selected);
  },
);

it.skipIf(process.platform === "win32")(
  "does not replace the selected runtime with a foreign executable or manager shim",
  async () => {
    const root = await createTestTempDirectory("rea-runtime-alias-identity-");
    const foreign = join(root, "foreign");
    const missing = join(root, "missing");
    const valid = join(root, "valid");
    const runtime = javaScriptRuntime(process.versions).id;
    const script = join(root, "rea.mjs");
    await writeFile(script, "// selected REA script\n");
    for (const directory of [foreign, missing, valid]) await mkdir(directory);
    await writeFile(join(foreign, runtime), '#!/bin/sh\nexec node "$@"\n', {
      mode: 0o700,
    });
    await symlink(join(root, "absent"), join(missing, runtime));
    await symlink(process.execPath, join(valid, runtime));
    expect(
      registrationRuntimePath(
        process.execPath,
        runtime,
        { PATH: `${foreign}:${missing}:relative` },
        "linux",
      ),
    ).toBe(process.execPath);
    expect(
      registrationRuntimePath(
        process.execPath,
        runtime,
        { PATH: `${foreign}:${valid}` },
        "linux",
      ),
    ).toBe(join(valid, runtime));
    expect(
      currentClientRegistrationCommand({
        platform: "linux",
        entrypointPath: script,
        environment: { PATH: valid },
      }),
    ).toEqual([join(valid, runtime), script, "mcp"]);
    expect(
      registrationRuntimePath(
        process.execPath,
        runtime,
        { PATH: valid },
        "win32",
      ),
    ).toBe(process.execPath);
  },
);

it.skipIf(process.platform === "win32")(
  "checks the native PATH alias instead of collapsing a symlink parent segment",
  async () => {
    const root = await createTestTempDirectory("rea-runtime-path-parent-");
    const runtime = javaScriptRuntime(process.versions).id;
    await mkdir(join(root, "selected"));
    await mkdir(join(root, "other", "child"), { recursive: true });
    await mkdir(join(root, "other", "selected"));
    await symlink(join(root, "other", "child"), join(root, "link"));
    await symlink(process.execPath, join(root, "selected", runtime));
    await writeFile(
      join(root, "other", "selected", runtime),
      "foreign runtime\n",
      { mode: 0o700 },
    );
    expect(
      registrationRuntimePath(
        process.execPath,
        runtime,
        {
          PATH: `${root}/link/../selected`,
        },
        process.platform,
      ),
    ).toBe(process.execPath);
  },
);

it.skipIf(process.platform === "win32")(
  "retains unknown runtime identity after its executable disappears despite a known REA script",
  async () => {
    const home = await createTestTempDirectory("rea-removed-runtime-");
    const executable = join(home, "node");
    const script = join(home, "rea.mjs");
    const config = join(home, ".cursor", "mcp.json");
    await symlink(process.execPath, executable);
    await writeFile(script, "// selected REA script\n");
    await mkdir(join(home, ".cursor"));
    const command = [executable, script, "mcp"];
    const original = JSON.stringify({
      mcpServers: {
        rea: { command: executable, args: [script, "mcp"] },
      },
    });
    await writeFile(config, original);
    const inspect = () =>
      readClientRegistrationInspections(home, script, {
        environment: {},
        selectedClientIds: ["cursor"],
      });
    expect(await inspect()).toContainEqual(
      expect.objectContaining({
        commandIdentity: "owned",
        status: expect.objectContaining({ client: "cursor", state: "aligned" }),
      }),
    );
    await rm(executable);
    expect(classifyClientRegistrationCommand(command, script)).toBe("unknown");
    expect(await inspect()).toContainEqual(
      expect.objectContaining({
        commandIdentity: "unknown",
        status: expect.objectContaining({
          client: "cursor",
          state: "unknown",
          command,
          remediation: expect.any(String),
        }),
      }),
    );
    expect(await readFile(config, "utf8")).toBe(original);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps selected entrypoint when PATH aliases are foreign, unresolved, unexecutable or relative",
  async () => {
    const root = await createTestTempDirectory("rea-unproven-launcher-alias-");
    const entrypoint = join(root, "selected.mjs");
    await writeFile(entrypoint, "selected", { mode: 0o700 });
    const foreign = join(root, "foreign");
    const missing = join(root, "missing");
    const unexecutable = join(root, "unexecutable");
    for (const path of [foreign, missing, unexecutable]) await mkdir(path);
    await writeFile(join(foreign, "rea"), "different program", { mode: 0o700 });
    await symlink(join(root, "absent"), join(missing, "rea"));
    // Same identity cannot be reached via an executable launcher when the selected
    // file itself has no executable bit; no shell wrapper is inferred or run.
    const selected = join(root, "unexecutable.mjs");
    await writeFile(selected, "selected", { mode: 0o600 });
    await symlink(selected, join(unexecutable, "rea"));
    expect(
      currentClientRegistrationCommand({
        platform: "linux",
        entrypointPath: entrypoint,
        environment: { PATH: `${foreign}:${missing}:relative` },
      }),
    ).toEqual([process.execPath, entrypoint, "mcp"]);
    expect(
      currentClientRegistrationCommand({
        platform: "linux",
        entrypointPath: selected,
        environment: { PATH: unexecutable },
      }),
    ).toEqual([process.execPath, selected, "mcp"]);
    expect(
      currentClientRegistrationCommand({
        platform: "win32",
        entrypointPath: entrypoint,
        environment: { PATH: foreign },
      }),
    ).toEqual([process.execPath, entrypoint, "mcp"]);
  },
);
