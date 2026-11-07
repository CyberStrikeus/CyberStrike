import { appendFile, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { withOwnedRegularFile } from "../../filesystem/OwnedRegularFile.js";
import { ArtifactEmbeddedFormatProbes } from "../ArtifactEmbeddedFormatProbes.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { inventoryArtifact } from "../inventory/ArtifactInventory.js";
import { classifyAndHashRootForInventory } from "../inventory/classify.js";
import { PyInstallerArtifactReader } from "../PyInstallerArtifactReader.js";
import { cArchiveExecutable } from "./CArchive.fixture.js";
import * as layout from "./CArchiveLayout.js";

const fixture = () =>
  cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 314,
    pythonLibrary: "libpython3.14.so",
    members: [
      {
        name: "payload",
        typeCode: "x",
        payload: Buffer.from("fixture"),
        compress: false,
      },
    ],
  });

it.each([
  {
    carrier: "elf",
    offset: undefined,
    dialect: "posix",
    path: String.raw`pkg\data.bin`,
  },
  { carrier: "pe", offset: 64, dialect: "windows", path: "pkg/data.bin" },
  { carrier: "pe", offset: 8190, dialect: "windows", path: "pkg/data.bin" },
] as const)(
  "retains $carrier carrier dialect at offset $offset through member projection",
  async ({ carrier, offset, dialect, path: memberPath }) => {
    const root = await createTestTempDirectory(
      "rea-pyinstaller-carrier-admission-",
    );
    const path = join(root, "app");
    const sourceName = String.raw`pkg\data.bin`;
    await writeFile(
      path,
      cArchiveExecutable({
        carrier,
        ...(offset === undefined ? {} : { peHeaderOffset: offset }),
        layout: "2.1",
        pythonVersion: 314,
        members: [
          {
            name: sourceName,
            typeCode: "x",
            payload: Buffer.from("fixture"),
            compress: false,
          },
        ],
      }),
    );
    const resourceScope = new ArtifactResourceScope();
    try {
      const classified = await classifyAndHashRootForInventory(
        path,
        false,
        await lstat(path),
        { resourceScope },
      );
      const admission = classified.readerAdmission;
      if (
        admission === undefined ||
        !("kind" in admission) ||
        admission.kind !== "pyinstaller"
      )
        throw new Error("Fixture did not produce a PyInstaller admission");
      expect(admission.carrierPathDialect).toBe(dialect);
      const reader = new PyInstallerArtifactReader(path, admission);
      try {
        if (classified.digest === null)
          throw new Error("Missing carrier digest");
        await reader.prepareContainer(classified.digest.sha256);
        const entries = [];
        for await (const entry of reader.entries()) entries.push(entry);
        expect(entries).toEqual([
          expect.objectContaining({
            path: memberPath,
            formatMetadata: expect.objectContaining({
              source_name: sourceName,
            }),
          }),
        ]);
      } finally {
        await reader.close();
      }
    } finally {
      await resourceScope.close();
    }
  },
);

it("preserves backslashes when a standalone archive has no recognized carrier", async () => {
  const root = await createTestTempDirectory(
    "rea-pyinstaller-unknown-carrier-",
  );
  const path = join(root, "app");
  const sourceName = String.raw`pkg\data.bin`;
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 314,
    members: [
      {
        name: sourceName,
        typeCode: "x",
        payload: Buffer.from("fixture"),
        compress: false,
      },
    ],
  });
  bytes.fill(0, 0, 64);
  await writeFile(path, bytes);
  const reader = new PyInstallerArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries.map((entry) => entry.path)).toEqual([sourceName]);
  } finally {
    await reader.close();
  }
});

it("inventories members using the cookie discovered by root classification", async () => {
  const root = await createTestTempDirectory(
    "rea-pyinstaller-cookie-inventory-",
  );
  const path = join(root, "app");
  await writeFile(path, fixture());
  const locate = vi.spyOn(layout, "observePyInstallerCookie");
  const resourceScope = new ArtifactResourceScope();
  try {
    const result = await inventoryArtifact(path, {
      environment: {},
      resourceScope,
    });
    expect(result.manifest.root_format).toBe("pyinstaller");
    expect(
      result.occurrences.some(
        (entry) =>
          entry.logical_path === "payload" && entry.hash_status === "verified",
      ),
    ).toBe(true);
    expect(locate).toHaveBeenCalledTimes(1);
  } finally {
    await resourceScope.close();
    locate.mockRestore();
  }
});

it("rejects changed source before consuming an admitted cookie and leaves the borrowed descriptor open", async () => {
  const root = await createTestTempDirectory("rea-pyinstaller-cookie-change-");
  const path = join(root, "app");
  await writeFile(path, fixture());
  await withOwnedRegularFile(path, {}, async (source) => {
    const cookie = await new ArtifactEmbeddedFormatProbes(
      path,
      source,
    ).pyInstaller();
    if (cookie === undefined) throw new Error("Fixture cookie was not found");
    const reader = new PyInstallerArtifactReader(path, {
      kind: "pyinstaller",
      source,
      cookie,
      carrierPathDialect: "posix",
    });
    await appendFile(path, "changed");
    try {
      await expect(
        (async () => {
          for await (const entry of reader.entries())
            throw new Error(`Changed source exposed member ${entry.path}`);
        })(),
      ).rejects.toMatchObject({ reason: "integrity" });
    } finally {
      await reader.close();
    }
    await expect(source.handle.stat()).resolves.toMatchObject({
      size: fixture().length + 7,
    });
  });
});

it("retains completed cookie facts across unchanged admissions and honors cached cancellation", async () => {
  const root = await createTestTempDirectory("rea-pyinstaller-cookie-cache-");
  const path = join(root, "app");
  await writeFile(path, fixture());
  const locate = vi.spyOn(layout, "observePyInstallerCookie");
  try {
    await withOwnedRegularFile(path, {}, async (source) => {
      const controller = new AbortController();
      const probes = new ArtifactEmbeddedFormatProbes(
        path,
        source,
        controller.signal,
      );
      const cookie = await probes.pyInstaller();
      expect(cookie).toMatchObject({ layout: "2.1", pythonVersion: 314 });
      const resumed = new ArtifactEmbeddedFormatProbes(
        path,
        source,
        controller.signal,
        probes.completedFacts(),
      );
      await expect(resumed.pyInstaller()).resolves.toBe(cookie);
      controller.abort(new Error("cancel cached cookie"));
      await expect(resumed.pyInstaller()).rejects.toMatchObject({
        reason: "cancelled",
      });
      expect(locate).toHaveBeenCalledTimes(1);
    });
  } finally {
    locate.mockRestore();
  }
});

it("retains rejected magic candidates without classifying their native carrier as PyInstaller", async () => {
  const root = await createTestTempDirectory("rea-pyinstaller-candidate-");
  const path = join(root, "app");
  await writeFile(
    path,
    Buffer.concat([
      fixture().subarray(0, 64),
      layout.PYINSTALLER_COOKIE_MAGIC,
      Buffer.alloc(88),
    ]),
  );
  await withOwnedRegularFile(path, {}, async (source) => {
    const probes = new ArtifactEmbeddedFormatProbes(path, source);
    await expect(probes.pyInstaller()).resolves.toBeUndefined();
    const observed = probes.completedFacts().pyInstaller;
    expect(observed).toMatchObject({
      state: "rejected-candidates",
      failure: { reason: "format" },
    });
    const resumed = new ArtifactEmbeddedFormatProbes(
      path,
      source,
      undefined,
      probes.completedFacts(),
    );
    await expect(resumed.pyInstaller()).resolves.toBeUndefined();
    expect(resumed.completedFacts().pyInstaller).toBe(observed);
  });
  const resourceScope = new ArtifactResourceScope();
  try {
    const result = await inventoryArtifact(path, {
      environment: {},
      resourceScope,
    });
    expect(result.manifest.root_format).toBe("elf");
  } finally {
    await resourceScope.close();
  }
});

it("continues past an invalid trailing magic copy to inventory the valid cookie", async () => {
  const root = await createTestTempDirectory(
    "rea-pyinstaller-candidate-valid-",
  );
  const path = join(root, "app");
  await writeFile(
    path,
    Buffer.concat([
      fixture(),
      layout.PYINSTALLER_COOKIE_MAGIC,
      Buffer.alloc(88),
    ]),
  );
  const resourceScope = new ArtifactResourceScope();
  try {
    const result = await inventoryArtifact(path, {
      environment: {},
      resourceScope,
    });
    expect(result.manifest.root_format).toBe("pyinstaller");
    expect(result.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "payload",
        hash_status: "verified",
      }),
    );
  } finally {
    await resourceScope.close();
  }
});

it("does not cache an incomplete tail read as an absent cookie and can retry", async () => {
  const root = await createTestTempDirectory("rea-pyinstaller-tail-short-");
  const path = join(root, "app");
  await writeFile(path, fixture());
  await withOwnedRegularFile(path, {}, async (source) => {
    const probes = new ArtifactEmbeddedFormatProbes(path, source);
    const read = source.handle.read.bind(source.handle);
    let calls = 0;
    const short = vi
      .spyOn(source.handle, "read")
      .mockImplementation((...args: unknown[]) => {
        calls += 1;
        if (calls > 1)
          return Promise.resolve({ bytesRead: 0, buffer: args[0] });
        args[2] = 3;
        return Reflect.apply(read, source.handle, args);
      });
    try {
      await expect(probes.pyInstaller()).rejects.toMatchObject({
        reason: "format",
        message: "CArchive tail is truncated",
      });
      expect(calls).toBe(2);
      expect(Object.hasOwn(probes.completedFacts(), "pyInstaller")).toBe(false);
    } finally {
      short.mockRestore();
    }
    await expect(probes.pyInstaller()).resolves.toMatchObject({
      layout: "2.1",
    });
    expect(probes.completedFacts().pyInstaller?.state).toBe("located");
  });
});
