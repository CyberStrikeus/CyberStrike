#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { inspectVerifierGhidraInstallation } from "./lib/ghidra-installation-inspection.mjs";
import { cleanupOwnedProcessGroup } from "../dist/process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../dist/process/ProviderProcess.js";
import { requireMcpOperationResult } from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const execute = promisify(execFile);
const run = createVerifierRun();
const installation = await inspectVerifierGhidraInstallation({
  environment: process.env,
  installDir: process.env.GHIDRA_INSTALL_DIR,
  javaHome: process.env.JAVA_HOME,
});
if (process.platform !== "darwin" || installation.status !== "available")
  throw new Error(
    "verify:ghidra:swift requires macOS, Ghidra 12.1.4 with its native decompiler, and JDK 21; set GHIDRA_INSTALL_DIR and JAVA_HOME.",
  );
try {
  await execute("swiftc", ["--version"], { timeout: 10_000 });
} catch (cause) {
  throw new Error(
    "verify:ghidra:swift requires the host Swift compiler (swiftc).",
    { cause },
  );
}
const root = await mkdtemp(join(tmpdir(), "rea-ghidra-swift-"));
const client = new Client({ name: "ghidra-swift-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./rea.mjs", import.meta.url)), "mcp"],
  env: Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ),
  stderr: "pipe",
});
const source = fileURLToPath(
  new URL("../tests/conformance/swift/type-inventory.swift", import.meta.url),
);
const literalSource = fileURLToPath(
  new URL("../tests/conformance/swift/string-literals.swift", import.meta.url),
);
const binary = join(root, "swift-inventory");
const literalBinary = join(root, "swift-literals");
// swiftc rejects assembly inputs, so each source is assembled to an object first.
const literalObjects = ["decoder-safeguards.S", "unresolved-string-jump.s"].map(
  (name) => ({
    source: fileURLToPath(
      new URL(`../tests/conformance/swift/${name}`, import.meta.url),
    ),
    object: join(root, name.replace(/\.[sS]$/u, ".o")),
  }),
);
const reports = [];
let literalReport;
let decoderCleaned = true;
try {
  await execute("swiftc", ["-O", "-g", source, "-o", binary], {
    timeout: 60_000,
  });
  await mkdir(join(root, "copied"));
  const copied = join(root, "copied", "swift-inventory");
  await copyFile(binary, copied);
  // Decoding covers AArch64 register pairs, so build that slice on any Mac host.
  for (const { source: assembly, object } of literalObjects)
    await execute(
      "xcrun",
      [
        "clang",
        "-target",
        "arm64-apple-macosx13.0",
        "-c",
        assembly,
        "-o",
        object,
      ],
      { timeout: 60_000 },
    );
  await execute(
    "swiftc",
    [
      "-O",
      "-target",
      "arm64-apple-macosx13.0",
      literalSource,
      ...literalObjects.map(({ object }) => object),
      "-o",
      literalBinary,
    ],
    { timeout: 60_000 },
  );
  await verifyDecoderSafeguards();
  await client.connect(transport);
  for (const [variant, path] of [
    ["debug", binary],
    ["without-dsym", copied],
  ]) {
    await call("open_binary", { path, provider_id: "ghidra" });
    try {
      const procedures = await call("list_procedures", {});
      const inventory = await call("analyze_swift_types", {});
      assert(
        inventory.total > 0,
        "Swift procedures disappeared from the inventory",
      );
      assert(
        inventory.categories.other.count > 0,
        "Top-level Swift symbols were lost",
      );
      const structs = await call("analyze_swift_types", {
        category: "structs",
      });
      assert(
        structs.categories.structs.count > 0,
        "Modern struct symbols were lost",
      );
      const metadata = await call("analyze_swift_types", {
        category: "structs",
        pattern: "VMa",
      });
      assert.equal(
        metadata.total,
        2,
        "Pair and Scorer metadata accessors must both be classified",
      );
      const pair = await call("analyze_swift_types", {
        category: "structs",
        pattern: "Pair",
      });
      assert(pair.total > 0, "Literal name filtering lost Pair symbols");
      const unresolved = await call("analyze_swift_types", {
        category: "structs",
        pattern: "swiftIndirect",
      });
      assert(
        unresolved.unclassified.length > 0,
        "Unsupported categories must remain explicit",
      );
      const entries = Object.values(inventory.categories).flatMap(
        (category) => category.items,
      );
      assert.equal(
        new Set(entries.map((entry) => entry.name)).size,
        inventory.total,
      );
      assert(
        !entries.some(
          (entry) =>
            entry.name === "entry" || entry.name === "_swift_allocObject",
        ),
      );
      for (const entry of entries)
        assert(
          procedures.some(
            (procedure) =>
              procedure.address === entry.address &&
              procedure.value === entry.name,
          ),
        );
      reports.push({
        variant,
        total: inventory.total,
        structs: structs.total,
        metadata_accessors: metadata.total,
        unclassified: inventory.unclassified.length,
      });
    } finally {
      await call("close_binary", {});
    }
  }
  literalReport = await verifyStringLiterals();
} finally {
  await client.close();
  await transport.close();
  if (decoderCleaned) await rm(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "ghidra",
      fixtures: reports,
      swift_string_literals: literalReport,
      verifier_run: await completeVerifierRun(run),
    },
    null,
    2,
  ),
);

async function call(name, arguments_) {
  const response = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 180_000 },
  );
  if (name === "analyze_swift_types")
    assert.ok(response.structuredContent, `${name} omitted structured result`);
  return requireMcpOperationResult(response, name);
}

// Literal text lives only in register constants, so it must come from the decoded pairs.
async function verifyStringLiterals() {
  await call("open_binary", { path: literalBinary, provider_id: "ghidra" });
  try {
    const procedures = await call("list_procedures", {});
    const expected = {
      smallLiteral: [["SleepDisabled", "small"]],
      largeLiteral: [["The power setting could not be changed.", "large"]],
      unicodeLiterals: [
        ["café", "small"],
        ["Résumé of the naïve décor, written twice", "large"],
      ],
      emptyAndControlLiterals: [
        ["", "small"],
        ["tab\there", "small"],
      ],
      returnedLiteral: [["Holding awake", "small"]],
    };
    const decoded = {};
    for (const [name, literals] of Object.entries(expected)) {
      const procedure = procedures.find(({ value }) => value.includes(name));
      assert(procedure, `${name} is missing from the procedure inventory`);
      const dossier = await call("analyze_function", {
        procedure: procedure.address,
        detail: "complete",
      });
      const observed = dossier.swift_string_literals;
      assert(Array.isArray(observed), `${name} recorded no Swift literals`);
      assert.deepEqual(dossier.swift_string_literal_omissions, []);
      assert.deepEqual(
        observed.map(({ value, representation }) => [value, representation]),
        literals,
      );
      for (const literal of observed) {
        assert.deepEqual(literal.registers, ["x0", "x1"]);
        assert.equal(
          literal.address === null,
          literal.representation === "small",
          `${literal.value} storage does not match its representation`,
        );
      }
      decoded[name] = observed.length;
    }
    const unresolvedJump = procedures.find(({ value }) =>
      value.includes("rea_unresolved_string_jump"),
    );
    assert(
      unresolvedJump,
      "unresolved jump fixture is missing from the procedure inventory",
    );
    const unresolvedDossier = await call("analyze_function", {
      procedure: unresolvedJump.address,
      detail: "complete",
    });
    assert.deepEqual(unresolvedDossier.swift_string_literals, []);
    assert.deepEqual(
      unresolvedDossier.swift_string_literal_omissions.map(
        ({ reason }) => reason,
      ),
      ["unresolved_jump"],
    );
    decoded.unresolvedStringJump =
      unresolvedDossier.swift_string_literal_omissions.length;
    return decoded;
  } finally {
    await call("close_binary", {});
  }
}

// Exercise the Java producer inside an ephemeral Ghidra database. The explicit
// budget seam makes exhaustion deterministic without exposing a runtime option.
async function verifyDecoderSafeguards() {
  const scripts = join(root, "decoder-scripts");
  await mkdir(scripts);
  const bridgeSources = fileURLToPath(
    new URL("../bridge/ghidra/", import.meta.url),
  );
  for (const name of await readdir(bridgeSources)) {
    if (name.endsWith(".java"))
      await copyFile(join(bridgeSources, name), join(scripts, name));
  }
  await copyFile(
    fileURLToPath(
      new URL(
        "../tests/conformance/swift/ReaSwiftDecoderRegressions.java",
        import.meta.url,
      ),
    ),
    join(scripts, "ReaSwiftDecoderRegressions.java"),
  );
  const report = join(root, "decoder-safeguards.txt");
  await runDecoderProbe(scripts, report);
  assert.equal(
    await readFile(report, "utf8"),
    "REA_SWIFT_DECODER_SAFEGUARDS_OK\n",
  );
}

async function runDecoderProbe(scripts, report) {
  const controller = new AbortController();
  let interrupt;
  const interrupted = new Promise((resolve) => {
    interrupt = () => {
      controller.abort(new Error("Swift decoder probe interrupted"));
      resolve(false);
    };
  });
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let supervisor;
  let launch;
  try {
    launch = await spawnOwnedProviderProcess({
      command: installation.analyzeHeadlessPath,
      arguments: [
        root,
        "decoder-regressions",
        "-import",
        literalBinary,
        "-scriptPath",
        scripts,
        "-postScript",
        "ReaSwiftDecoderRegressions.java",
        report,
        "-deleteProject",
        "-max-cpu",
        "2",
      ],
      runId: run.run_id,
      expectedCommand: null,
      env: { JAVA_HOME: installation.javaHome },
      signal: controller.signal,
    });
    decoderCleaned = false;
    supervisor = new ProviderProcessSupervisor(
      {
        ...launch,
        ownsProcessLifetime: true,
        cleanup: () => cleanupOwnedProcessGroup(launch.ownership),
      },
      { maxDiagnosticBytes: 8 * 1024 * 1024 },
    );
    assert.ok(
      await Promise.race([supervisor.waitForExit(120_000), interrupted]),
      controller.signal.aborted
        ? "Swift decoder probe interrupted"
        : "Swift decoder probe timed out",
    );
    assert.ok(
      await supervisor.waitForOutputClose(1_000),
      "Swift decoder probe output did not close",
    );
    const snapshot = supervisor.snapshot();
    assert.equal(
      snapshot.exitCode,
      0,
      `${snapshot.stdout.text}\n${snapshot.stderr.text}`,
    );
    assert.ok(
      !snapshot.diagnosticTruncated,
      "Swift decoder probe exceeded its diagnostic capacity",
    );
  } finally {
    try {
      if (supervisor !== undefined) {
        const stopped = await supervisor.stop();
        decoderCleaned = stopped.status === "verified-cleanup";
        assert.ok(
          decoderCleaned,
          `Owned Ghidra cleanup incomplete; retained ${root}: ${JSON.stringify(stopped)}`,
        );
      } else if (launch !== undefined) {
        const stopped = await cleanupOwnedProcessGroup(launch.ownership);
        decoderCleaned = stopped.cleaned;
        assert.ok(
          decoderCleaned,
          `Owned Ghidra cleanup incomplete; retained ${root}: ${JSON.stringify(stopped)}`,
        );
      }
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
}
