import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32").each([
  { name: "cache", relative: false },
  { name: "state", relative: false },
  { name: "cache", relative: true },
  { name: "state", relative: true },
])(
  "finishes purging after $name removes the working directory (relative selection: $relative)",
  async ({ name, relative }) => {
    const home = await createTestTempDirectory("rea-managed-cache-cwd-");
    const cwd = join(home, ".rea", name);
    const cacheRoot = join(home, "cache");
    const cache = join(cacheRoot, "rea", "kuna");
    await mkdir(cwd, { recursive: true });
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "cached"), "owned cache");
    const callerCache = join(home, "caller-cache");
    await mkdir(callerCache);
    await writeFile(join(callerCache, "evidence"), "caller evidence");
    const selected = relative ? "../../caller-cache" : `${cache}/`;
    const moduleUrl = new URL(
      "../../../dist/application/Uninstall.js",
      import.meta.url,
    ).href;
    const result = await execFileOutput(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { systemUninstallHost } from ${JSON.stringify(moduleUrl)};
const [home, cwd, cacheRoot, selected] = process.argv.slice(1);
const host = systemUninstallHost(home, undefined, {
  XDG_CACHE_HOME: cacheRoot, REA_KUNA_CACHE_DIR: selected,
}, "linux");
// Reset Node's cwd cache after module loading, before the real removal.
process.chdir(cwd);
try { console.log(JSON.stringify(await host.purgeData())); }
finally { await host.close?.(); }`,
        home,
        cwd,
        cacheRoot,
        selected,
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024, stopSignal: "SIGTERM" },
    );
    expect(JSON.parse(result.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name, status: "removed" }),
        expect.objectContaining({ name: "kuna", status: "removed" }),
      ]),
    );
    await expect(lstat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(cache)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(callerCache, "evidence"), "utf8")).toBe(
      "caller evidence",
    );
    if (relative)
      expect(JSON.parse(result.stdout)).toContainEqual(
        expect.objectContaining({
          name: "kuna-custom-cache",
          status: "retained",
          detail: expect.stringContaining(selected),
        }),
      );
  },
);

it.each(["darwin", "linux"] as const)(
  "purges producer-owned default cache namespaces on %s and preserves their siblings",
  async (platform) => {
    const home = await createTestTempDirectory("rea-managed-cache-purge-");
    const cache = join(
      home,
      platform === "darwin" ? "Library/Caches" : "xdg-cache",
    );
    const directories = [
      join(home, ".rea", "cache"),
      join(home, ".rea", "state"),
      join(cache, "rea", "kuna"),
      ...(platform === "linux" ? [join(cache, "rea", "hopper-releases")] : []),
    ];
    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "cached"), "REA cache");
    }
    const sibling = join(cache, "rea", "caller-evidence");
    await mkdir(sibling);
    await writeFile(join(sibling, "retained"), "caller evidence");
    const host = systemUninstallHost(
      home,
      undefined,
      { XDG_CACHE_HOME: cache },
      platform,
    );
    try {
      const result = await host.purgeData();
      expect(result.filter(({ status }) => status === "removed")).toHaveLength(
        directories.length,
      );
      for (const directory of directories)
        await expect(readFile(join(directory, "cached"))).rejects.toMatchObject(
          { code: "ENOENT" },
        );
      expect(await readFile(join(sibling, "retained"), "utf8")).toBe(
        "caller evidence",
      );
      expect(
        (await host.purgeData()).every(({ status }) => status === "skipped"),
      ).toBe(true);
    } finally {
      await host.close?.();
    }
  },
);

it("retains an arbitrary caller-selected Kuna cache and refuses a linked managed namespace", async () => {
  const home = await createTestTempDirectory("rea-managed-cache-link-");
  const custom = join(home, "caller-data");
  await mkdir(custom);
  await writeFile(join(custom, "evidence"), "retained");
  const cache = join(home, "cache");
  await mkdir(cache);
  await symlink(custom, join(cache, "rea"), "dir");
  const host = systemUninstallHost(
    home,
    undefined,
    {
      XDG_CACHE_HOME: cache,
      REA_KUNA_CACHE_DIR: custom,
    },
    "linux",
  );
  try {
    expect(await host.purgeData()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "kuna-custom-cache",
          status: "retained",
        }),
        expect.objectContaining({ name: "kuna", status: "retained" }),
        expect.objectContaining({
          name: "hopper-releases",
          status: "retained",
        }),
      ]),
    );
    expect(await readFile(join(custom, "evidence"), "utf8")).toBe("retained");
  } finally {
    await host.close?.();
  }
});

it.each([
  {
    label: "trailing separator",
    spelling: (cache: string) => `${cache}/`,
  },
  {
    label: "dot segment",
    spelling: (cache: string) => `${cache}/.`,
  },
  {
    label: "duplicate separator",
    spelling: (cache: string) =>
      `${cache.slice(0, cache.lastIndexOf("kuna"))}/${"kuna"}`,
  },
])(
  "purges a default Kuna cache selected with a $label",
  async ({ spelling }) => {
    const home = await createTestTempDirectory("rea-managed-cache-spelling-");
    const root = join(home, "Library/Caches");
    const cache = join(root, "rea", "kuna");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "cached"), "REA cache");
    const host = systemUninstallHost(
      home,
      undefined,
      {
        REA_KUNA_CACHE_DIR: spelling(cache),
      },
      "darwin",
    );
    try {
      const result = await host.purgeData();
      expect(result).not.toContainEqual(
        expect.objectContaining({ name: "kuna-custom-cache" }),
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: "kuna", status: "removed" }),
      );
      await expect(readFile(join(cache, "cached"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await host.close?.();
    }
  },
);

it("reports the Hopper producer's invalid cache selection rather than silently falling back", async () => {
  const home = await createTestTempDirectory("rea-managed-cache-invalid-");
  const fallback = join(home, ".cache", "rea", "hopper-releases");
  await mkdir(fallback, { recursive: true });
  await writeFile(join(fallback, "release"), "retained");
  const host = systemUninstallHost(
    home,
    undefined,
    { XDG_CACHE_HOME: "relative" },
    "linux",
  );
  try {
    expect(await host.purgeData()).toContainEqual(
      expect.objectContaining({
        name: "hopper-releases",
        status: "failed",
        detail: expect.stringContaining("absolute"),
      }),
    );
    expect(await readFile(join(fallback, "release"), "utf8")).toBe("retained");
  } finally {
    await host.close?.();
  }
});

it("reports a retained Kuna cache reached through symlink parent traversal", async () => {
  const home = await createTestTempDirectory("rea-managed-cache-parent-");
  const root = join(home, "cache");
  const cache = join(root, "rea", "kuna");
  const external = join(home, "external");
  await mkdir(cache, { recursive: true });
  await mkdir(join(external, "subdir"), { recursive: true });
  await mkdir(join(external, "kuna"));
  await writeFile(join(cache, "cached"), "owned cache");
  await writeFile(join(external, "kuna", "evidence"), "caller evidence");
  await symlink(join(external, "subdir"), join(root, "rea", "alias"), "dir");
  const custom = `${root}/rea/alias/../kuna`;
  const host = systemUninstallHost(
    home,
    undefined,
    { XDG_CACHE_HOME: root, REA_KUNA_CACHE_DIR: custom },
    "linux",
  );
  try {
    const result = await host.purgeData();
    expect(result).toContainEqual(
      expect.objectContaining({
        name: "kuna-custom-cache",
        status: "retained",
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ name: "kuna", status: "removed" }),
    );
    expect(await readFile(join(external, "kuna", "evidence"), "utf8")).toBe(
      "caller evidence",
    );
    await expect(readFile(join(cache, "cached"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await host.close?.();
  }
});
