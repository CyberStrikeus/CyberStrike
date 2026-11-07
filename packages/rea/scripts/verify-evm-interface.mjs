#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import {
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const solcModule = process.env.REA_VERIFY_SOLC_MODULE;
const strace = process.env.REA_VERIFY_STRACE_COMMAND;
if (
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  !isAbsolute(solcModule ?? "") ||
  !isAbsolute(strace ?? "")
)
  throw new Error(
    "verify:evm:interface requires Linux x64, caller-supplied util-linux prlimit and absolute REA_VERIFY_SOLC_MODULE pointing to unchanged solc 0.8.30 and absolute REA_VERIFY_STRACE_COMMAND. No target or chain is executed.",
  );
try {
  await access(
    process.env.REA_EVM_PRLIMIT_COMMAND ?? "/usr/bin/prlimit",
    constants.X_OK,
  );
  await access(solcModule, constants.R_OK);
  await access(strace, constants.X_OK);
} catch (cause) {
  throw new Error(
    "verify:evm:interface prerequisite unavailable: selected solc module, strace or util-linux prlimit",
    { cause },
  );
}
const solc = (await import(pathToFileURL(solcModule).href)).default;
assert.equal(solc.version(), "0.8.30+commit.73712a01.Emscripten.clang");
const source = await readFile(
  new URL("./fixtures/evm-interface.sol", import.meta.url),
  "utf8",
);
const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const execute = promisify(execFile);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const run = createVerifierRun();
const root = await PrivateRuntimeRoot.create({ prefix: "rea-evm-verifier-" });
const client = new Client({ name: "evm-interface-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const failures = [];
let cases = 0;
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(({ name }) => name === "inspect_evm_interface"));
  const inspect = async (
    mode,
    path,
    encoding,
    expectedCategory,
    scope = { command: process.execPath, prefix: [], client },
  ) => {
    let value;
    if (mode === "cli") {
      let stdout;
      try {
        ({ stdout } = await execute(
          scope.command,
          [
            ...scope.prefix,
            entrypoint,
            "inspect-evm-interface",
            path,
            encoding,
            "--json",
          ],
          {
            env: scope.environment ?? environment,
            timeout: 45_000,
            maxBuffer: 32 * 1024 * 1024,
          },
        ));
      } catch (cause) {
        if (typeof cause.code !== "number" || typeof cause.stdout !== "string")
          throw cause;
        stdout = cause.stdout;
      }
      value = JSON.parse(stdout);
    } else {
      const reply = await scope.client.callTool({
        name: "inspect_evm_interface",
        arguments: { path, encoding },
      });
      value =
        expectedCategory !== undefined
          ? requireMcpToolError(reply)
          : requireMcpOutput(reply, "inspect_evm_interface");
    }
    if (expectedCategory !== undefined) {
      assert.equal(value.category, expectedCategory, JSON.stringify(value));
      return value;
    }
    assert.equal(
      value.category,
      undefined,
      `Unexpected public failure: ${JSON.stringify(value)}`,
    );
    const evidence = parseEvidence(value);
    const report = evidence.normalized_result;
    assert.equal(report.diagnostics.truncated, false);
    assert.equal(evidence.provider.version, "evmole@0.9.3");
    assert.equal(evidence.confidence, "inferred");
    assert.equal(report.artifact.path, path);
    assert.equal(report.artifact.encoding, encoding);
    const carrier = await readFile(path);
    assert.equal(
      report.artifact.sha256,
      createHash("sha256").update(carrier).digest("hex"),
    );
    assert.equal(evidence.subject.digest.sha256, report.artifact.sha256);
    assert.equal(report.artifact.bytes, carrier.length);
    assert.equal(
      report.bytecode.sha256,
      createHash("sha256")
        .update(Buffer.from(report.bytecode.hex, "hex"))
        .digest("hex"),
    );
    assert.equal(report.bytecode.bytes, report.bytecode.hex.length / 2);
    for (const key of ["kind", "hardfork", "deployment_authenticity"])
      assert.equal(report.bytecode[key], "unknown");
    assert.equal(report.discovery_completeness, "unknown");
    assert.equal(report.runtime_execution, "not-performed");
    assert.deepEqual(
      report.functions.map((fn) => ({
        selector: fn.selector.slice(2),
        bytecodeOffset: fn.bytecode_offset,
        dispatch: fn.dispatch,
        ...(fn.inferred_arguments === null
          ? {}
          : { arguments: fn.inferred_arguments }),
        ...(fn.inferred_state_mutability === null
          ? {}
          : { stateMutability: fn.inferred_state_mutability }),
      })),
      evidence.raw_result.functions ?? [],
    );
    if (mode === "mcp") assert.deepEqual(value.normalized_result, report);
    return report;
  };
  const ownershipProbe = join(root.path, "ownership-prerequisite.hex");
  await writeFile(ownershipProbe, "0x00");
  const missingInspection = await inspect(
    "cli",
    ownershipProbe,
    "hex",
    "unsupported_provider",
    {
      command: process.execPath,
      prefix: [],
      client,
      environment: { ...environment, PATH: root.path },
    },
  );
  assert.equal(missingInspection.code, "capability_unavailable");
  assert.match(missingInspection.message, /procps-compatible ps/u);
  assert.equal(missingInspection.details.operation, "prepare_owned_process");
  cases++;
  for (const [name, optimizer, viaIR] of [
    ["plain", false, false],
    ["optimized", true, false],
    ["via-ir", true, true],
  ]) {
    const output = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: "Solidity",
          sources: { "Interface.sol": { content: source } },
          settings: {
            optimizer: { enabled: optimizer, runs: 200 },
            viaIR,
            evmVersion: "cancun",
            outputSelection: {
              "*": {
                "*": [
                  "evm.deployedBytecode.object",
                  "evm.methodIdentifiers",
                  "abi",
                ],
              },
            },
          },
        }),
      ),
    );
    assert.ok(
      !output.errors?.some(({ severity }) => severity === "error"),
      JSON.stringify(output.errors),
    );
    const artifact = output.contracts["Interface.sol"].InterfaceFixture;
    const hex = artifact.evm.deployedBytecode.object;
    const expected = Object.values(artifact.evm.methodIdentifiers)
      .map((selector) => "0x" + selector)
      .sort();
    const forms = [
      ["hex", ` \t0x${hex.toUpperCase()}\r\n`],
      ["raw", Buffer.from(hex, "hex")],
    ];
    for (const [encoding, data] of forms) {
      const path = join(root.path, `${name}.${encoding}`);
      await writeFile(path, data);
      const original = await readFile(path);
      for (const mode of ["cli", "mcp"]) {
        const report = await inspect(mode, path, encoding);
        assert.equal(report.bytecode.hex, hex);
        assert.equal(report.bytecode.metadata.status, "decoded");
        assert.deepEqual(report.bytecode.metadata.compiler_version, {
          representation: "release-bytes",
          value: "0.8.30",
        });
        assert.equal(
          report.bytecode.metadata.bytecode_offset +
            report.bytecode.metadata.cbor_bytes +
            2,
          Buffer.from(hex, "hex").length,
        );
        assert.ok(
          report.bytecode.metadata.entries.some(
            ({ key, value }) =>
              key.kind === "text" &&
              key.value === "solc" &&
              value.kind === "bytes" &&
              value.value === "00081e",
          ),
        );
        assert.deepEqual(
          report.functions
            .filter(({ dispatch }) => dispatch === "abi")
            .map(({ selector }) => selector)
            .sort(),
          expected,
        );
        assert.ok(
          report.functions.every(
            ({ bytecode_offset }) => bytecode_offset < report.bytecode.bytes,
          ),
        );
        const set = report.functions.find(
          ({ selector }) =>
            selector === "0x" + artifact.evm.methodIdentifiers["set(uint256)"],
        );
        assert.equal(set.inferred_arguments, "uint256");
        assert.equal(set.inferred_state_mutability, "nonpayable");
        cases++;
      }
      assert.deepEqual(await readFile(path), original);
    }
  }
  for (const [name, data, encoding] of [
    ["empty", "0x", "hex"],
    ["empty-raw", Buffer.alloc(0), "raw"],
    ["incomplete-push", Buffer.from([0x7f]), "raw"],
    ["no-dispatch", "60006000f3", "hex"],
  ]) {
    const path = join(root.path, name);
    await writeFile(path, data);
    for (const mode of ["cli", "mcp"]) {
      const report = await inspect(mode, path, encoding);
      assert.equal(report.functions.length, 0);
      cases++;
    }
  }
  for (const [name, hex, expected] of [
    ["zero-selector", "60003560e01c630000000014601057005b00", ["0x00000000"]],
    ["push-immediate", "63123456785060006000f3", []],
  ]) {
    const path = join(root.path, name);
    await writeFile(path, hex);
    for (const mode of ["cli", "mcp"]) {
      const report = await inspect(mode, path, "hex");
      assert.deepEqual(
        report.functions.map(({ selector }) => selector),
        expected,
      );
      cases++;
    }
  }
  for (const [encoding, data] of [
    ["raw", Buffer.from("ef0001", "hex")],
    ["hex", "0xef0001"],
  ]) {
    const path = join(root.path, "eof." + encoding);
    await writeFile(path, data);
    for (const mode of ["cli", "mcp"]) {
      const failure = await inspect(mode, path, encoding, "unsupported_target");
      assert.equal(failure.code, "unsupported_target");
      assert.equal(failure.details.path, path);
      assert.match(failure.details.reason, /EF00/);
      assert.match(failure.remediation.action, /target format/);
      cases++;
    }
  }
  for (const [name, data] of [
    ["odd", "0x1"],
    ["invalid-hex", "xyz"],
    ["interior-space", "60 00"],
    ["bom", "\uFEFF6000"],
    ["utf8", Buffer.from([0xff])],
  ]) {
    const path = join(root.path, name);
    await writeFile(path, data);
    for (const mode of ["cli", "mcp"]) {
      await inspect(mode, path, "hex", "invalid_input");
      cases++;
    }
  }
  for (const mode of ["cli", "mcp"]) {
    await inspect(mode, join(root.path, "absent"), "raw", "invalid_input");
    cases++;
  }
  for (const [option, expected] of [
    ["--as=2147483648", "address_space_bytes=2147483648"],
    ["--cpu=20", "cpu_seconds=20"],
    ["--fsize=8388608", "file_size_bytes=8388608"],
  ]) {
    const limiter = environment.REA_EVM_PRLIMIT_COMMAND ?? "/usr/bin/prlimit";
    const prefix = [
      option,
      "--",
      process.execPath,
      "--disable-wasm-trap-handler",
    ];
    const limitedClient = new Client({
      name: "limited-evm-verifier",
      version: "1",
    });
    const limitedTransport = new StdioClientTransport({
      command: limiter,
      args: [...prefix, entrypoint, "mcp"],
      env: environment,
      stderr: "pipe",
    });
    try {
      await limitedClient.connect(limitedTransport);
      const scope = { command: limiter, prefix, client: limitedClient };
      for (const mode of ["cli", "mcp"]) {
        const report = await inspect(
          mode,
          join(root.path, "zero-selector"),
          "hex",
          undefined,
          scope,
        );
        assert.ok(report.limitations.some((item) => item.includes(expected)));
        cases++;
      }
    } finally {
      try {
        await limitedClient.close();
      } finally {
        await limitedTransport.close();
      }
    }
  }
  const brokenLimiter = join(root.path, "broken-limiter");
  await writeFile(brokenLimiter, "#!/rea-verifier-missing-interpreter\n", {
    mode: 0o700,
  });
  const signalLimiter = join(root.path, "signal-limiter");
  await writeFile(signalLimiter, '#!/bin/sh\nulimit -c 0\nkill -XCPU "$$"\n', {
    mode: 0o700,
  });
  const fileLimiter = join(root.path, "file-size-limiter");
  const unmarkedLimiter = join(root.path, "unmarked-file-size-limiter");
  await writeFile(
    unmarkedLimiter,
    '#!/bin/sh\nprintf "launcher exit 76\\n" >&2\nexit 76\n',
    { mode: 0o700 },
  );
  // Fixture-only launcher: run the actual Node/WASM worker with a one-byte
  // file allowance, keeping the usual address-space, CPU and core budgets.
  await writeFile(
    fileLimiter,
    '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\n[ "$#" -gt 0 ] || exit 64\nshift\nexec /usr/bin/prlimit --as=3221225472: --cpu=30: --fsize=1: --core=0: -- "$@"\n',
    { mode: 0o700 },
  );
  for (const [limiter, category, resource] of [
    [root.path, "unsupported_provider"],
    [brokenLimiter, "unsupported_provider"],
    [signalLimiter, "resource_constraint", "cpu"],
    [fileLimiter, "resource_constraint", "file-size"],
    [unmarkedLimiter, "execution_failure"],
  ]) {
    const selectedEnvironment = {
      ...environment,
      REA_EVM_PRLIMIT_COMMAND: limiter,
    };
    const selectedClient = new Client({
      name: "unavailable-evm-limiter-verifier",
      version: "1",
    });
    const selectedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: selectedEnvironment,
      stderr: "pipe",
    });
    try {
      await selectedClient.connect(selectedTransport);
      const scope = {
        command: process.execPath,
        prefix: [],
        client: selectedClient,
        environment: selectedEnvironment,
      };
      for (const mode of ["cli", "mcp"]) {
        const error = await inspect(
          mode,
          join(root.path, "zero-selector"),
          "hex",
          category,
          scope,
        );
        if (category === "resource_constraint") {
          assert.equal(error.code, "resource_constraint");
          assert.equal(error.details.resource, resource);
          assert.equal(
            error.details.reported_limits.effective_soft_limits,
            null,
          );
          assert.equal(
            typeof error.details.reported_limits.configured_soft_limits
              .cpu_seconds,
            "number",
          );
          assert.ok(
            JSON.stringify(error).includes(
              resource === "cpu" ? "SIGXCPU" : "EFBIG",
            ),
          );
        } else if (category === "execution_failure") {
          assert.equal(error.code, "execution_failure");
          assert.ok(JSON.stringify(error).includes("launcher exit 76"));
          assert.ok(JSON.stringify(error).includes("file_size_failure_marker"));
        } else {
          assert.equal(error.code, "capability_unavailable");
          assert.ok(JSON.stringify(error).includes(limiter));
        }
        cases++;
      }
    } finally {
      try {
        await selectedClient.close();
      } finally {
        await selectedTransport.close();
      }
    }
  }
  for (const [name, encoding] of [
    ["plain.hex", "hex"],
    ["via-ir.raw", "raw"],
  ]) {
    await execute(
      strace,
      [
        "-ff",
        "-e",
        "trace=network,execve,execveat",
        "-s",
        "4096",
        "-o",
        join(root.path, `offline.trace.${name}`),
        process.execPath,
        entrypoint,
        "inspect-evm-interface",
        join(root.path, name),
        encoding,
        "--json",
      ],
      {
        env: { ...environment, PATH: "/usr/bin:/bin" },
        timeout: 45_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  }
  const observedExecutables = new Set();
  for (const file of await readdir(root.path)) {
    if (!file.startsWith("offline.trace.")) continue;
    const localSocketDescriptors = new Set();
    for (const line of (await readFile(join(root.path, file), "utf8")).split(
      "\n",
    )) {
      if (/execve(?:at)?\(/.test(line)) {
        const match = /^execve\("([^"]+)"/.exec(line);
        assert.notEqual(match, null, `Unresolved executable identity: ${line}`);
        assert.ok(
          line.endsWith(" = 0") || / = -1 [A-Z]+/.test(line),
          `Incomplete exec observation: ${line}`,
        );
        const ownershipInspection =
          ["/usr/bin/ps", "/bin/ps"].includes(match[1]) &&
          line.includes(
            '["ps", "-axo", "pid=,ppid=,pgid=,uid=,stat=,command="]',
          );
        assert.ok(
          [
            process.execPath,
            environment.REA_EVM_PRLIMIT_COMMAND ?? "/usr/bin/prlimit",
          ].includes(match[1]) || ownershipInspection,
          `Unexpected host execution: ${line}`,
        );
        observedExecutables.add(match[1]);
      } else if (/^[a-z]+\(/.test(line)) {
        assert.ok(
          permitsStdioSocketObservation(line, localSocketDescriptors),
          `Unexpected attempted network operation: ${line}`,
        );
      }
    }
  }
  assert.ok(observedExecutables.has(process.execPath));
  assert.ok(
    observedExecutables.has(
      environment.REA_EVM_PRLIMIT_COMMAND ?? "/usr/bin/prlimit",
    ),
  );
  cases += 2;
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
if (
  verifier.process_lineage.status !== "verified" ||
  verifier.process_lineage.descendants.length !== 0
)
  failures.push(
    new Error(
      "Verifier process lineage was not fully released: " +
        JSON.stringify(verifier),
    ),
  );
console.log(
  JSON.stringify(
    {
      status: failures.length === 0 ? "passed" : "failed",
      public_cases: cases,
      compiler: solc.version(),
      engine: "evmole@0.9.3",
      ...(failures.length === 0
        ? {
            target_execution: "exec-syscalls-verified-absent",
            network_requests: "socket-syscalls-verified-absent",
          }
        : {}),
      verifier,
    },
    null,
    2,
  ),
);
if (failures.length !== 0)
  throw new AggregateError(
    failures,
    "Offline EVM interface verification failed; cleanup failures retained.",
  );

function permitsStdioSocketObservation(line, localDescriptors) {
  if (line.startsWith("socketpair(AF_UNIX,")) {
    const pair = /\[(\d+), (\d+)\]\)\s+= 0$/.exec(line);
    if (pair !== null) {
      localDescriptors.add(pair[1]);
      localDescriptors.add(pair[2]);
    }
    return true;
  }
  const name = /^getsockname\((\d+), \{sa_family=AF_UNIX\}/.exec(line);
  if (name !== null) {
    localDescriptors.add(name[1]);
    return true;
  }
  // A failed descriptor query performs no request and identifies no socket.
  if (line.startsWith("getsockname(") && / = -1 ENOTSOCK/.test(line))
    return true;
  const metadata =
    /^(?:getsockopt\((\d+), SOL_SOCKET, SO_TYPE,|setsockopt\((\d+), SOL_SOCKET, SO_(?:RCVBUF|SNDBUF),|shutdown\((\d+), SHUT_WR\))/.exec(
      line,
    );
  const descriptor = metadata?.[1] ?? metadata?.[2] ?? metadata?.[3];
  // Allow descriptor queries/buffer configuration only after observing a local
  // stdio socket. Other socket creation, connection and data operations fail.
  return descriptor !== undefined && localDescriptors.has(descriptor);
}
