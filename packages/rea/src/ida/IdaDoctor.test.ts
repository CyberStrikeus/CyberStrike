import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectIdaRegistration } from "./IdaDoctor.js";
import { providerRegistrationEnvironment } from "../application/SetupRegistrationEnvironment.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";

const resourceScope: RetainedResourceScope = {
  retain: () => undefined,
  run: (operation) => operation(),
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it.each([true, false])(
  "uses allocation filesystem resolution without creating entries (traversed directory exists=%s)",
  async (exists) => {
    const root = await mkdtemp(join(tmpdir(), "rea-ida-workspace-parent-"));
    roots.push(root);
    const path = join(root, "registration.json");
    await mkdir(join(root, "existing"));
    const rawRoot = exists ? `${root}/existing/..` : `${root}/missing/..`;
    await writeFile(
      path,
      JSON.stringify({
        command: "python",
        mode: "headless",
        workspaceRoot: rawRoot,
      }),
    );
    const before = (await readdir(root)).sort();
    const inspection = await inspectIdaRegistration(path, resourceScope);
    const after = (await readdir(root)).sort();
    expect(inspection.available).toBe(exists);
    expect(
      inspection.checks.find(({ name }) => name === "private_workspace")
        ?.detail,
    ).toContain(rawRoot);
    expect(after).toEqual(before);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a non-directory intermediate component before canonicalizing readiness",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-ida-workspace-lookup-"));
    roots.push(root);
    const path = join(root, "registration.json");
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(root, "file"), "not a directory");
    const selected = `${root}/file/../workspace`;
    await writeFile(
      path,
      JSON.stringify({
        command: "provider-must-not-launch",
        mode: "headless",
        workspaceRoot: selected,
      }),
    );
    const before = (await readdir(root)).sort();
    const inspection = await inspectIdaRegistration(path, resourceScope);
    expect(inspection.available).toBe(false);
    const check = inspection.checks.find(
      ({ name }) => name === "private_workspace",
    );
    expect(check).toMatchObject({ ok: false, code: "invalid_configuration" });
    expect(check?.detail).toContain(selected);
    expect(check?.detail).toContain("ENOTDIR");
    expect((await readdir(root)).sort()).toEqual(before);
    expect(await readdir(workspace)).toEqual([]);
  },
);

it.skipIf(process.platform === "win32")(
  "marks an unusable system temporary parent unavailable when workspaceRoot is omitted",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-ida-default-parent-"));
    roots.push(root);
    const path = join(root, "registration.json");
    const unusableDefault = join(root, "not-a-directory");
    await writeFile(unusableDefault, "file");
    await writeFile(
      path,
      JSON.stringify({ command: "python", mode: "headless" }),
    );
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = unusableDefault;
    try {
      const inspection = await inspectIdaRegistration(path, resourceScope);
      expect(inspection.available).toBe(false);
      expect(
        inspection.checks.find(({ name }) => name === "private_workspace"),
      ).toMatchObject({
        ok: false,
        code: "invalid_configuration",
      });
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  },
);
it("keeps IDA configuration for setup without copying transport credentials or claiming runtime verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-ida-doctor-"));
  roots.push(root);
  const path = join(root, "registration.json");
  await writeFile(
    path,
    JSON.stringify({
      url: "http://127.0.0.1:12345/mcp",
      headers: { Authorization: "Bearer fixture-secret" },
      mode: "headless",
    }),
  );
  const inspection = await inspectIdaRegistration(path, resourceScope);
  expect(inspection).toMatchObject({
    configured: true,
    available: true,
    providerVersion: null,
  });
  expect(inspection.checks[0]?.detail).toContain("no IDA process was launched");
  expect(providerRegistrationEnvironment([inspection])).toEqual({
    REA_IDA_MCP_CONFIG: path,
  });
  expect(JSON.stringify(inspection)).not.toContain("fixture-secret");
  await writeFile(path, JSON.stringify({ url: "https://example.com/mcp" }));
  expect(await inspectIdaRegistration(path, resourceScope)).toMatchObject({
    available: false,
    registrationEnvironment: {},
  });
  expect(await inspectIdaRegistration(undefined, resourceScope)).toMatchObject({
    configured: false,
    available: false,
  });
});
