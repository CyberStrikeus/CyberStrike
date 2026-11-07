#!/usr/bin/env node
import {
  WINDOWS_GHIDRA_FIXTURE_FLAGS,
  windowsGhidraFixtureOptions,
} from "./lib/ghidra-windows-fixture-options.mjs";

import assert from "node:assert/strict";
import {
  expandProviderOutput,
  requireMcpOperationResult,
} from "./lib/mcp-verifier-results.mjs";
import { verifyGhidraCompactReferences } from "./lib/real-ghidra-compact-references.mjs";
import { verifyWindowsGhidraByteSearch } from "./lib/ghidra-windows-byte-search.mjs";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createPackageVerifierCommands } from "./lib/verify-package-commands.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "./lib/verifier-cleanup.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "Packaged Windows Ghidra acceptance requires a Windows x64 host.",
  );
const arguments_ = process.argv.slice(2);
const internalWorkspace = arguments_[0] === "--internal-workspace";
const fixtureArguments = internalWorkspace ? arguments_.slice(2) : arguments_;
const fixture = windowsGhidraFixtureOptions(fixtureArguments);
const dllFixture = fixture.dll;
const [packageRootArgument, targetArgument, reportArgument] =
  fixtureArguments.filter(
    (argument) => !WINDOWS_GHIDRA_FIXTURE_FLAGS.includes(argument),
  );
// Windows locks the loaded package-owned addon until the verifier exits.
// Keep installation cleanup in a parent that never loads that addon.
if (!internalWorkspace) {
  const ownedWorkspace = await mkdtemp(join(tmpdir(), "rea-packaged-ghidra-"));
  const workspaceOwner = {
    path: ownedWorkspace,
    close: () => rm(ownedWorkspace, { recursive: true, force: true }),
  };
  let commands;
  let result;
  try {
    result = await withVerifierCleanup(async () => {
      commands = await createPackageVerifierCommands({
        workspace: workspaceOwner,
      });
      return commands.exec(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          "--internal-workspace",
          ownedWorkspace,
          ...arguments_,
        ],
        { timeout: 900_000, maxBuffer: 8 * 1024 * 1024 },
      );
    }, [
      () =>
        commands === undefined ? workspaceOwner.close() : commands.close(),
    ]);
  } catch (cause) {
    if (typeof cause.stdout === "string") process.stdout.write(cause.stdout);
    if (typeof cause.stderr === "string") process.stderr.write(cause.stderr);
    throw cause;
  }
  const report = JSON.parse(result.stdout);
  report.workspaceCleanup = true;
  report.ok = true;
  if (reportArgument !== undefined)
    await writeFile(reportArgument, `${JSON.stringify(report)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write(result.stderr);
  process.exit(0);
}
assert.ok(arguments_[1] !== undefined, "Missing verifier workspace.");
const workspace = resolve(arguments_[1]);
let commands;
const closeCommands = () => commands?.close() ?? Promise.resolve();
try {
  commands = await createPackageVerifierCommands({
    // The parent owns removal after this process unloads the installed addon.
    workspace: { path: workspace, close: () => Promise.resolve() },
  });
  let packageRoot = resolve(packageRootArgument ?? ".");
  // The default lane verifies the npm artifact in an isolated prefix. Explicit
  // package roots support an already-installed artifact without a second install.
  if (packageRootArgument === undefined) {
    try {
      const packed = JSON.parse(
        (
          await commands.execNpm(
            [
              "pack",
              "--json",
              "--ignore-scripts",
              "--pack-destination",
              workspace,
            ],
            { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
          )
        ).stdout,
      );
      assert.equal(
        packed.length,
        1,
        "The package lane must produce one artifact.",
      );
      const prefix = join(workspace, "installed");
      await commands.execNpm(
        [
          "install",
          "--prefix",
          prefix,
          "--ignore-scripts",
          "--omit=dev",
          "--no-audit",
          "--no-fund",
          join(workspace, packed[0].filename),
        ],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      );
      packageRoot = join(prefix, "node_modules", "rea-agents");
    } catch (cause) {
      throw new Error("Packaged Windows verifier installation failed.", {
        cause,
      });
    }
  }
  const target = resolve(
    targetArgument ?? `build/fixtures/${fixture.filename}`,
  );
  let TOOL_CONTRACTS, native, token, sha256;
  let parsedTarget;
  try {
    ({ TOOL_CONTRACTS } = await import(
      pathToFileURL(join(packageRoot, "dist/contracts/toolContracts.js"))
    ));
    const { requireWindowsNativeAuthority } = await import(
      pathToFileURL(join(packageRoot, "dist/windows/WindowsNativeLoader.js"))
    );
    native = requireWindowsNativeAuthority();
    token = native.call("process_caller_token", []);
    assert.equal(
      token.administrator,
      false,
      "The real-provider lane must run as an ordinary user.",
    );
    assert.equal(
      token.elevated,
      false,
      "The real-provider lane must use a non-elevated token.",
    );
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    sha256 = digest(await readFile(target));
    const { parseBinaryTarget } = await import(
      pathToFileURL(
        join(packageRoot, "dist/application/BinaryTargetResolver.js"),
      )
    );
    parsedTarget = await parseBinaryTarget(target);
    assert.equal(parsedTarget.ok, true);
    assert.equal(parsedTarget.value.format, "pe");
    assert.equal(parsedTarget.value.managed, false);
    if (targetArgument === undefined) {
      assert.equal(parsedTarget.value.architecture, fixture.architecture);
      assert.equal(
        parsedTarget.value.executableRole,
        dllFixture ? "shared-library" : "application",
      );
    }
  } catch (cause) {
    throw new Error("Packaged Windows verifier prerequisites failed.", {
      cause,
    });
  }
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const runtimeParent = join(workspace, "runtime with spaces");
  await mkdir(runtimeParent);
  const callerDirectory = join(workspace, "caller cwd with spaces");
  // Keep sorted for comparison with the final caller-directory listing.
  const scriptCollisions = [
    "ReaGhidraAnalysisOptions.java",
    "ReaGhidraApplySeeds.java",
    "ReaGhidraBridge.java",
    "ReaGhidraNoReturnFix.java",
    "ReaGhidraPrepareCom.java",
    "ReaGhidraPrepareDol.java",
    "ReaGhidraPrepareRaw.java",
  ];
  await mkdir(callerDirectory);
  for (const name of scriptCollisions) await mkdir(join(callerDirectory, name));
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name.toLowerCase() !== "comspec",
      ),
    ),
    ComSpec: (
      process.env.ComSpec ??
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe")
    ).replaceAll("\\", "/"),
    REA_LOG_LEVEL: "error",
    GHIDRA_HEADLESS_MAXMEM: "512m",
    NODE_OPTIONS: "--max-old-space-size=512",
    TEMP: runtimeParent.replaceAll("\\", "/"),
    TMP: runtimeParent.replaceAll("\\", "/"),
    HOME: workspace,
    USERPROFILE: workspace,
    APPDATA: join(workspace, "appdata"),
    LOCALAPPDATA: join(workspace, "localappdata"),
  };
  const entry = join(packageRoot, "scripts/rea.mjs");
  const report = {
    ok: false,
    platform: "win32",
    architecture: "x64",
    nonAdmin: true,
    targetSha256: sha256,
    targetArchitecture: parsedTarget.value.architecture,
    targetRole: parsedTarget.value.executableRole,
    cli: {},
    mcpOperations: [],
    nativeControls: "available",
    runtimeCleanup: false,
  };
  const assertCleanup = async () => {
    const entries = await readdir(runtimeParent);
    report.runtimeResidualCount = entries.length;
    report.runtimeResidualKinds = entries.map((name) =>
      name.startsWith("rea-")
        ? "rea-runtime"
        : name.startsWith("hsperfdata_")
          ? "jvm-performance-data"
          : "other",
    );
    assert.equal(entries.length, 0, "Provider runtime cleanup left files.");
  };
  try {
    const providers = expandProviderOutput(
      JSON.parse(
        (
          await commands.exec(
            process.execPath,
            [entry, "providers", "--json"],
            {
              env: environment,
              cwd: callerDirectory,
              timeout: 30_000,
            },
          )
        ).stdout,
      ),
    );
    assert.equal(providers.analysis_provider_binding, null);
    assert.ok(Array.isArray(providers.analysis_provider_candidates));
    const ghidra = providers.analysis_provider_candidates.find(
      ({ provider }) => provider.id === "ghidra",
    );
    assert.ok(ghidra !== undefined);
    assert.equal(ghidra.selected, false);
    assert.equal(ghidra.target_support.status, "unknown");
    report.cli.providers = true;
    const inspected = await commands.exec(
      process.execPath,
      [entry, "inspect", target, "--provider", "ghidra", "--format", "json"],
      {
        env: environment,
        cwd: callerDirectory,
        timeout: 360_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const inspection = JSON.parse(inspected.stdout);
    assert.ok(inspection.error === undefined);
    report.cli.inspect = true;
    await assertCleanup();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, "mcp"],
      env: environment,
      cwd: callerDirectory,
      stderr: "pipe",
    });
    const client = new Client({
      name: "rea-packaged-windows-ghidra",
      version: "1.0.0",
    });
    const closeClient = async () => {
      try {
        await client.close();
      } catch (cause) {
        commands.adopt(client, entry);
        throw cause;
      }
    };
    const closeTransport = async () => {
      try {
        await transport.close();
      } catch (cause) {
        commands.adopt(transport, entry);
        throw cause;
      }
    };
    const call = async (name, arguments_) => {
      report.lastOperation = name;
      if (reportArgument !== undefined)
        await writeFile(reportArgument, `${JSON.stringify(report)}\n`);
      const contract = TOOL_CONTRACTS.find((value) => value.name === name);
      assert.ok(contract !== undefined, `Missing canonical contract: ${name}`);
      const argumentsParsed = contract.inputSchema.parse(arguments_);
      const result = await client.callTool(
        { name, arguments: argumentsParsed },
        { timeout: 360_000 },
      );
      assert.notEqual(
        result.isError,
        true,
        `Packaged operation failed: ${name}`,
      );
      const projected = requireMcpOperationResult(result, name, contract);
      report.mcpOperations.push(name);
      return projected;
    };
    try {
      await client.connect(transport);
      await call("open_binary", { path: target });
      await call("binary_overview", {});
      const activators = (
        await readdir(runtimeParent, { recursive: true })
      ).filter((path) => basename(path) === "ReaGhidraBundleActivator.class");
      assert.equal(activators.length, 1);
      const [activator] = activators;
      assert.ok(activator !== undefined);
      const bundleDirectory = dirname(join(runtimeParent, activator));
      const manifest = await readFile(
        join(bundleDirectory, "META-INF", "MANIFEST.MF"),
        "utf8",
      );
      assert.match(
        manifest,
        /^Bundle-Activator: ReaGhidraBundleActivator\r?$/mu,
      );
      await assert.rejects(
        readFile(join(bundleDirectory, "GeneratedActivator.class")),
        { code: "ENOENT" },
      );
      report.bundleActivator = "ReaGhidraBundleActivator";
      assert.equal((await call("list_documents", {})).length, 1);
      await call("list_names", {});
      const procedures = await call("list_procedures", {});
      assert.ok(procedures.length > 0);
      if (targetArgument === undefined) {
        const calleeAddress = fixture.calleeAddress;
        const calleeCode = await call("procedure_pseudo_code", {
          procedure: calleeAddress,
        });
        assert.match(calleeCode, /\b(?:42|0x2a)\b/iu);
        if (dllFixture) {
          const callerAddress = fixture.callerAddress;
          assert.ok(
            (
              await call("procedure_callees", { procedure: callerAddress })
            ).includes(calleeAddress),
          );
          assert.match(
            await call("procedure_pseudo_code", { procedure: callerAddress }),
            /\+\s*1\b/u,
          );
        }
      }
      assert.ok((await call("list_segments", {})).length > 0);
      await call("list_strings", {});
      const procedure =
        procedures.find((item) => item.procedure?.external === false) ??
        procedures[0];
      assert.ok(procedure !== undefined);
      const loadImage = await call("inspect_native_load_image", {});
      assert.equal(
        loadImage.status,
        "unsupported",
        "PE load-image attestation must remain explicitly unsupported.",
      );
      assert.ok(loadImage.observations !== undefined);
      const memory = await call("read_bytes", {
        address: procedure.address,
        length: 16,
      });
      const mapping = await call("address_to_file_offset", {
        address: procedure.address,
      });
      const sourceBytes = await readFile(target);
      assert.equal(memory.complete, true);
      assert.equal(memory.returned_bytes, 16);
      assert.equal(
        memory.bytes_hex,
        sourceBytes
          .subarray(mapping.file_offset, mapping.file_offset + 16)
          .toString("hex"),
      );
      await call("address_name", { address: procedure.address });
      assert.equal(
        await call("procedure_address", { procedure: procedure.value }),
        procedure.address,
      );
      await call("resolve_containing_procedure", {
        address: procedure.address,
      });
      await call("search_procedures", { pattern: procedure.value });
      await call("search_strings", { pattern: "rea" });
      report.byteSearch = await verifyWindowsGhidraByteSearch({
        invoke: call,
        sourceBytes,
        imageBase: fixture.imageBase,
        sourceOwnedFixture: targetArgument === undefined,
        fallbackAddress: procedure.address,
        fallbackFileOffset: mapping.file_offset,
        runCliPage: async (query) => {
          const cliArguments = [entry, "search-bytes", target, query.pattern];
          for (const [option, value] of [
            ["--mask", query.mask],
            ["--start", query.start],
            ["--end", query.end],
            ["--limit", String(query.limit)],
          ]) {
            if (value !== undefined) cliArguments.push(option, value);
          }
          cliArguments.push("--provider", "ghidra", "--json");
          const result = await commands.exec(process.execPath, cliArguments, {
            env: environment,
            cwd: callerDirectory,
            timeout: 360_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          const evidence = JSON.parse(result.stdout);
          assert.ok(evidence.error === undefined, "CLI byte search failed");
          return evidence.normalized_result;
        },
      });
      for (const name of [
        "procedure_assembly",
        "procedure_callees",
        "procedure_callers",
        "procedure_info",
        "procedure_pseudo_code",
        "read_function_instructions",
        "procedure_references",
        "analyze_function",
      ])
        await call(name, { procedure: procedure.value });
      await call("xrefs", { address: procedure.address });
      await call("inspect_native_data_type", { type: "/undefined8" });
      await call("inspect_native_instruction", { address: procedure.address });
      await call("resolve_native_call_targets", { address: procedure.address });
      // Explicit caller-selected targets need not contain our fixture instructions.
      const controlledTargets = [
        "rea-ghidra-windows.exe",
        "rea-ghidra-windows-x86.exe",
      ].map((name) => resolve("build", "fixtures", name));
      if (controlledTargets.includes(target))
        report.compactReferences = await verifyGhidraCompactReferences(
          call,
          target === controlledTargets[1],
          async (command, address) => {
            const result = await commands.exec(
              process.execPath,
              [
                entry,
                command,
                target,
                address,
                "--provider",
                "ghidra",
                "--json",
              ],
              {
                env: environment,
                cwd: callerDirectory,
                timeout: 360_000,
                maxBuffer: 8 * 1024 * 1024,
              },
            );
            const evidence = JSON.parse(result.stdout);
            assert.ok(evidence.error === undefined, `CLI ${command} failed`);
            const contract = TOOL_CONTRACTS.find(
              ({ name }) => name === command.replaceAll("-", "_"),
            );
            assert.ok(contract, `Missing CLI ${command} contract`);
            contract.outputSchema.parse(evidence);
            return evidence.normalized_result;
          },
        );
      const { GHIDRA_MUTATING_OPERATIONS } = await import(
        pathToFileURL(join(packageRoot, "dist/ghidra/GhidraSessionValues.js"))
      );
      const { GHIDRA_OPERATIONS } = await import(
        pathToFileURL(
          join(packageRoot, "dist/ghidra/GhidraProviderCapabilities.js"),
        )
      );
      const expected = GHIDRA_OPERATIONS.filter(
        (name) => !GHIDRA_MUTATING_OPERATIONS.has(name),
      );
      const expectedOperations = new Set([
        ...expected,
        "open_binary",
        "binary_overview",
        "binary_session",
        "close_binary",
      ]);
      const observedOperations = new Set(report.mcpOperations);
      const missingOperations = expected.filter(
        (name) => !observedOperations.has(name),
      );
      const unexpectedOperations = [...observedOperations].filter(
        (name) => !expectedOperations.has(name),
      );
      assert.deepEqual(
        { missing: missingOperations, unexpected: unexpectedOperations },
        { missing: [], unexpected: [] },
        "Packaged verification operation coverage drifted.",
      );
      const session = await call("binary_session", {});
      assert.equal(
        session.analysis_provider_binding?.analysis_profile?.parameters
          ?.executable_role,
        parsedTarget.value.executableRole,
        "MCP profile must preserve the selected PE role.",
      );
      assert.equal(
        session.analysis_provider_binding?.selection_source,
        "auto-single-candidate",
        "Packaged MCP verification must exercise automatic provider selection.",
      );
      assert.equal(
        session.analysis_provider_binding?.provider?.id,
        "ghidra",
        "The sole available Windows analysis provider must be Ghidra.",
      );
      await call("close_binary", {});
      await assertCleanup();
    } catch (cause) {
      await withVerifierCleanup(
        () => Promise.reject(cause),
        [closeClient, closeTransport],
      );
    }
    await closeVerifierResources([closeClient, closeTransport]);
    assert.equal(
      digest(await readFile(target)),
      sha256,
      "Analysis modified the selected target.",
    );
    assert.deepEqual(
      native.call("process_caller_token", []),
      token,
      "Analysis changed caller token authority.",
    );
    assert.deepEqual(
      (await readdir(callerDirectory)).sort(),
      [...scriptCollisions].sort(),
    );
    for (const name of scriptCollisions)
      assert.deepEqual(await readdir(join(callerDirectory, name)), []);
    report.callerScriptCollisionsPreserved = true;
    report.runtimeCleanup = true;
    // Only the parent can attest success after removing the installation.
    if (reportArgument !== undefined)
      await writeFile(reportArgument, `${JSON.stringify(report)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (cause) {
    report.failure = {
      name: cause.name,
      message: cause.message
        .replaceAll(packageRoot, "<package>")
        .replaceAll(target, "<target>")
        .replaceAll(workspace, "<workspace>"),
    };
    if (reportArgument !== undefined)
      await writeFile(reportArgument, `${JSON.stringify(report)}\n`);
    throw cause;
  }
} catch (cause) {
  await withVerifierCleanup(() => Promise.reject(cause), [closeCommands]);
}
await closeCommands();
