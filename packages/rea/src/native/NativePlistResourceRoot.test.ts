import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";
import { resolveBundleResourcePlistSelection } from "./NativePlistSource.js";
import { NativeFixtureRunner } from "../../tests/fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";

it("inspects a resolved app plist without executable identity", async () => {
  const bundle = await createTestTempDirectory("rea-plist-resource-root-");
  const infoPlist = join(bundle, "Info.plist");
  await writeFile(infoPlist, '<?xml version="1.0"?><plist><dict/></plist>');
  const root = {
    callerPath: bundle,
    canonicalPath: bundle,
    infoPlistPath: infoPlist,
    layout: "root" as const,
    executableSha256: null,
  };
  expect(resolveBundleResourcePlistSelection(root, undefined)).toEqual({
    ok: true,
    value: { path: infoPlist, origin: "default" },
  });
  expect(resolveBundleResourcePlistSelection(root, "Info.plist")).toEqual({
    ok: true,
    value: { path: infoPlist, origin: "selected" },
  });
  const client = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createBundleResourceClient(root);
  onTestFinished(async () => {
    await client.close();
  });
  const inspected = await client.execute("inspect_plist", {});
  expect(inspected.ok).toBe(true);
  if (inspected.ok)
    expect(inspected.value.result).toMatchObject({
      source_path: infoPlist,
      resource_root: {
        canonical_path: bundle,
        executable_sha256: null,
      },
    });
});

it.skipIf(process.platform === "win32")(
  "preserves physical selected plist paths in resource-only roots",
  async () => {
    const bundle = await createTestTempDirectory("rea-plist-resource-path-");
    const physical = join(bundle, "physical");
    await mkdir(join(physical, "child"), { recursive: true });
    await writeFile(join(bundle, "Info.plist"), "lexical decoy");
    await writeFile(join(physical, "Info.plist"), "selected source");
    await symlink(join(physical, "child"), join(bundle, "alias"));
    const root = {
      callerPath: bundle,
      canonicalPath: bundle,
      infoPlistPath: join(bundle, "Info.plist"),
      layout: "root" as const,
      executableSha256: null,
    };
    for (const requested of [
      "alias/../Info.plist",
      `${bundle}/alias/../Info.plist`,
      "physical/Info.plist",
    ]) {
      const selected = resolveBundleResourcePlistSelection(root, requested);
      if (!selected.ok) throw selected.error;
      expect(selected.value.origin).toBe("selected");
      expect(await readFile(selected.value.path, "utf8")).toBe(
        "selected source",
      );
    }
    const directory = resolveBundleResourcePlistSelection(root, "Info.plist/");
    if (!directory.ok) throw directory.error;
    await expect(readFile(directory.value.path)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  },
);
