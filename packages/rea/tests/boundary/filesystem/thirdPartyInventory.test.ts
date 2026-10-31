import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect } from "vitest";

import { processTest as test } from "../../support/process/processFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

test("generates locked inventory and rejects stale notice metadata or preserved texts", async ({
  processes,
}) => {
  const root = await createTestTempDirectory("rea-notice-records-");
  await mkdir(resolve(root, "scripts/lib"), { recursive: true });
  await mkdir(resolve(root, "licenses"));
  for (const file of [
    "scripts/generate-third-party-inventory.mjs",
    "scripts/lib/generated-file.mjs",
  ])
    await copyFile(resolve(file), resolve(root, file));
  const script = resolve(root, "scripts/generate-third-party-inventory.mjs");
  const runtime = {
    version: "1.0.0",
    license: "MIT",
    resolved:
      "https://registry.npmjs.org/fixture-runtime/-/fixture-runtime-1.0.0.tgz",
    integrity: "sha512-fixture-integrity",
    optional: true,
  };
  await writeFile(
    resolve(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "": { name: "fixture", version: "1.0.0" },
        "node_modules/fixture-runtime": runtime,
        "node_modules/fixture-dev": { ...runtime, dev: true, optional: false },
      },
    }),
  );
  const generated = await processes.run(process.execPath, [script]);
  expect(generated.exitCode, generated.stderr).toBe(0);
  const inventory = await readFile(
    resolve(root, "licenses/npm-dependencies.txt"),
    "utf8",
  );
  expect(inventory).toContain("Locked package entries: 2; runtime: 1.");
  expect(inventory).toContain(
    "fixture-runtime@1.0.0 | runtime, optional | MIT",
  );
  expect(inventory).toContain("fixture-dev@1.0.0 | development | MIT");
  const fingerprint = (
    JSON.parse(generated.stdout) as { runtime_dependency_fingerprint: string }
  ).runtime_dependency_fingerprint;
  const notice = [
    `Runtime dependency fingerprint (SHA-256): ${fingerprint}`,
    "",
    "===== fixture-runtime@1.0.0 =====",
    "Declared license: MIT",
    `Archive: ${runtime.resolved}`,
    `Integrity: ${runtime.integrity}`,
    "",
    "Fixture text; this test does not establish real package attribution.",
    "",
  ].join("\n");
  const noticePath = resolve(root, "licenses/npm-runtime-notices.txt");
  const referencePath = resolve(root, "licenses/reference.txt");
  await writeFile(noticePath, notice);
  await writeFile(referencePath, "preserved fixture text\n");
  await writeFile(
    resolve(root, "licenses/upstream-sources.json"),
    JSON.stringify([
      {
        file: "licenses/reference.txt",
        sha256: createHash("sha256")
          .update("preserved fixture text\n")
          .digest("hex"),
      },
    ]),
  );
  const check = () => processes.run(process.execPath, [script, "--check"]);
  const valid = await check();
  expect(valid.exitCode, valid.stderr).toBe(0);
  for (const [changed, diagnostic] of [
    [
      notice.replace(
        "===== fixture-runtime@1.0.0 =====",
        "===== another-package@1.0.0 =====",
      ),
      "Missing runtime notice",
    ],
    [
      notice.replace(runtime.integrity, "sha512-different"),
      "Runtime notice metadata differs",
    ],
    [
      notice.replace(fingerprint, "0".repeat(64)),
      "Runtime notice fingerprint differs",
    ],
    [
      notice + notice.slice(notice.indexOf("===== ")),
      "Duplicate runtime notice",
    ],
  ] as const) {
    await writeFile(noticePath, changed);
    const rejected = await check();
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain(diagnostic);
  }
  await writeFile(noticePath, notice);
  await writeFile(referencePath, "changed fixture text\n");
  const tampered = await check();
  expect(tampered.exitCode).toBe(1);
  expect(tampered.stderr).toContain("Preserved notice digest differs");
  expect(
    await readFile(resolve(root, "licenses/npm-dependencies.txt"), "utf8"),
  ).toBe(inventory);
});
