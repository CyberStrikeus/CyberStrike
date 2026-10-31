import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import {
  systemUninstallHost,
  type UninstallFileSystem,
} from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ClientConfigurationPublication } from "../../../src/application/ClientConfigurationPublication.js";

it
  .skipIf(process.platform === "win32")
  .each(["direct", "parent", "lexical-parent"] as const)(
  "keeps the selected file after a parent alias retarget: %s",
  async (variant) => {
    const parentTraversal = variant !== "direct";
    const root = await createTestTempDirectory("rea-config-retarget-");
    const first = join(root, "first");
    const second = variant === "lexical-parent" ? root : join(root, "second");
    for (const directory of [first, second]) {
      await mkdir(join(directory, "child"), { recursive: true });
      await writeFile(join(directory, "config.json"), "original");
    }
    const alias = join(root, "link");
    await symlink(parentTraversal ? join(first, "child") : first, alias);
    const requestedPath = `${alias}/${parentTraversal ? "../" : ""}config.json`;
    const selected = join(first, "config.json");
    const state = await lstat(selected);
    await rm(alias);
    await symlink(parentTraversal ? join(second, "child") : second, alias);
    const publication = await ClientConfigurationPublication.write(
      selected,
      "updated",
      "original",
      { requestedPath, state },
    );
    await publication.verify(async () => {
      await publication.assertCurrent(await readFile(publication.path, "utf8"));
      expect(await readFile(selected, "utf8")).toBe("updated");
      expect(await readFile(join(second, "config.json"), "utf8")).toBe(
        "original",
      );
    });
  },
);

it.skipIf(process.platform === "win32")(
  "preserves an existing client configuration mode while keeping new files private",
  async () => {
    const root = await createTestTempDirectory("rea-config-mode-");
    const existing = join(root, "existing.json");
    const fresh = join(root, "fresh.json");
    const original = '{"keep":"caller data"}\n';
    await writeFile(existing, original);
    await chmod(existing, 0o640);

    const client = {
      name: "cursor",
      format: "json",
      configPath: existing,
    } as const;
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toMatchObject({ status: "configured" });
    expect((await lstat(existing)).mode & 0o777).toBe(0o640);
    expect((await lstat(`${existing}.rea.backup`)).mode & 0o777).toBe(0o640);
    expect(await readFile(`${existing}.rea.backup`, "utf8")).toBe(original);
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toMatchObject({ status: "unchanged" });
    expect((await lstat(existing)).mode & 0o777).toBe(0o640);

    expect(
      await configureClientConfiguration({ ...client, configPath: fresh }, {}, [
        "rea",
        "mcp",
      ]),
    ).toMatchObject({ status: "configured" });
    expect((await lstat(fresh)).mode & 0o777).toBe(0o600);
  },
);

const failedVerificationFileSystem = (
  failure: "verification" | "recovery",
): UninstallFileSystem => {
  return {
    readText: (path) => readFile(path, "utf8"),
    copy: (source, destination) =>
      copyFile(source, destination, fsConstants.COPYFILE_EXCL),
    publishConfiguration: async (path, contents, original) => {
      const publication = await ClientConfigurationPublication.write(
        path,
        contents,
        original,
      );
      publication.assertCurrent = async () => {
        throw new Error("verification failed");
      };
      if (failure === "recovery")
        publication.restore = async () => {
          throw new Error("restore failed");
        };
      return publication;
    },
    stat: (path) => lstat(path),
    realpath: (path) => realpath(path),
    remove: (path) => rm(path, { recursive: true }),
  };
};

describe("uninstall backups after edits made since setup", () => {
  const editedSinceSetup = async (prefix: string) => {
    const root = await createTestTempDirectory(prefix);
    const configPath = join(root, "config.json");
    const client = { name: "cursor", format: "json", configPath } as const;
    const beforeSetup = '{"keep":"before setup"}\n';
    await writeFile(configPath, beforeSetup);
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toMatchObject({ status: "configured" });
    const configured = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    const beforeUninstall = `${JSON.stringify({ ...configured, keep: "edited after setup" }, null, 2)}\n`;
    await writeFile(configPath, beforeUninstall);
    const recoveryPath = `${configPath}.rea.backup.${createHash("sha256")
      .update(beforeUninstall, "utf8")
      .digest("hex")}.recovery`;
    return {
      root,
      configPath,
      client,
      beforeSetup,
      beforeUninstall,
      recoveryPath,
    };
  };

  it("preserves the pre-uninstall bytes when removal succeeds", async () => {
    const {
      root,
      configPath,
      client,
      beforeSetup,
      beforeUninstall,
      recoveryPath,
    } = await editedSinceSetup("rea-uninstall-current-backup-");
    expect((await systemUninstallHost(root).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(
      beforeSetup,
    );
    expect(await readFile(recoveryPath, "utf8")).toBe(beforeUninstall);
  });

  it.each([
    [
      "verification",
      (path: string) =>
        `Configuration could not be updated. The original was restored and its backup at ${path} was retained. Repair the configuration or restore that backup, then rerun uninstall.`,
    ],
    [
      "recovery",
      (path: string) =>
        `Configuration could not be updated or restored. Restore the backup at ${path} manually, then rerun uninstall.`,
    ],
  ] as const)(
    "names the backup holding the pre-uninstall bytes when %s fails",
    async (failure, message) => {
      const {
        root,
        configPath,
        client,
        beforeSetup,
        beforeUninstall,
        recoveryPath,
      } = await editedSinceSetup("rea-uninstall-current-backup-failure-");
      expect(
        await systemUninstallHost(
          root,
          failedVerificationFileSystem(failure),
        ).removeClient(client),
      ).toEqual({
        name: "cursor",
        status: "failed",
        detail: message(recoveryPath),
      });
      if (failure === "verification")
        expect(await readFile(configPath, "utf8")).toBe(beforeUninstall);
      else
        expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
          keep: "edited after setup",
          mcpServers: {},
        });
      expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(
        beforeSetup,
      );
      expect(await readFile(recoveryPath, "utf8")).toBe(beforeUninstall);
    },
  );

  it("blocks removal when the content-addressed backup holds other data", async () => {
    const { root, configPath, client, beforeUninstall, recoveryPath } =
      await editedSinceSetup("rea-uninstall-current-backup-occupied-");
    await writeFile(recoveryPath, "occupied by other data");
    const result = await systemUninstallHost(root).removeClient(client);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain(recoveryPath);
    expect(await readFile(configPath, "utf8")).toBe(beforeUninstall);
    expect(await readFile(recoveryPath, "utf8")).toBe("occupied by other data");
  });

  it.each([
    ["missing", async () => undefined],
    [
      "wrong",
      (_source: string, destination: string) =>
        writeFile(destination, "not the current configuration", {
          flag: "wx",
        }),
    ],
  ] as const)(
    "blocks removal when the reported copy leaves %s backup bytes",
    async (_label, copy) => {
      const { root, configPath, client, beforeUninstall } =
        await editedSinceSetup("rea-uninstall-current-backup-unverified-");
      let writes = 0;
      const result = await systemUninstallHost(root, {
        ...failedVerificationFileSystem("verification"),
        copy,
        publishConfiguration: async () => {
          writes += 1;
          throw new Error("unexpected publication before verified backup");
        },
      }).removeClient(client);
      expect(result.status).toBe("failed");
      expect(result.detail).toMatch(
        /^Configuration could not be backed up, so no change was made\. /,
      );
      expect(writes).toBe(0);
      expect(await readFile(configPath, "utf8")).toBe(beforeUninstall);
    },
  );
});

it("accepts a literal UTF-8 replacement character without changing its value", async () => {
  const root = await createTestTempDirectory("rea-client-config-utf8-");
  const configPath = join(root, "config.json");
  const original = Buffer.concat([
    Buffer.from('{"label":"'),
    Buffer.from("\uFFFD"),
    Buffer.from('"}'),
  ]);
  await writeFile(configPath, original);
  const result = await configureClientConfiguration(
    { name: "cursor", format: "json", configPath },
    {},
    ["rea", "mcp"],
  );
  expect(result.status).toBe("configured");
  expect(
    Buffer.compare(await readFile(`${configPath}.rea.backup`), original),
  ).toBe(0);
  expect(JSON.parse(await readFile(configPath, "utf8")).label).toBe("\uFFFD");
});

it("previews and creates a current recovery backup while preserving the first backup", async () => {
  const root = await createTestTempDirectory("rea-client-current-recovery-");
  const configPath = join(root, "config.json");
  const firstOriginal = '{"keep":"first"}\n';
  const currentOriginal = '{"keep":"current"}\n';
  const client = { name: "cursor", format: "json", configPath } as const;
  await writeFile(configPath, currentOriginal);
  await writeFile(`${configPath}.rea.backup`, firstOriginal);

  const recoveryPath = `${configPath}.rea.backup.${createHash("sha256")
    .update(currentOriginal, "utf8")
    .digest("hex")}.recovery`;
  expect(await inspectClientConfiguration(client, {}, ["rea", "mcp"])).toEqual({
    status: "update",
    backupPath: recoveryPath,
  });

  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toEqual({ status: "configured", backupPath: recoveryPath });
  expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(
    firstOriginal,
  );
  expect(await readFile(recoveryPath, "utf8")).toBe(currentOriginal);
});

it("blocks configuration when the planned content-addressed backup is occupied", async () => {
  const root = await createTestTempDirectory("rea-client-recovery-conflict-");
  const configPath = join(root, "config.json");
  const firstOriginal = '{"keep":"first"}\n';
  const currentOriginal = '{"keep":"current"}\n';
  const client = { name: "cursor", format: "json", configPath } as const;
  await writeFile(configPath, currentOriginal);
  await writeFile(`${configPath}.rea.backup`, firstOriginal);
  const recoveryPath = `${configPath}.rea.backup.${createHash("sha256")
    .update(currentOriginal, "utf8")
    .digest("hex")}.recovery`;
  await writeFile(recoveryPath, "occupied by other data");

  expect(
    await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toMatchObject({
    status: "invalid",
    remediation: expect.stringContaining(recoveryPath),
  });
  expect(
    await configureClientConfiguration(client, {}, ["rea", "mcp"]),
  ).toEqual({ status: "failed", reason: "backup" });
  expect(await readFile(configPath, "utf8")).toBe(currentOriginal);
  expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(
    firstOriginal,
  );
  expect(await readFile(recoveryPath, "utf8")).toBe("occupied by other data");
});

describe("client configuration write failures", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0).each([
    ["json", configureClientConfiguration],
    ["toml", configureClientConfiguration],
  ] as const)(
    "classifies a denied %s write as a write failure",
    async (format, configure) => {
      const root = await createTestTempDirectory("rea-client-unwritable-");
      await chmod(root, 0o500);
      try {
        expect(
          await configure({
            name: format === "toml" ? "codex" : "cursor",
            format,
            configPath: join(root, `config.${format}`),
          }),
        ).toMatchObject({
          status: "failed",
          reason: "write",
          failure: {
            operation: "publish",
            path: join(root, `config.${format}`),
            systemCode: expect.stringMatching(/^(?:EACCES|EPERM)$/u),
          },
        });
      } finally {
        await chmod(root, 0o700);
      }
    },
  );
});

describe("TOML client configuration comparison", () => {
  it("replaces a registration containing a non-finite TOML float and preserves unrelated settings", async () => {
    const value = "-inf";
    const root = await createTestTempDirectory("rea-client-toml-");
    const configPath = join(root, "config.toml");
    const original = `unrelated = ${value}\n[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@6.1.0", "mcp"]\nstartup_timeout_sec = ${value}\n`;
    await writeFile(configPath, original);
    const client = { name: "codex", format: "toml", configPath } as const;
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toEqual({
      status: "configured",
      backupPath: `${configPath}.rea.backup`,
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(configPath, "utf8")).toContain(
      `unrelated = ${value}`,
    );
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toEqual({
      status: "unchanged",
    });
  });
});

const unrelatedToml = [
  "# Keep this explanation.",
  'notify = ["a", "b"]',
  "literal = 'C:\\demo\\path'",
  'disabled_mcp_servers = ["rea", "other"] # Not a Codex registration.',
  "",
].join("\n");

const unrelatedServer = [
  "# Keep the other server.",
  '[mcp_servers."rea.env"]',
  "command = 'other'",
  "",
].join("\n");

const unrelatedValues = (text: string) => {
  const document = parseToml(text);
  const servers = document.mcp_servers;
  if (typeof servers === "object" && servers !== null) {
    Reflect.deleteProperty(servers, "rea");
    if (Object.keys(servers).length === 0) delete document.mcp_servers;
  }
  return document;
};

describe("Codex configuration text preservation", () => {
  it.each([
    {
      name: "new registration",
      original: unrelatedToml,
      preserved: [unrelatedToml],
    },
    {
      name: "quoted tables and nested environment",
      original: `${unrelatedToml}[mcp_servers."rea"]\ncommand = "npx"\nargs = ["-y", "rea-agents@6.1.0", "mcp"]\n[mcp_servers.rea.env]\nOLD = "value"\n${unrelatedServer}`,
      preserved: [unrelatedToml, unrelatedServer],
    },
    {
      name: "dotted registration keys",
      original: `${unrelatedToml}mcp_servers.rea.command = "npx"\nmcp_servers.rea.args = ["-y", "rea-agents@6.1.0", "mcp"]\n${unrelatedServer}`,
      preserved: [unrelatedToml, unrelatedServer],
    },
    {
      name: "inline server table",
      original: `${unrelatedToml}mcp_servers = { rea = { command = "npx", args = ["-y", "rea-agents@6.1.0", "mcp"] }, other = { command = 'other' } } # Shared table.\n`,
      preserved: [
        unrelatedToml,
        "other = { command = 'other' }",
        "# Shared table.",
      ],
    },
    {
      name: "BOM, CRLF, and multiline text resembling a registration",
      original:
        `\uFEFF${unrelatedToml}banner = '''\n[mcp_servers.rea]\n# This is string content.\n'''\n`.replaceAll(
          "\n",
          "\r\n",
        ),
      preserved: [
        unrelatedToml.replaceAll("\n", "\r\n"),
        "banner = '''\r\n[mcp_servers.rea]\r\n# This is string content.\r\n'''",
      ],
    },
    {
      name: "comments without settings",
      original: "# Keep this explanation.\n# And this trailing comment.\n\n",
      preserved: ["# Keep this explanation.", "# And this trailing comment."],
    },
  ])(
    "preserves unrelated text through $name setup and uninstall",
    async ({ original, preserved }) => {
      const root = await createTestTempDirectory("rea-codex-preserve-");
      const configPath = join(root, "config.toml");
      const client = { name: "codex", format: "toml", configPath } as const;
      await writeFile(configPath, original);

      expect(
        await configureClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "configured" });
      const configured = await readFile(configPath, "utf8");
      for (const text of preserved) expect(configured).toContain(text);
      expect(unrelatedValues(configured)).toEqual(unrelatedValues(original));
      expect(configured.startsWith("\uFEFF")).toBe(
        original.startsWith("\uFEFF"),
      );
      expect(
        await configureClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toEqual({ status: "unchanged" });
      expect(await readFile(configPath, "utf8")).toBe(configured);

      expect(
        (await systemUninstallHost(root).removeClient(client)).status,
      ).toBe("removed");
      const removed = await readFile(configPath, "utf8");
      for (const text of preserved) expect(removed).toContain(text);
      expect(unrelatedValues(removed)).toEqual(unrelatedValues(original));
      expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
      expect(removed.startsWith("\uFEFF")).toBe(original.startsWith("\uFEFF"));
      expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    },
  );

  it("retains the first backup after uninstall and a later setup", async () => {
    const root = await createTestTempDirectory("rea-codex-backup-");
    const configPath = join(root, "config.toml");
    const client = { name: "codex", format: "toml", configPath } as const;
    const original = 'notify = ["a", "b"]\n';
    await writeFile(configPath, original);
    await configureClientConfiguration(client, {}, ["rea", "mcp"]);
    expect((await systemUninstallHost(root).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    await configureClientConfiguration(client, {}, ["rea", "mcp"]);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  });

  it("refuses malformed Codex TOML unchanged without creating a backup", async () => {
    const root = await createTestTempDirectory("rea-codex-malformed-");
    const configPath = join(root, "config.toml");
    const client = { name: "codex", format: "toml", configPath } as const;
    const original =
      "# Keep this explanation.\n[mcp_servers.rea]\ncommand = [broken\n";
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(client, {}, ["rea", "mcp"]),
    ).toEqual({ status: "failed", reason: "readback" });
    expect((await systemUninstallHost(root).removeClient(client)).status).toBe(
      "failed",
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it
  .skipIf(process.platform === "win32" || process.getuid?.() === 0)
  .each([0o400, 0o640])(
  "uninstall preserves configuration mode %s while retaining recovery authority",
  async (mode) => {
    const root = await createTestTempDirectory("rea-uninstall-file-mode-");
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n',
    );
    await chmod(configPath, mode);
    const host = systemUninstallHost(root);
    try {
      expect(
        (
          await host.removeClient({
            name: "cursor",
            format: "json",
            configPath,
          })
        ).status,
      ).toBe("removed");
      expect((await lstat(configPath)).mode & 0o777).toBe(mode);
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        mcpServers: {},
        keep: true,
      });
    } finally {
      await host.close?.();
    }
  },
);
