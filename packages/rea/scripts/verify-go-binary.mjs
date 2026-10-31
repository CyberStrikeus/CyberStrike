#!/usr/bin/env node
import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { goBinarySchema } from "../dist/domain/go/goBinary.js";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { requireMcpOutput } from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const execute = promisify(execFile);
const compiler = process.env.REA_VERIFY_GO_COMMAND ?? "go";
if (process.env.REA_VERIFY_GO_COMMAND !== undefined && !isAbsolute(compiler))
  throw new Error(
    "REA_VERIFY_GO_COMMAND must be an absolute Go compiler path.",
  );
let compilerVersion = null;
const run = createVerifierRun();
const root = await PrivateRuntimeRoot.create({ prefix: "rea-go-verifier-" });
// Keep Go's directory enumeration below the private root's Windows ownership lease.
const sourceRoot = join(root.path, "source");
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
delete environment.HOPPER_TARGET_PATH;
const goEnvironment = {
  ...environment,
  CGO_ENABLED: "0",
  GOCACHEPROG: "",
  GO111MODULE: "on",
  GOENV: "off",
  GOFLAGS: "",
  GOMAXPROCS: "2",
  GOTOOLCHAIN: "local",
  GOWORK: "off",
  GOPROXY: "off",
  GOSUMDB: "off",
  GOPATH: join(root.path, "gopath"),
  GOCACHE: join(root.path, "cache"),
  GOMODCACHE: join(root.path, "modules"),
  GOTMPDIR: join(root.path, "tmp"),
  // Go's own verifier seam isolates telemetry; no global configuration is changed.
  TEST_TELEMETRY_DIR: join(root.path, "telemetry"),
};
const client = new Client({ name: "go-binary-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const targets = [
  ["linux", "amd64", "elf", 64, "little"],
  ["linux", "386", "elf", 32, "little"],
  ["linux", "arm64", "elf", 64, "little"],
  ["linux", "ppc64", "elf", 64, "big"],
  ["linux", "mips", "elf", 32, "big"],
  ["windows", "amd64", "pe", 64, "little"],
  ["windows", "386", "pe", 32, "little"],
  ["darwin", "amd64", "macho", 64, "little"],
  ["darwin", "arm64", "macho", 64, "little"],
];
const verified = [];
const omittedCoverage = [];
const failures = [];
try {
  await prepareFixture();
  try {
    compilerVersion = (
      await execute(compiler, ["version"], {
        cwd: root.path,
        env: goEnvironment,
        timeout: 10_000,
      })
    ).stdout.trim();
  } catch (cause) {
    throw new Error(
      "verify:go:binary requires Go on PATH or absolute REA_VERIFY_GO_COMMAND; Go is only a fixture producer, not a REA runtime dependency.",
      { cause },
    );
  }
  const host = (await go(["env", "GOHOSTOS", "GOHOSTARCH"])).stdout
    .trim()
    .split("\n");
  const oracle = join(
    root.path,
    host[0] === "windows" ? "buildinfo-oracle.exe" : "buildinfo-oracle",
  );
  await go(
    ["build", "-trimpath", "-buildvcs=false", "-o", oracle, "./oracle"],
    { GOOS: host[0], GOARCH: host[1] },
  );
  await client.connect(transport);
  for (const target of targets) {
    const [os, arch] = target;
    const path = join(
      root.path,
      `${os}-${arch}${os === "windows" ? ".exe" : ""}`,
    );
    await go(
      [
        "build",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags=-s -w",
        "-o",
        path,
        ".",
      ],
      { GOOS: os, GOARCH: arch },
    );
    const strippedInfo = await verify(path, target, oracle, null, "stripped");
    if (os === "linux" && arch === "amd64") {
      const sectionless = join(root.path, "linux-amd64-sectionless");
      const bytes = Buffer.from(await readFile(path));
      bytes.fill(0, 40, 48); // ELF64 e_shoff.
      bytes.fill(0, 58, 64); // e_shentsize, e_shnum and e_shstrndx.
      await writeFile(sectionless, bytes);
      const sectionlessInfo = await verify(
        sectionless,
        target,
        oracle,
        null,
        "sectionless",
        path,
      );
      assert.deepEqual(sectionlessInfo, strippedInfo);

      const pie = join(root.path, "linux-amd64-pie");
      await go(
        [
          "build",
          "-trimpath",
          "-buildvcs=false",
          "-ldflags=-s -w",
          "-buildmode=pie",
          "-o",
          pie,
          ".",
        ],
        { GOOS: os, GOARCH: arch },
      );
      const originalInfo = await verify(pie, target, oracle, null, "pie");
      const pieBytes = Buffer.from(await readFile(pie));
      pieBytes.fill(0, 40, 48);
      pieBytes.fill(0, 58, 64);
      const pieSectionless = `${pie}-sectionless`;
      await writeFile(pieSectionless, pieBytes);
      // Keep the producer image as the independent oracle. Removing section
      // headers must preserve every metadata field and original source span.
      const retainedInfo = await verify(
        pieSectionless,
        target,
        oracle,
        null,
        "sectionless-pie",
        pie,
      );
      assert.deepEqual(retainedInfo, originalInfo);
    }
  }
  for (const target of targets.filter(([os]) => os === "darwin")) {
    const [os, arch] = target;
    const path = join(root.path, `${os}-${arch}-unstripped`);
    await go(["build", "-trimpath", "-buildvcs=false", "-o", path, "."], {
      GOOS: os,
      GOARCH: arch,
    });
    await verify(path, target, oracle, null, "unstripped");
  }
  if (process.platform === "win32")
    omittedCoverage.push(
      "Compiler-produced non-UTF-8 argv strings were not verified on Windows; Windows argv cannot preserve arbitrary byte arguments.",
    );
  else {
    const path = join(root.path, "linux-amd64-byte-strings");
    const expected = JSON.parse(
      (
        await execute(oracle, ["--build-byte-fixture", compiler, path], {
          cwd: sourceRoot,
          env: { ...goEnvironment, GOOS: "linux", GOARCH: "amd64" },
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout,
    );
    await verify(path, targets[0], oracle, expected);
  }
} catch (cause) {
  failures.push(cause);
} finally {
  for (const close of [
    () => client.close(),
    () => transport.close(),
    () => root.close(),
  ]) {
    try {
      await close();
    } catch (cause) {
      failures.push(cause);
    }
  }
}
const verifier = await completeVerifierRun(run);
try {
  await assert.rejects(lstat(root.path), { code: "ENOENT" });
  if (verifier.process_lineage.status === "verified")
    assert.deepEqual(verifier.process_lineage.descendants, []);
} catch (cause) {
  failures.push(cause);
}
if (failures.length > 0) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        compiler: compilerVersion,
        verified,
        omitted_coverage: omittedCoverage,
        verifier,
      },
      null,
      2,
    ),
  );
  throw new AggregateError(
    failures,
    "Real Go metadata verification failed; cleanup failures are retained.",
  );
}
console.log(
  JSON.stringify(
    {
      status: "passed",
      compiler: compilerVersion,
      binaries: verified.length,
      public_cases: verified.length * 2,
      verified,
      omitted_coverage: omittedCoverage,
      fixture_execution:
        "not-requested; only the Go fixture producer and test-owned buildinfo oracle/helper were executed",
      verifier,
    },
    null,
    2,
  ),
);

async function go(args, overrides = {}) {
  return execute(compiler, args, {
    cwd: sourceRoot,
    env: { ...goEnvironment, ...overrides },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}

async function prepareFixture() {
  await mkdir(sourceRoot);
  await mkdir(join(root.path, "tmp"));
  await mkdir(join(root.path, "telemetry"));
  await writeFile(join(root.path, "telemetry", "mode"), "off\n");
  await mkdir(join(sourceRoot, "dependency"));
  await mkdir(join(sourceRoot, "oracle"));
  await writeFile(
    join(sourceRoot, "go.mod"),
    "module example.test/rea-go-fixture\n\ngo 1.20\n\nrequire example.test/dependency v1.2.3\nreplace example.test/dependency => ./dependency\n",
  );
  await writeFile(
    join(sourceRoot, "dependency", "go.mod"),
    "module example.test/dependency\n\ngo 1.20\n",
  );
  await writeFile(
    join(sourceRoot, "dependency", "dependency.go"),
    'package dependency\nfunc Value() string { return "REA fixture" }\n',
  );
  await writeFile(
    join(sourceRoot, "main.go"),
    'package main\nimport ("fmt"; "example.test/dependency")\nfunc main() { fmt.Println(dependency.Value()) }\n',
  );
  await writeFile(
    join(sourceRoot, "oracle", "main.go"),
    String.raw`package main

import (
  "context"
  "debug/buildinfo"
  "encoding/base64"
  "encoding/json"
  "os"
  "os/exec"
  "time"
  "unicode/utf8"
)

func main() {
  byteFixture := len(os.Args) == 4 && os.Args[1] == "--build-byte-fixture"
  path := os.Args[1]
  if byteFixture {
    path = os.Args[3]
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
    defer cancel()
    cmd := exec.CommandContext(ctx, os.Args[2], "build", "-buildvcs=false",
      "-tags=" + string([]byte{0xff}),
      "-ldflags=-X runtime.buildVersion=custom" + string([]byte{0xff}),
      "-o", path, ".")
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    if err := cmd.Run(); err != nil { panic(err) }
  }
  info, err := buildinfo.ReadFile(path)
  if err != nil { panic(err) }
  var result interface{} = info
  if byteFixture {
    settings := make([]map[string]string, 0)
    byteSettings := make([]map[string]string, 0)
    for _, setting := range info.Settings {
      if utf8.ValidString(setting.Key) && utf8.ValidString(setting.Value) {
        settings = append(settings, map[string]string{"Key": setting.Key, "Value": setting.Value})
      } else {
        byteSettings = append(byteSettings, map[string]string{
          "KeyBytesBase64": base64.StdEncoding.EncodeToString([]byte(setting.Key)),
          "ValueBytesBase64": base64.StdEncoding.EncodeToString([]byte(setting.Value)),
        })
      }
    }
    result = map[string]interface{}{
      "GoVersion": nil,
      "GoVersionBytesBase64": base64.StdEncoding.EncodeToString([]byte(info.GoVersion)),
      "Path": info.Path, "Main": info.Main, "Deps": info.Deps,
      "Settings": settings, "ByteSettings": byteSettings,
    }
  }
  if err := json.NewEncoder(os.Stdout).Encode(result); err != nil { panic(err) }
}
`,
  );
}

async function inspect(mode, path) {
  let envelope;
  if (mode === "cli") {
    const { stdout } = await execute(
      process.execPath,
      [entrypoint, "inspect-go-binary", path, "--json"],
      { env: environment, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    envelope = JSON.parse(stdout);
  } else {
    const response = await client.callTool(
      { name: "inspect_go_binary", arguments: { path } },
      { timeout: 30_000 },
    );
    envelope = requireMcpOutput(response, "inspect_go_binary");
  }
  const evidence = parseEvidence(envelope);
  assert.equal(evidence.subject.local_path, path);
  const report = goBinarySchema.parse(evidence.normalized_result);
  assert.equal(evidence.subject.digest.sha256, report.artifact.sha256);
  return { evidence, report };
}

async function verify(
  path,
  target,
  oracle,
  byteExpected = null,
  fileKind = "stripped",
  oraclePath = path,
) {
  const bytes = await readFile(path);
  const expected =
    byteExpected ??
    JSON.parse(
      (
        await execute(oracle, [oraclePath], {
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout,
    );
  const reports = [];
  for (const mode of ["cli", "mcp"]) {
    const { evidence, report } = await inspect(mode, path);
    assert.equal(report.format, target[2]);
    assert.equal(report.architecture, target[1]);
    assert.equal(
      evidence.subject.architecture,
      { amd64: "x86_64", 386: "x86", arm64: "arm64", mips: "mips" }[
        target[1]
      ] ?? null,
    );
    assert.equal(report.bits, target[3]);
    assert.equal(report.byte_order, target[4]);
    assert.equal(report.artifact.path, path);
    assert.equal(report.artifact.bytes, bytes.length);
    assert.equal(
      report.artifact.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    const info = report.build_info;
    assert.notEqual(info, null);
    assert.equal(info.go_version, expected.GoVersion);
    assert.equal(info.module.path, expected.Path);
    assert.deepEqual(
      normalizeObservedModule(info.module.main),
      normalizeModule(expected.Main),
    );
    assert.deepEqual(
      info.module.dependencies.map(normalizeObservedModule),
      (expected.Deps ?? []).map(normalizeModule),
    );
    assert.deepEqual(
      info.module.settings,
      (expected.Settings ?? []).map(({ Key, Value }) => ({
        key: Key,
        value: Value,
      })),
    );
    assert.equal(info.module.complete, byteExpected === null);
    if (byteExpected === null) {
      assert.deepEqual(info.module.unparsed_lines, []);
      assert.deepEqual(info.module.unparsed_line_bytes_base64, []);
    } else verifyByteStrings(info, expected);
    verifySource(info, bytes);
    reports.push(report);
    assert.deepEqual(
      await readFile(path),
      bytes,
      `${mode} changed source bytes`,
    );
  }
  assert.deepEqual(
    reports[0],
    reports[1],
    "Public CLI and MCP projections disagree",
  );
  verified.push({
    target: `${target[0]}/${target[1]}`,
    file: byteExpected === null ? fileKind : "byte-valued-strings",
    go_version: expected.GoVersion,
    ...(byteExpected === null
      ? {}
      : { go_version_bytes_base64: expected.GoVersionBytesBase64 }),
  });
  return reports[0].build_info;
}

function verifyByteStrings(info, expected) {
  const rawByte = Buffer.from([0xff]);
  const compilerBytes = Buffer.concat([Buffer.from("custom"), rawByte]);
  const ldflagsBytes = Buffer.concat([
    Buffer.from("-X runtime.buildVersion=custom"),
    rawByte,
  ]);
  assert.equal(info.go_version, null);
  assert.equal(info.module_text, null);
  assert.equal(info.go_version_bytes_base64, compilerBytes.toString("base64"));
  assert.equal(info.go_version_bytes_base64, expected.GoVersionBytesBase64);
  assert.deepEqual(expected.ByteSettings, [
    {
      KeyBytesBase64: Buffer.from("-ldflags").toString("base64"),
      ValueBytesBase64: ldflagsBytes.toString("base64"),
    },
    {
      KeyBytesBase64: Buffer.from("-tags").toString("base64"),
      ValueBytesBase64: rawByte.toString("base64"),
    },
  ]);
  assert.deepEqual(info.module.unparsed_lines, [
    'build\t-ldflags="-X runtime.buildVersion=custom\\xff"',
  ]);
  assert.deepEqual(info.module.unparsed_line_bytes_base64, [
    Buffer.concat([Buffer.from("build\t-tags="), rawByte]).toString("base64"),
  ]);
}

function normalizeModule(module) {
  const identity = ({ Path, Version, Sum }) => ({
    path: Path,
    version: Version,
    sum: Sum === "" || Sum === undefined ? null : Sum,
  });
  return {
    ...identity(module),
    replacement: module.Replace == null ? null : identity(module.Replace),
  };
}

function normalizeObservedModule(module) {
  // debug/buildinfo JSON represents both absent and explicitly empty sums as "".
  const identity = (value) => ({
    ...value,
    sum: value.sum === "" ? null : value.sum,
  });
  return {
    ...identity(module),
    replacement:
      module.replacement === null ? null : identity(module.replacement),
  };
}

function verifySource(info, bytes) {
  assert.deepEqual(
    bytes.subarray(info.header_offset, info.header_offset + 14),
    Buffer.from("ff20476f206275696c64696e663a", "hex"),
  );
  assert.equal(
    info.encoding,
    "inline",
    "Current compiler fixture must use inline string encoding",
  );
  const version = inlineString(bytes, info.header_offset + 32);
  const module = inlineString(bytes, version.offset + version.bytes.length);
  assert.deepEqual(info.version_location, {
    offset: version.offset,
    bytes: version.bytes.length,
  });
  assert.deepEqual(info.module_location, {
    offset: module.offset,
    bytes: module.bytes.length,
  });
  assert.equal(
    isUtf8(version.bytes) ? version.bytes.toString("utf8") : null,
    info.go_version,
  );
  assert.equal(version.bytes.toString("base64"), info.go_version_bytes_base64);
  assert.equal(module.bytes.toString("base64"), info.module_bytes_base64);
  assert.deepEqual(
    module.bytes.subarray(0, 16),
    Buffer.from("3077af0c9274080241e1c107e6d618e6", "hex"),
  );
  assert.deepEqual(
    module.bytes.subarray(-16),
    Buffer.from("f932433186182072008242104116d8f2", "hex"),
  );
  const moduleBody = module.bytes.subarray(16, -16);
  assert.equal(
    isUtf8(moduleBody) ? moduleBody.toString("utf8") : null,
    info.module_text,
  );
  assert.equal(moduleBody.at(-1), 10);
}

function inlineString(bytes, start) {
  let length = 0;
  let offset = start;
  let shift = 0;
  for (;;) {
    assert.ok(
      offset < bytes.length && shift < 49,
      "Fixture string length is invalid",
    );
    const byte = bytes[offset++];
    length += (byte & 127) * 2 ** shift;
    if ((byte & 128) === 0) break;
    shift += 7;
  }
  assert.ok(
    length <= bytes.length - offset,
    "Fixture string contents are truncated",
  );
  return { offset, bytes: bytes.subarray(offset, offset + length) };
}
