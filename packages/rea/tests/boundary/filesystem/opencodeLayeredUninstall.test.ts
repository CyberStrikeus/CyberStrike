import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { effectiveClientConfiguration } from "../../../src/application/ClientConfigurationFiles.js";
import { parseClientConfiguration } from "../../../src/application/ClientConfigurationDocument.js";

it.each(["native", "legacy"])(
  "retains an owned %s lower layer when a foreign upper layer inherits its fields",
  async (dialect) => {
    const home = await createTestTempDirectory("rea-opencode-layered-foreign-");
    const directory = join(home, ".config/opencode");
    await mkdir(directory, { recursive: true });
    const lower = join(directory, "opencode.json");
    const upper = join(directory, "opencode.jsonc");
    const owned = JSON.stringify(
      dialect === "native"
        ? {
            mcp: {
              servers: {
                rea: {
                  type: "local",
                  command: ["rea", "mcp"],
                  disabled: false,
                },
              },
            },
          }
        : {
            mcp: {
              servers: {},
              rea: { type: "local", command: ["rea", "mcp"], enabled: true },
            },
          },
    );
    const partial = JSON.stringify({
      mcp: { servers: { rea: { command: ["/usr/bin/false"] } } },
    });
    await writeFile(lower, owned);
    await writeFile(upper, partial);
    const effective = async () =>
      effectiveClientConfiguration(
        await Promise.all(
          [lower, upper].map(async (sourcePath) => ({
            ...parseClientConfiguration(
              await readFile(sourcePath, "utf8"),
              "opencode",
            ),
            sourcePath,
          })),
        ),
      )?.servers.rea;
    const before = await effective();
    expect(before).toMatchObject({
      type: "local",
      command: ["/usr/bin/false"],
      disabled: false,
    });
    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, {
        XDG_CONFIG_HOME: join(home, ".config"),
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "opencode",
        status: "failed",
        detail: expect.stringContaining("change an unowned"),
      }),
    );
    expect(await readFile(lower, "utf8")).toBe(owned);
    expect(await readFile(upper, "utf8")).toBe(partial);
    expect(await effective()).toEqual(before);
  },
);

it("preflights a foreign legacy registration across OpenCode layers before removal", async () => {
  const home = await createTestTempDirectory("rea-opencode-layered-uninstall-");
  const directory = join(home, ".config/opencode");
  await mkdir(directory, { recursive: true });
  const lower = join(directory, "opencode.json");
  const upper = join(directory, "opencode.jsonc");
  const legacy = JSON.stringify({
    mcp: { rea: { type: "local", command: ["/usr/bin/false"], enabled: true } },
  });
  const native = JSON.stringify({
    mcp: {
      servers: {
        rea: { type: "local", command: ["rea", "mcp"], disabled: false },
      },
    },
  });
  await writeFile(lower, legacy);
  await writeFile(upper, native);
  const environment = { XDG_CONFIG_HOME: join(home, ".config") };
  const blocked = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(blocked.status).toBe("failed");
  expect(blocked.items).toContainEqual(
    expect.objectContaining({
      name: "opencode",
      status: "failed",
      detail: expect.stringContaining("V1"),
    }),
  );
  expect(await readFile(lower, "utf8")).toBe(legacy);
  expect(await readFile(upper, "utf8")).toBe(native);
  await expect(access(`${lower}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(`${upper}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });

  await writeFile(lower, "{}\n");
  const removed = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(removed.status).toBe("complete");
  expect(removed.items).toContainEqual(
    expect.objectContaining({ name: "opencode", status: "removed" }),
  );
  expect(await readFile(upper, "utf8")).not.toContain('"rea"');

  // Removing a shadowed owned registration does not activate a registration
  // that was already selected from a later layer.
  await writeFile(lower, native);
  const foreignNative = JSON.stringify({
    mcp: {
      servers: {
        rea: { type: "local", command: ["/usr/bin/false"], disabled: false },
      },
    },
  });
  await writeFile(upper, foreignNative);
  const alreadyForeign = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(alreadyForeign.status).toBe("complete");
  expect(await readFile(lower, "utf8")).not.toContain('"rea"');
  expect(await readFile(upper, "utf8")).toBe(foreignNative);

  // The same control applies when the shadowed owned row uses V1 syntax.
  await writeFile(
    lower,
    JSON.stringify({
      mcp: {
        servers: {},
        rea: { type: "local", command: ["rea", "mcp"], enabled: true },
      },
    }),
  );
  const legacyAlreadyForeign = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(legacyAlreadyForeign.status).toBe("complete");
  expect(await readFile(lower, "utf8")).not.toContain('"rea"');
  expect(await readFile(upper, "utf8")).toBe(foreignNative);
});
