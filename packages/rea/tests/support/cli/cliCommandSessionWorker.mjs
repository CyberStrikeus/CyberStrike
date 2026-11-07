import { Writable } from "node:stream";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareCliProcessEnvironment } from "../../../scripts/lib/cli-process-environment.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import {
  createCliSessionFrameReader,
  encodeCliSessionFrame,
} from "./cliCommandSessionFrames.mjs";

// One-shot command sequence matches scripts/rea.mjs. Output is captured per
// command so this process can serve the next invocation without restarting.
const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const { default: packageJson } = await import(
  new URL("../../../package.json", import.meta.url),
  { with: { type: "json" } }
);

const runtimeFiles = [
  "dist/cli-runtime/cli.js",
  "dist/cli-runtime/cliOutput.js",
  "dist/cli-runtime/cliBuiltinArguments.js",
  "dist/cli-runtime/cliResultOutput.js",
];

prepareCliProcessEnvironment(
  process.env,
  process.platform,
  packageJson.version,
);
if (!(await compiledRuntimeExists(runtimeFiles))) {
  process.stderr.write(
    `REA's compiled runtime is missing. Run \`npm ci && npm run build:cached\` in ${packageRoot} to install dependencies and build REA, then restart it. If this is an installed package, reinstall rea-agents.\n`,
  );
  process.exit(1);
}

const { closeCliResources, createCli } =
  await import("../../../dist/cli-runtime/cli.js");
const { createCliResultOutput } =
  await import("../../../dist/cli-runtime/cliResultOutput.js");
const {
  cliCompletionShell,
  normalizeCliArguments,
  splitIncurBuiltinArguments,
} = await import("../../../dist/cli-runtime/cliBuiltinArguments.js");
const {
  cliConfigurationError,
  renderCliOutputArgumentError,
  renderEmptyFilteredCliOutput,
  parseCliOutputArguments,
} = await import("../../../dist/cli-runtime/cliOutput.js");

const writeFrame = (value) =>
  new Promise((resolveWrite, rejectWrite) => {
    process.stdout.write(encodeCliSessionFrame(value), (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });

await writeFrame({ ready: true });

let chain = Promise.resolve();
// EOF drains admitted commands; failure seals input and skips commands not yet started.
/** @type {{ kind: "open" } | { kind: "ended" } | { kind: "failed", cause: unknown }} */
let completion = { kind: "open" };
/** @type {(() => void) | undefined} */
let resolveInput;
/** @type {Promise<void>} */
const inputStopped = new Promise((resolve) => {
  resolveInput = resolve;
});
const failInput = (cause) => {
  if (completion.kind !== "failed") completion = { kind: "failed", cause };
  process.stdin.pause();
  resolveInput?.();
};
process.stdin.once("end", () => {
  if (completion.kind === "open") completion = { kind: "ended" };
  resolveInput?.();
});
const reader = createCliSessionFrameReader((value) => {
  if (completion.kind !== "open") return;
  chain = chain
    .then(async () => {
      if (completion.kind !== "failed") await handle(value);
    })
    .catch(failInput);
});
process.stdin.on("data", (chunk) => {
  if (completion.kind !== "open") return;
  try {
    reader(chunk);
  } catch (cause) {
    failInput(cause);
  }
});
try {
  await withVerifierCleanup(async () => {
    await inputStopped;
    await chain;
    if (completion.kind === "failed") throw completion.cause;
  }, [closeCliResources]);
} catch (cause) {
  console.error(cause);
  process.exit(1);
}
process.exit(0);

async function handle(value) {
  const request = value;
  const savedEnv = { ...process.env };
  const savedCwd = process.cwd();
  try {
    if (
      request === null ||
      typeof request !== "object" ||
      !Array.isArray(request.arguments) ||
      typeof request.cwd !== "string" ||
      request.env === null ||
      typeof request.env !== "object"
    ) {
      throw new Error(
        "CLI session command is missing its arguments, cwd, or environment",
      );
    }
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, request.env);
    prepareCliProcessEnvironment(
      process.env,
      process.platform,
      packageJson.version,
    );
    process.chdir(request.cwd);
    const result = await runOneShot(request.arguments);
    await writeFrame({
      id: request.id,
      pid: process.pid,
      rss: process.memoryUsage().rss,
      ...result,
    });
  } catch (error) {
    failInput(error);
    const id =
      request !== null && typeof request === "object" ? request.id : undefined;
    await writeFrame({
      id,
      pid: process.pid,
      exitCode: 1,
      stdout: "",
      stderr:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      fatal: true,
    });
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    process.chdir(savedCwd);
  }
}

async function runOneShot(args) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = captureWrite(stdoutChunks);
  process.stderr.write = captureWrite(stderrChunks);
  const destination = new Writable({
    write(chunk, encoding, callback) {
      process.stdout.write(chunk, encoding, callback);
    },
  });
  destination.isTTY = process.stdout.isTTY === true;
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  let explicitExit;
  try {
    const isShellCompletion = cliCompletionShell(process.env) !== undefined;
    const cliArgs = isShellCompletion ? args : normalizeCliArguments(args);
    const outputOptions = parseCliOutputArguments(
      isShellCompletion ? [] : cliArgs,
    );
    const outputArguments = outputOptions.validation;
    const configurationError = cliConfigurationError(process.env);
    if (
      configurationError !== undefined &&
      (isShellCompletion ||
        splitIncurBuiltinArguments(cliArgs).command[0] !== "doctor")
    ) {
      process.stderr.write(`${configurationError}\n`);
      process.exitCode = 1;
    } else if (!outputArguments.ok) {
      process.stdout.write(renderCliOutputArgumentError(outputArguments));
      process.exitCode = 1;
    } else {
      let wroteOutput = false;
      const resultOutput = createCliResultOutput(outputOptions, destination);
      try {
        await createCli(process.env, resultOutput).serve(cliArgs, {
          stdout: (output) => {
            if (resultOutput?.handled) {
              if (resultOutput.failed) process.stderr.write(output);
              return;
            }
            if (output.length > 0) wroteOutput = true;
            if (resultOutput?.captureSdkOutput(output)) return;
            process.stdout.write(output);
          },
          exit: (code) => {
            explicitExit = code;
          },
        });
      } catch (cause) {
        if (wroteOutput) throw cause;
        const recovered = await resultOutput?.recoverFormattingFailure(cause);
        if (!recovered) throw cause;
        process.exitCode = 1;
      }
      if (!wroteOutput && !resultOutput?.handled) {
        const empty = renderEmptyFilteredCliOutput(outputOptions);
        if (empty) process.stdout.write(empty);
      }
      await resultOutput?.finishSdkOutput(
        explicitExit ??
          (typeof process.exitCode === "number" ? process.exitCode : 0),
      );
    }
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  const exitCode =
    explicitExit ??
    (typeof process.exitCode === "number" ? process.exitCode : 0);
  process.exitCode = previousExitCode;
  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

function captureWrite(chunks) {
  return function patched(chunk, encoding, callback) {
    const encodingName = typeof encoding === "string" ? encoding : "utf8";
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encodingName),
    );
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") done();
    return true;
  };
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
