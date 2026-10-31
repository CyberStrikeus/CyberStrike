import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createPackageWithOptions } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { authorizedElectronFile } from "../../../src/browser/ElectronFileScope.js";

describe("Electron file scope", () => {
  it("accepts dot-prefixed child names beneath a canonical root", async () => {
    const root = await createTestTempDirectory("rea-electron-dot-child-");
    const directory = join(root, "..cache");
    await mkdir(directory);
    const path = join(directory, "index.html");
    await writeFile(path, "allowed");
    expect(await authorizedElectronFile(pathToFileURL(path).href)).toBe(path);
  });

  it("accepts explicit canonical local files and rejects remote or malformed URLs", async () => {
    const base = await createTestTempDirectory("rea-electron-scope-");
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    const allowed = join(root, "index.html");
    const denied = join(outside, "secret.html");
    await writeFile(allowed, "allowed");
    await writeFile(denied, "denied");
    await symlink(denied, join(root, "escape.html"));
    expect(await authorizedElectronFile(pathToFileURL(allowed).href)).toBe(
      allowed,
    );
    expect(await authorizedElectronFile(pathToFileURL(denied).href)).toBe(
      denied,
    );
    expect(
      await authorizedElectronFile(
        pathToFileURL(join(root, "escape.html")).href,
      ),
    ).toBe(denied);
    expect(
      await authorizedElectronFile("file://server/share/index.html"),
    ).toBeUndefined();
    expect(
      await authorizedElectronFile("file:///tmp/root%2Findex.html"),
    ).toBeUndefined();
  });

  it("resolves regular files Electron serves from inside an ASAR archive", async () => {
    const root = await createTestTempDirectory("rea-electron-asar-scope-");
    const source = join(root, "source");
    await mkdir(join(source, "build", "static"), { recursive: true });
    await mkdir(join(source, "native"));
    await writeFile(join(source, "build", "index.html"), "<p>packed</p>");
    await writeFile(join(source, "build", "static", "app.js"), "app();");
    await writeFile(join(source, "native", "addon.node"), "native");
    await writeFile(join(source, "notes.txt"), "plain");
    const archive = join(root, "app.asar");
    await createPackageWithOptions(source, archive, { unpack: "*.node" });
    const canonical = await realpath(archive);
    const member = (...parts: string[]) =>
      pathToFileURL(join(archive, ...parts)).href;

    expect(await authorizedElectronFile(member("build", "index.html"))).toBe(
      join(canonical, "build", "index.html"),
    );
    expect(
      await authorizedElectronFile(
        `${member("build", "static", "app.js")}?isBookDoubleClicked=0#/library`,
      ),
    ).toBe(join(canonical, "build", "static", "app.js"));
    expect(await authorizedElectronFile(member("native", "addon.node"))).toBe(
      join(canonical, "native", "addon.node"),
    );
    expect(await authorizedElectronFile(member("build"))).toBeUndefined();
    expect(
      await authorizedElectronFile(member("build", "missing.html")),
    ).toBeUndefined();
    expect(
      await authorizedElectronFile(
        pathToFileURL(join(source, "notes.txt", "index.html")).href,
      ),
    ).toBeUndefined();
  });

  it("accepts file URLs with long query text", async () => {
    const root = await createTestTempDirectory("rea-electron-long-url-");
    const path = join(root, "index.html");
    await writeFile(path, "allowed");
    const value = `${pathToFileURL(path).href}?${"x".repeat(70_000)}`;

    await expect(authorizedElectronFile(value)).resolves.toBe(path);
  });

  it("resolves an archive beneath an ASAR-named directory and rejects oversized declared headers", async () => {
    const root = await createTestTempDirectory("rea-electron-header-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "index.html"), "page");
    const parent = join(root, "parent.asar");
    await mkdir(parent);
    const archive = join(parent, "app.asar");
    await createPackageWithOptions(source, archive, {});
    expect(
      await authorizedElectronFile(
        pathToFileURL(join(archive, "index.html")).href,
      ),
    ).toBe(join(await realpath(archive), "index.html"));
    const malformed = join(root, "bad.asar");
    const header = Buffer.alloc(16);
    header.writeUInt32LE(4, 0);
    header.writeUInt32LE(0x40000000, 4);
    await writeFile(malformed, header);
    expect(
      await authorizedElectronFile(
        pathToFileURL(join(malformed, "index.html")).href,
      ),
    ).toBeUndefined();
  });
  it("authorizes ASAR members only under the provider's selected header admission", async () => {
    const root = await createTestTempDirectory("rea-electron-admission-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "index.html"), "page");
    const archive = join(root, "app.asar");
    await createPackageWithOptions(source, archive, {});
    const headerBytes = (await readFile(archive)).readUInt32LE(4);
    const page = pathToFileURL(join(archive, "index.html")).href;
    const admission = (maximumBytes: number) =>
      ({ maximumBytes, source: "setting" }) as const;
    // The first read caches the header under an admission that fits it.
    expect(
      await authorizedElectronFile(
        page,
        undefined,
        "inspect_electron_page",
        admission(headerBytes),
      ),
    ).toBe(join(await realpath(archive), "index.html"));
    // A provider with a lower admission must not reuse that cached header.
    expect(
      await authorizedElectronFile(
        page,
        undefined,
        "inspect_electron_page",
        admission(headerBytes - 1),
      ),
    ).toBeUndefined();
  });
});

it("keeps encoded query and fragment separators outside filesystem admission", async () => {
  const root = await createTestTempDirectory("rea-electron-url-components-");
  const path = join(root, "index.html");
  await writeFile(path, "allowed");
  const base = pathToFileURL(path).href;
  for (const suffix of [
    "",
    "?next=/settings",
    "#/settings",
    "?next=%2Fsettings",
    "?next=%5Csettings",
    "#%2Fsettings",
    "#%5Csettings",
  ])
    await expect(authorizedElectronFile(`${base}${suffix}`)).resolves.toBe(
      path,
    );
  for (const encoded of ["%2F", "%5C"])
    await expect(
      authorizedElectronFile(`${pathToFileURL(root).href}${encoded}index.html`),
    ).resolves.toBeUndefined();
});

it("refreshes ASAR member admission after a same-size rewrite preserving modification time", async () => {
  const root = await createTestTempDirectory("rea-electron-asar-rewrite-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "old.html"), "page");
  const archive = join(root, "app.asar");
  await createPackageWithOptions(source, archive, {});
  const timestamp = new Date("2024-01-01T00:00:00Z");
  await utimes(archive, timestamp, timestamp);
  const before = await stat(archive);
  const oldPage = pathToFileURL(join(archive, "old.html")).href;
  const newPage = pathToFileURL(join(archive, "new.html")).href;
  expect(await authorizedElectronFile(oldPage)).toBe(
    join(await realpath(archive), "old.html"),
  );
  expect(await authorizedElectronFile(newPage)).toBeUndefined();

  await rename(join(source, "old.html"), join(source, "new.html"));
  const replacement = join(root, "replacement.asar");
  await createPackageWithOptions(source, replacement, {});
  await writeFile(archive, await readFile(replacement));
  await utimes(archive, before.atime, before.mtime);
  const after = await stat(archive);
  expect({
    dev: after.dev,
    ino: after.ino,
    size: after.size,
    mtime: after.mtimeMs,
  }).toEqual({
    dev: before.dev,
    ino: before.ino,
    size: before.size,
    mtime: before.mtimeMs,
  });
  expect(after.ctimeMs).not.toBe(before.ctimeMs);

  expect(await authorizedElectronFile(oldPage)).toBeUndefined();
  expect(await authorizedElectronFile(newPage)).toBe(
    join(await realpath(archive), "new.html"),
  );
});
