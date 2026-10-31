#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNativeAotFixture,
  nativeAotCommandError,
  supportsNativeAotFixtureHost,
} from "./lib/nativeaot-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!supportsNativeAotFixtureHost(process.platform, process.arch))
  throw new Error(
    "NativeAOT fixture lane requires Linux or Windows x64; it does not cross-compile NativeAOT.",
  );
const runtime = process.platform === "win32" ? "win-x64" : "linux-x64";
const directory = resolve(
  process.env.REA_NATIVEAOT_FIXTURE_ROOT ??
    join(root, "_reference/nativeaot-integration/generated"),
);
const output = join(directory, runtime);
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  DOTNET_CLI_HOME: join(output, "cli-home"),
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
  DOTNET_PROCESSOR_COUNT: "1",
  COMPlus_GCHeapHardLimit: "30000000",
  NUGET_PACKAGES: process.env.NUGET_PACKAGES ?? join(directory, "nuget"),
};
await writeFile(
  join(output, "global.json"),
  JSON.stringify({ sdk: { version: "8.0.416", rollForward: "disable" } }) +
    "\n",
);
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: output,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw nativeAotCommandError(command, args[0], result);
  return result.stdout;
};
const dotnet = process.env.REA_NATIVEAOT_DOTNET ?? "dotnet";
if (run(dotnet, ["--version"]).trim() !== "8.0.416")
  throw new Error(
    "NativeAOT fixtures require existing .NET SDK 8.0.416; REA does not install SDKs.",
  );
if (process.platform === "linux") {
  run(process.env.REA_NATIVEAOT_STRIP ?? "strip", ["--version"]);
  run(process.env.REA_NATIVEAOT_NM ?? "nm", ["--version"]);
  run(process.env.REA_NATIVEAOT_CC ?? "cc", ["--version"]);
  run("clang", ["--version"]);
}
const map = join(output, "NativeAotFixture.map");
await buildNativeAotFixture(run, {
  dotnet,
  project: join(root, "tests/fixtures/nativeaot/NativeAotFixture.csproj"),
  runtime,
  output,
});
const name =
  process.platform === "win32" ? "NativeAotFixture.exe" : "NativeAotFixture";
const binary = join(output, "symbols", name);
let symbols = "";
if (process.platform === "linux") {
  // Preserve the symbol table as an independent oracle while avoiding a full
  // runtime DWARF import in this metadata-specific lane.
  run(process.env.REA_NATIVEAOT_STRIP ?? "strip", ["--strip-debug", binary]);
  symbols = run(process.env.REA_NATIVEAOT_NM ?? "nm", ["-n", binary]);
  await mkdir(join(output, "stripped"), { recursive: true });
  const stripped = join(output, "stripped", name);
  await copyFile(binary, stripped);
  run(process.env.REA_NATIVEAOT_STRIP ?? "strip", ["--strip-all", stripped]);
} else {
  symbols = await readFile(map, "utf8");
}
const bytes = await readFile(binary);
const candidates = [];
for (let offset = 0; offset <= bytes.length - 16; offset++) {
  if (
    bytes.readUInt32LE(offset) !== 0x00525452 ||
    bytes[offset + 14] !== 24 ||
    bytes[offset + 15] !== 1
  )
    continue;
  const count = bytes.readUInt16LE(offset + 12);
  if (count === 0 || count > 80 || offset + 16 + count * 24 > bytes.length)
    continue;
  candidates.push({
    offset,
    major: bytes.readUInt16LE(offset + 4),
    minor: bytes.readUInt16LE(offset + 6),
    sections: Array.from({ length: count }, (_, index) => {
      const row = offset + 16 + index * 24;
      return {
        type: bytes.readUInt32LE(row),
        flags: bytes.readUInt32LE(row + 4),
        start: `0x${bytes.readBigUInt64LE(row + 8).toString(16)}`,
        end: `0x${bytes.readBigUInt64LE(row + 16).toString(16)}`,
      };
    }),
  });
}
if (
  candidates.length !== 1 ||
  candidates[0].major !== 9 ||
  candidates[0].minor !== 1
)
  throw new Error(
    "NativeAOT fixture did not produce exactly one independent RTR 9.1 directory.",
  );
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(join(output, "symbols.txt"), symbols);
await writeFile(
  join(output, "oracle.json"),
  JSON.stringify(
    {
      sdk: "8.0.416",
      runtime_version: "8.0.22",
      runtime,
      binary,
      sha256,
      headers: candidates,
      expected_strings: [
        "REA_NATIVEAOT_FROZEN",
        "REA_NATIVEAOT_BASE",
        "REA_NATIVEAOT_DERIVED",
      ],
    },
    null,
    2,
  ) + "\n",
);
// A source-built negative input, not a downloaded third-party target.
if (process.platform === "linux") {
  const source = join(output, "ordinary.c");
  await writeFile(
    source,
    "int ordinary_probe(int x) { return x * 3 + 1; }\nint main(void) { return ordinary_probe(1); }\n",
  );
  run(process.env.REA_NATIVEAOT_CC ?? "cc", [
    "-g",
    "-O0",
    source,
    "-o",
    join(output, "ordinary"),
  ]);
  // Small source-built producer regressions run in seconds: no executable
  // patching, large runtime import, or downloaded opaque negative inputs.
  const row = "struct Row { unsigned type, flags; const char *start, *end; };";
  const header =
    "struct Header { unsigned signature; unsigned short major, minor; unsigned flags; unsigned short count; unsigned char size, type; struct Row row; };";
  for (const kind of ["unsupported", "malformed", "ambiguous"]) {
    const major = kind === "unsupported" ? 99 : 9;
    const declaration = `const struct Header __attribute__((aligned(8))) probe = {0x00525452, ${major}, 1, 0, 1, 24, 1, {207, 1, data + 8, data}};`;
    const extra =
      kind === "ambiguous" ? declaration.replace("probe", "second_probe") : "";
    const negative = join(output, `${kind}.c`);
    await writeFile(
      negative,
      `${row}\n${header}\nconst char data[16] = {0};\n${declaration}\n${extra}\nint main(void) { return 0; }\n`,
    );
    run(process.env.REA_NATIVEAOT_CC ?? "cc", [
      "-O0",
      "-fno-pie",
      "-no-pie",
      negative,
      "-o",
      join(output, kind),
    ]);
  }
}
console.log(
  `PASS source-built ${runtime} NativeAOT fixture, independent RTR 9.1 oracle and SHA-256 ${sha256}; no target execution`,
);
