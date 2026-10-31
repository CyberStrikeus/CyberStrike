import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import {
  createPackageVerifierCommands,
  type PackageVerifierCommands,
} from "../../../scripts/lib/verify-package-commands.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { verifyPackedBridge } from "../../../scripts/verify-packed-bridge.mjs";
import {
  PrivateRuntimeRoot,
  privateRuntimeRootCapability,
} from "../../../src/process/PrivateRuntimeRoot.js";
import { GHIDRA_BRIDGE_SOURCES } from "../../../src/ghidra/GhidraBridgeSources.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const exec = promisify(execFile);
const packedFiles = [
  "package/bridge/hopper_bridge.py",
  "package/bridge/cutter/rea_bridge.py",
  ...Object.values(GHIDRA_BRIDGE_SOURCES).map(
    (name) => `package/bridge/ghidra/${name}`,
  ),
];
const hopper = packedFiles[0]!;
const validSource =
  '# Unicode source: 雨\nraise RuntimeError("Packed source must never execute")\n';

const expectedPythonCommandFailure = (diagnostic: string | RegExp) => ({
  name: "VerifierCommandExitError",
  code: 1,
  snapshot: {
    stderr: {
      text:
        typeof diagnostic === "string"
          ? expect.stringContaining(diagnostic)
          : expect.stringMatching(diagnostic),
    },
  },
});

async function fixture(source: string = validSource, omitHopper = false) {
  const scratch = await createTestWorkspace("rea-packed-bridge-");
  const directory = scratch.root;
  let commands: PackageVerifierCommands | undefined;
  onTestFinished(() =>
    commands === undefined ? removeTestWorkspace(directory) : commands.close(),
  );
  commands = await createPackageVerifierCommands({
    workspace: { path: directory, close: () => removeTestWorkspace(directory) },
  });
  const staging = join(directory, "source");
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  for (const member of packedFiles) {
    if (omitHopper && member === hopper) continue;
    const path = join(staging, member);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, member === hopper ? source : "fixture\n");
  }
  const tarball = join(directory, "packed bridges.tgz");
  await exec("tar", ["-czf", tarball, "-C", staging, "package"]);
  return { workspace, tarball, packedFiles, commands };
}

it("parses packed Python without executing it or extracting archive members", async () => {
  const input = await fixture();
  const sentinel = join(input.workspace, "caller-owned.txt");
  await writeFile(sentinel, "preserved\n");
  await verifyPackedBridge(input);
  expect(await readdir(input.workspace)).toEqual(["caller-owned.txt"]);
  expect(await readFile(sentinel, "utf8")).toBe("preserved\n");
});

it.each(["cwd", "pythonpath", "sitecustomize"] as const)(
  "rejects invalid packed Python without importing ambient %s code",
  async (kind) => {
    const input = await fixture("def broken(:\n");
    const modules = join(input.workspace, "local modules");
    await mkdir(modules);
    const marker = join(input.workspace, "ambient-import-executed.txt");
    const moduleSource = [
      "import os",
      "from pathlib import Path",
      "Path(os.environ['REA_PACKED_IMPORT_MARKER']).write_text('executed')",
      ...(kind === "sitecustomize"
        ? ["import ast", "ast.parse = lambda *args, **kwargs: None"]
        : ["def parse(*args, **kwargs): return None"]),
    ].join("\n");
    await writeFile(
      join(modules, kind === "sitecustomize" ? "sitecustomize.py" : "ast.py"),
      moduleSource,
    );
    const verifier = new URL(
      "../../../scripts/verify-packed-bridge.mjs",
      import.meta.url,
    ).href;
    // A separate Node process owns cwd/environment changes; the Vitest worker
    // and its other subprocess fixtures retain their original environment.
    const result = await exec(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { verifyPackedBridge } from ${JSON.stringify(verifier)};
import { createPackageVerifierCommands } from ${JSON.stringify(new URL("../../../scripts/lib/verify-package-commands.mjs", import.meta.url).href)};
import { withVerifierCleanup } from ${JSON.stringify(new URL("../../../scripts/lib/verifier-cleanup.mjs", import.meta.url).href)};
import { PrivateRuntimeRoot } from ${JSON.stringify(new URL("../../../dist/process/PrivateRuntimeRoot.js", import.meta.url).href)};
const root = await PrivateRuntimeRoot.create({ prefix: "rea-packed-python-command-" });
let commands;
await withVerifierCleanup(async () => {
commands = await createPackageVerifierCommands({ workspace: root });
try {
  await verifyPackedBridge({ ...JSON.parse(process.env.REA_PACKED_VERIFY_INPUT), commands });
  console.log(JSON.stringify({ accepted: true }));
} catch (error) {
  console.log(JSON.stringify({ accepted: false, name: error.name, code: error.code, stderr: error.snapshot?.stderr?.text }));
}
}, [() => commands === undefined ? root.close() : commands.close()]);`,
      ],
      {
        cwd: kind === "cwd" ? modules : input.workspace,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => name.toLowerCase() !== "pythonpath",
            ),
          ),
          PYTHONPATH: kind === "cwd" ? "" : modules,
          REA_PACKED_IMPORT_MARKER: marker,
          REA_PACKED_VERIFY_INPUT: JSON.stringify({
            tarball: input.tarball,
            packedFiles: input.packedFiles,
          }),
        },
      },
    );
    const observation = z
      .object({
        accepted: z.boolean(),
        name: z.string().optional(),
        code: z.number().optional(),
        stderr: z.string().optional(),
      })
      .parse(JSON.parse(result.stdout));
    expect(observation).toMatchObject({
      accepted: false,
      name: "VerifierCommandExitError",
      code: 1,
      stderr: expect.stringContaining("SyntaxError"),
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(packedFiles)(
  "rejects an unadvertised required member: %s",
  async (member) => {
    const input = await fixture();
    await expect(
      verifyPackedBridge({
        ...input,
        packedFiles: packedFiles.filter((path) => path !== member),
      }),
    ).rejects.toThrow(`package omitted ${member}`);
    expect(await readdir(input.workspace)).toEqual([]);
  },
);

it("rejects a missing actual Python member even when the listing advertises it", async () => {
  const input = await fixture(validSource, true);
  await expect(verifyPackedBridge(input)).rejects.toMatchObject(
    expectedPythonCommandFailure(hopper),
  );
  expect(await readdir(input.workspace)).toEqual([]);
});

it("reports invalid packed Python syntax with the member filename", async () => {
  const input = await fixture("def broken(:\n");
  await expect(verifyPackedBridge(input)).rejects.toMatchObject(
    expectedPythonCommandFailure(/hopper_bridge\.py[\s\S]*SyntaxError/u),
  );
  expect(await readdir(input.workspace)).toEqual([]);
});

it.each(["valid", "invalid"] as const)(
  "parses %s source under an owned private root and preserves owner cleanup",
  async (kind) => {
    expect(privateRuntimeRootCapability().available).toBe(true);
    const input = await fixture(
      kind === "valid" ? validSource : "def broken(:\n",
    );
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-packed-bridge-lease-",
    });
    let commands: PackageVerifierCommands | undefined;
    await withVerifierCleanup(async () => {
      commands = await createPackageVerifierCommands({ workspace: root });
      const pack = join(root.path, "pack");
      await mkdir(pack);
      const tarball = join(pack, "packed bridges.tgz");
      await copyFile(input.tarball, tarball);
      const parsed = verifyPackedBridge({ tarball, packedFiles, commands });
      if (kind === "valid") await parsed;
      else
        await expect(parsed).rejects.toMatchObject(
          expectedPythonCommandFailure("SyntaxError"),
        );
      expect(await readdir(root.path)).toEqual(["pack"]);
      expect(
        Buffer.compare(await readFile(tarball), await readFile(input.tarball)),
      ).toBe(0);
    }, [() => (commands === undefined ? root.close() : commands.close())]);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["symlink", "hardlink", "directory"])(
  "rejects a %s Python member without following it or extracting files",
  async (kind) => {
    const input = await fixture();
    await exec("python3", [
      "-I",
      "-S",
      "-c",
      [
        "import io, sys, tarfile",
        "with tarfile.open(sys.argv[1], 'w:gz') as archive:",
        "    target = tarfile.TarInfo('package/bridge/target.py')",
        "    target.size = 5",
        "    archive.addfile(target, io.BytesIO(b'pass\\n'))",
        "    member = tarfile.TarInfo(sys.argv[2])",
        "    member.type = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE, 'directory': tarfile.DIRTYPE}[sys.argv[3]]",
        "    member.linkname = 'target.py' if sys.argv[3] == 'symlink' else target.name",
        "    archive.addfile(member)",
      ].join("\n"),
      input.tarball,
      hopper,
      kind,
    ]);
    await expect(verifyPackedBridge(input)).rejects.toMatchObject(
      expectedPythonCommandFailure(`${hopper} is not a regular file`),
    );
    expect(await readdir(input.workspace)).toEqual([]);
  },
);

it("rejects malformed archives without writing to the caller's workspace", async () => {
  const input = await fixture();
  await writeFile(input.tarball, "not a tar archive\n");
  await expect(verifyPackedBridge(input)).rejects.toMatchObject(
    expectedPythonCommandFailure("ReadError"),
  );
  expect(await readdir(input.workspace)).toEqual([]);
});
