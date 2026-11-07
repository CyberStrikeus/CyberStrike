#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareCliProcessEnvironment } from "./lib/cli-process-environment.mjs";

// Route production MCP before importing Incur. Incur owns registration helpers
// such as `mcp add`, while the MCP runtime serves the tool catalog over stdio
// or, with `--http`, over streamable HTTP.
const args = process.argv.slice(2);
const { default: packageJson } = await import("../package.json", {
  with: { type: "json" },
});
prepareCliProcessEnvironment(
  process.env,
  process.platform,
  packageJson.version,
);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtinArgumentRuntime = "dist/cli-runtime/cliBuiltinArguments.js";
const builtinArguments = (await compiledRuntimeExists([builtinArgumentRuntime]))
  ? await import("../dist/cli-runtime/cliBuiltinArguments.js")
  : undefined;
const isShellCompletion =
  builtinArguments?.cliCompletionShell?.(process.env) !== undefined;
const doctorArguments = isShellCompletion
  ? undefined
  : builtinArguments?.productionMcpDoctorArguments(args);
const isMcpEntry =
  !isShellCompletion && (args[0] === "--mcp" || args[0] === "mcp");
const isMcpMode = isMcpEntry && args.length === 1;
const isMcpDoctorMode = doctorArguments !== undefined;
// Only flags may follow the entry: `mcp add --http` stays Incur's `mcp add`,
// while `mcp -h --http` reaches the HTTP entry's own help.
const isMcpHttpMode =
  isMcpEntry &&
  (args[1]?.startsWith("-") ?? false) &&
  args.slice(1).includes("--http");
/** Exit status of a writer terminated by SIGPIPE (128 + 13). */
const SIGPIPE_EXIT_STATUS = 141;
// Set once the reader of CLI output has closed the pipe.
let stdoutClosed = false;
const runtimeFiles = [
  builtinArgumentRuntime,
  ...(isMcpMode || isMcpHttpMode
    ? ["dist/mcp/main.js"]
    : isMcpDoctorMode
      ? ["dist/mcp/main.js", "dist/cli-runtime/mcpDoctor.js"]
      : [
          "dist/cli-runtime/cli.js",
          "dist/cli-runtime/cliOutput.js",
          "dist/cli-runtime/cliResultOutput.js",
        ]),
];

if (!(await compiledRuntimeExists(runtimeFiles))) {
  process.stderr.write(
    `REA's compiled runtime is missing. Run \`npm ci && npm run build:cached\` in ${packageRoot} to install dependencies and build REA, then restart it. If this is an installed package, reinstall rea-agents.\n`,
  );
  process.exitCode = 1;
} else if (isMcpMode) {
  const { runEntrypoint } = await import("../dist/mcp/main.js");
  await runEntrypoint();
} else if (isMcpHttpMode) {
  const { runMcpHttpEntrypoint } = await import("../dist/mcp/main.js");
  await runMcpHttpEntrypoint(args.slice(1));
} else if (isMcpDoctorMode) {
  guardClosedStdout();
  // Doctor runs outside Incur, so handle its global timing flag here. Keep a
  // token consumed by --format as a value, even when it looks like a flag.
  const outputValues = new Set(
    builtinArguments
      .splitIncurBuiltinArguments(doctorArguments)
      .outputValues.map(({ index }) => index),
  );
  const doctorCliArguments = doctorArguments.filter(
    (argument, index) => argument !== "--timings" || outputValues.has(index),
  );
  const timingRequested = doctorCliArguments.length !== doctorArguments.length;
  const started = performance.now();
  try {
    const { runProductionMcpDoctorCli } =
      await import("../dist/cli-runtime/mcpDoctor.js");
    const result = await runProductionMcpDoctorCli(doctorCliArguments, {
      dispatcherPath: fileURLToPath(import.meta.url),
      packageRoot,
      stdoutIsTerminal: process.stdout.isTTY === true,
    });
    writeStdout(result.output);
    process.exitCode = result.exitCode;
  } finally {
    if (timingRequested)
      process.stderr.write(
        `${JSON.stringify({ rea_timings: { version: 1, command_ms: Math.round(performance.now() - started) } })}\n`,
      );
  }
} else {
  const {
    cliConfigurationError,
    renderCliOutputArgumentError,
    renderEmptyFilteredCliOutput,
    renderVersionReport,
    parseCliOutputArguments,
  } = await import("../dist/cli-runtime/cliOutput.js");
  guardClosedStdout();
  const cliArgs = isShellCompletion
    ? args
    : builtinArguments.normalizeCliArguments(args);
  // Completion words are transport data, including partial output flags.
  const outputOptions = parseCliOutputArguments(
    isShellCompletion ? [] : cliArgs,
  );
  const outputArguments = outputOptions.validation;
  // `--version` with an explicit format reports the runtime as a document;
  // plain `--version` stays Incur's bare version string.
  const versionOutput = renderVersionReport(
    outputOptions,
    {
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      versions: process.versions,
      platform: process.platform,
      architecture: process.arch,
    },
    process.stdout.isTTY === true,
  );
  const configurationError = cliConfigurationError(process.env);
  let dispatchFailure;
  let closeCliResources;
  // Incur can exit from the callback below before this function returns.
  // That callback owns the status, including a closed-pipe exit of 141.
  let exiting = false;
  try {
    // Doctor is the readiness report for this failure. Other commands still stop
    // here so they do not run with an unusable log level.
    if (
      configurationError !== undefined &&
      (isShellCompletion ||
        builtinArguments.splitIncurBuiltinArguments(cliArgs).command[0] !==
          "doctor")
    ) {
      process.stderr.write(`${configurationError}\n`);
      process.exitCode = 1;
    } else if (!outputArguments.ok) {
      writeStdout(renderCliOutputArgumentError(outputArguments));
      process.exitCode = 1;
    } else if (versionOutput !== undefined) {
      writeStdout(versionOutput);
    } else {
      const cliRuntime = await import("../dist/cli-runtime/cli.js");
      closeCliResources = cliRuntime.closeCliResources;
      const { createCli } = cliRuntime;
      const { createCliResultOutput } =
        await import("../dist/cli-runtime/cliResultOutput.js");
      let wroteOutput = false;
      const resultOutput = createCliResultOutput(outputOptions, process.stdout);
      try {
        await createCli(process.env, resultOutput).serve(cliArgs, {
          stdout: (output) => {
            if (resultOutput?.handled) {
              if (resultOutput.failed && !stdoutClosed)
                process.stderr.write(output);
              return;
            }
            if (output.length > 0) wroteOutput = true;
            if (resultOutput?.captureSdkOutput(output)) return;
            writeStdout(output);
          },
          // A command failure caused by the closed pipe keeps the pipe's status.
          // Worker shutdown is shared with the dispatch finally below. A failed
          // shutdown is reported here because this callback is what exits.
          exit: (code) => {
            exiting = true;
            void (async () => {
              let status = code;
              try {
                await closeCliResources();
              } catch (cleanup) {
                process.stderr.write(
                  `Failed to close CLI resources: ${cleanupFailureText(cleanup)}\n`,
                );
                if (status === 0) status = 1;
              }
              try {
                await resultOutput?.finishSdkOutput(code);
              } catch (cause) {
                if (!stdoutClosed)
                  process.stderr.write(`${cleanupFailureText(cause)}\n`);
                if (status === 0) status = 1;
              }
              process.exit(stdoutClosed ? SIGPIPE_EXIT_STATUS : status);
            })();
          },
        });
      } catch (cause) {
        if (wroteOutput) throw cause;
        const recovered = await resultOutput
          ?.recoverFormattingFailure(cause)
          .catch((writeFailure) => {
            // Recovery writes outside Incur's command boundary. A reader that
            // declined this document keeps the same quiet SIGPIPE outcome.
            if (!stdoutClosed) throw writeFailure;
            return true;
          });
        if (!recovered) throw cause;
        process.exitCode = stdoutClosed ? SIGPIPE_EXIT_STATUS : 1;
      }
      if (!wroteOutput && !resultOutput?.handled)
        writeStdout(renderEmptyFilteredCliOutput(outputOptions) ?? "");
      // An SDK failure exits through the callback, which owns its pending write.
      if (!exiting)
        await resultOutput?.finishSdkOutput(
          typeof process.exitCode === "number" ? process.exitCode : 0,
        );
    }
  } catch (cause) {
    if (cause?.code === "EPIPE") {
      stdoutClosed = true;
      process.exitCode = SIGPIPE_EXIT_STATUS;
    }
    dispatchFailure = cause;
  } finally {
    // Serve and output rendering can throw after a worker is parked. Stop it
    // on that path too, and keep the dispatch failure when both fail.
    try {
      await closeCliResources?.();
    } catch (cleanup) {
      // The exit callback reports this same shared failure and then exits.
      if (!exiting) {
        dispatchFailure =
          dispatchFailure === undefined
            ? cleanup
            : new AggregateError(
                [dispatchFailure, cleanup],
                "CLI dispatch failed and the JavaScript analysis worker remained owned",
              );
      }
    }
  }
  if (
    !exiting &&
    dispatchFailure !== undefined &&
    !(stdoutClosed && dispatchFailure?.code === "EPIPE")
  )
    throw dispatchFailure;
}

/**
 * A reader that closes the pipe early, as `rea ... | head` does, has declined
 * the rest of the output. Stop writing without reporting a failure, and exit
 * with the status a SIGPIPE-terminated writer reports. MCP stdio keeps its own
 * client lifecycle.
 */
function cleanupFailureText(cleanup) {
  if (cleanup instanceof Error) return cleanup.stack ?? cleanup.message;
  return String(cleanup);
}

function guardClosedStdout() {
  process.stdout.on("error", (cause) => {
    if (cause?.code === "EPIPE") {
      stdoutClosed = true;
      process.exitCode = SIGPIPE_EXIT_STATUS;
      return;
    }
    // Other failures stay unhandled unless a pending JSON write reports them.
    if (process.stdout.listenerCount("error") === 1) throw cause;
  });
}

function writeStdout(output) {
  if (!stdoutClosed) process.stdout.write(output);
}

async function compiledRuntimeExists(paths) {
  for (const path of paths) {
    try {
      await access(resolve(packageRoot, path));
    } catch (cause) {
      if (isMissing(cause)) return false;
      throw cause;
    }
  }
  return true;
}

function isMissing(cause) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}
