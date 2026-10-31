import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Requires a running Docker daemon, network access for the pinned fixture
// producer, and `npm run build:cached`. Never executes the injected application.
const root = await mkdtemp(join(tmpdir(), "rea-node-sea-real-"));
const image = "node:24.10.0-bookworm";
const script =
  'throw new Error("SEA verification must not execute this application");\n';
try {
  await writeFile(join(root, "main.js"), script);
  await writeFile(join(root, "asset.txt"), "real SEA asset\n");
  await writeFile(
    join(root, "sea.json"),
    JSON.stringify({
      main: "main.js",
      output: "sea.blob",
      disableExperimentalSEAWarning: true,
      useCodeCache: true,
      assets: { "data/asset.txt": "asset.txt" },
    }),
  );
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      `${root}:/fixture`,
      "--workdir",
      "/fixture",
      image,
      "sh",
      "-ec",
      "node --experimental-sea-config sea.json; cp /usr/local/bin/node application; npx --yes postject@1.0.0-alpha.6 application NODE_SEA_BLOB sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    { stdio: "inherit", timeout: 300_000 },
  );
  const cli = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [resolve("scripts/rea.mjs"), ...args, "--json"],
        {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
        },
      ),
    );
  const input = join(root, "application");
  const inspected = cli("inspect-artifact", input);
  const graph =
    inspected.normalized_result.substeps[0].evidence.normalized_result;
  assert.equal(graph.manifest.root_format, "node-sea");
  const metadata = graph.occurrences.find(
    (row) => row.logical_path === ".",
  ).format_metadata;
  assert.equal(metadata.fuse_state, "set");
  assert.equal(metadata.use_code_cache, true);
  assert.equal(metadata.include_assets, true);
  const extracted = cli("extract-artifact", input).normalized_result;
  assert.equal(extracted.containment_verified, true);
  assert.equal(
    await readFile(join(extracted.output_root, "main.js"), "utf8"),
    script,
  );
  assert.equal(
    await readFile(join(extracted.output_root, "data/asset.txt"), "utf8"),
    "real SEA asset\n",
  );
  process.stdout.write(
    `${JSON.stringify({ producer: image, metadata, verified: ["ELF inventory", "code cache", "fuse", "script extraction", "asset extraction"] }, null, 2)}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
