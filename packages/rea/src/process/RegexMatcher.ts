import { analysisSettingLimit } from "../domain/analysisSettingDefinitions.js";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { z } from "zod";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  REGEX_MATCHING_DEADLINE_SETTING,
  regexMatchingDeadlineRecovery,
  type RegexMatchingDeadline,
} from "../config/regexMatchingDeadline.js";
import {
  DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  REGEX_WORKER_HEAP_REQUEST_SETTING,
  regexWorkerHeapRequestRecovery,
  type RegexWorkerHeapRequest,
} from "../config/regexWorkerHeapRequest.js";
/**
 * Node's Worker `resourceLimits.maxOldGenerationSizeMb` request.
 * `REA_REGEX_WORKER_HEAP_REQUEST_MIB` is that request (default 128 MiB). A positive
 * `--max-old-space-size` on the process that starts REA, including
 * `NODE_OPTIONS`, overrides it. A zero or empty value leaves this request
 * in effect. `NODE_OPTIONS` is applied before `process.execArgv`, and the
 * last absolute flag wins. That environment value is not copied into `execArgv`.
 *
 * `--max-old-space-size-percentage` is applied after both sources and takes
 * precedence over the absolute flag in either order. Node turns it into a MiB
 * from constrained or total memory while parsing options. That base can change
 * before user code reads it, and some Node versions also cap total memory at
 * 4 GiB when pointer compression is on. A later read is not the value Node
 * applied, so a percentage flag leaves the effective heap unestablished
 * instead of the worker heap request or an absolute flag.
 *
 * `process.env.NODE_OPTIONS` is not that launch value. A preload can clear or
 * rewrite it after V8 has already applied the original flags, and those flags
 * are not copied into `process.execArgv`. The launch string is the
 * `NODE_OPTIONS` entry in the process initial environment when that block can
 * be read. Otherwise the effective heap stays unestablished.
 *
 * `process.execArgv` is mutable in the same way. A preload can empty it after
 * V8 has applied `--max-old-space-size`. Linux keeps the original tokens in
 * `/proc/self/cmdline` until `process.title` or `--title` overwrites that
 * same memory with the title. The recovered list skips the executable and the
 * program entry the way Node builds `execArgv`, and it stops at `--`. A
 * buffer without a program entry is not an empty option list. When that block
 * cannot be read, the entry cannot be established, or the platform has no
 * equivalent block, the effective heap stays unestablished. The mutable array
 * is not a fallback.
 *
 * `--max-heap-size` is the total heap, not the old generation. A positive
 * value can be lower than the worker heap request and still changes the result
 * when an old-space flag is also present. The old generation stays
 * unestablished while that value is in effect. Zero or empty clears it.
 * Node 24 and later also accept the flag in `NODE_OPTIONS`.
 *
 * `--experimental-config-file` and `--experimental-default-config-file` can
 * set `nodeOptions`, including a heap percentage, from a file. That file is
 * not launch provenance, and it can add heap options when `NODE_OPTIONS` was
 * already set. Either flag leaves the old generation unestablished. Node
 * accepts the config path as `=` or the next argument. Underscore spellings
 * are not these flags.
 */
const OLD_SPACE_FLAG = /^--max[-_]old[-_]space[-_]size(?:=(.*))?$/u;
const OLD_SPACE_PERCENT_FLAG =
  /^--max[-_]old[-_]space[-_]size[-_]percentage(?:=.*)?$/u;
const MAX_HEAP_FLAG = /^--max[-_]heap[-_]size(?:=(.*))?$/u;
/**
 * Node applies `NODE_OPTIONS` from `--env-file` / `--env-file-if-exists` only
 * when the variable was absent. The file is not in `/proc/self/environ`, and a
 * later read is not the startup contents. Underscore spellings are not this flag.
 */
const ENV_FILE_FLAG = /^--env-file(?:-if-exists)?(?:=.*)?$/u;
/** Path form and the boolean default-file flag. The file itself is not read. */
const CONFIG_FILE_FLAG = /^--experimental-(?:default-)?config-file(?:=.*)?$/u;

/** Old-generation heap the regex worker will actually hit. */
export type RegexWorkerHeapLimit =
  | {
      readonly kind: "effective";
      readonly mib: number;
      /** True when a positive `--max-old-space-size` overrides the worker heap request. */
      readonly overridden: boolean;
    }
  | { readonly kind: "unknown" };

/** Node's `ParseNodeOptionsEnvVar`: quotes group tokens and are not part of them. */
const nodeOptionsArgv = (
  nodeOptions: string,
): readonly string[] | undefined => {
  const argv: string[] = [];
  let inString = false;
  let startNew = true;
  for (let index = 0; index < nodeOptions.length; index += 1) {
    let character = nodeOptions.charAt(index);
    if (character === "\\" && inString) {
      if (index + 1 >= nodeOptions.length) return undefined;
      index += 1;
      character = nodeOptions.charAt(index);
    } else if (character === " " && !inString) {
      startNew = true;
      continue;
    } else if (character === '"') {
      inString = !inString;
      continue;
    }
    if (startNew) {
      argv.push(character);
      startNew = false;
    } else {
      const last = argv.length - 1;
      argv[last] = `${argv[last] ?? ""}${character}`;
    }
  }
  return inString ? undefined : argv;
};

const parsedFlagMiB = (
  token: string,
  flag: RegExp,
): number | "absent" | "unrecognized" => {
  const match = flag.exec(token);
  if (match === null) return "absent";
  const raw = match[1];
  if (raw === undefined) return "unrecognized";
  if (raw === "") return 0;
  if (!/^\+?\d+$/u.test(raw)) return "unrecognized";
  const mib = Number(raw);
  return Number.isSafeInteger(mib) ? mib : "unrecognized";
};

/**
 * Derive the worker old-generation heap from launch flags the caller already
 * recovered. The raw `NODE_OPTIONS` string is not retained. This does not read
 * `process.env`.
 */
export const resolveRegexWorkerHeap = (
  execArgv: readonly string[],
  nodeOptions: string | undefined,
  request: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): RegexWorkerHeapLimit => {
  const requestedHeap = {
    kind: "effective" as const,
    mib: request.heapMiB,
    overridden: false as const,
  };
  const fromEnvironment =
    nodeOptions === undefined ? [] : nodeOptionsArgv(nodeOptions);
  const tokens = [...(fromEnvironment ?? []), ...execArgv];
  // An absent NODE_OPTIONS lets the env file supply one, including a percentage
  // that beats a later absolute flag. The file's text is not launch provenance.
  // A Node config file can inject nodeOptions even when NODE_OPTIONS was
  // recovered. The file is not read back.
  if (
    tokens.some((token) => CONFIG_FILE_FLAG.test(token)) ||
    (nodeOptions === undefined &&
      tokens.some((token) => ENV_FILE_FLAG.test(token)))
  )
    return { kind: "unknown" };
  let limit: RegexWorkerHeapLimit =
    fromEnvironment === undefined ? { kind: "unknown" } : requestedHeap;
  let percentage = false;
  let maxHeap: "clear" | "positive" | "unrecognized" = "clear";
  for (const token of tokens) {
    if (OLD_SPACE_PERCENT_FLAG.test(token)) {
      percentage = true;
      limit = { kind: "unknown" };
      continue;
    }
    // A percentage flag wins over every absolute flag, including a later one.
    if (percentage) continue;
    const totalHeap = parsedFlagMiB(token, MAX_HEAP_FLAG);
    if (totalHeap === "unrecognized") {
      maxHeap = "unrecognized";
      continue;
    }
    if (totalHeap !== "absent") {
      if (maxHeap !== "unrecognized")
        maxHeap = totalHeap > 0 ? "positive" : "clear";
      continue;
    }
    const parsed = parsedFlagMiB(token, OLD_SPACE_FLAG);
    if (parsed === "absent") continue;
    if (parsed === "unrecognized") {
      limit = { kind: "unknown" };
      continue;
    }
    limit =
      parsed > 0
        ? { kind: "effective", mib: parsed, overridden: true }
        : requestedHeap;
  }
  // A positive total-heap cap is not an old-generation size. Zero clears it
  // and leaves the old-space result. An unparsed value does not.
  return maxHeap === "clear" ? limit : { kind: "unknown" };
};

/** Provenance of the `NODE_OPTIONS` value Node applied before user code ran. */
export type LaunchNodeOptions =
  | { readonly kind: "recovered"; readonly value: string | undefined }
  | { readonly kind: "unrecoverable" };

const nodeOptionsKey = Buffer.from("NODE_OPTIONS=");

/** First `NODE_OPTIONS` entry, matching `getenv`. The surrounding block is not retained. */
const nodeOptionsFromEnviron = (
  raw: Buffer,
): string | undefined | "invalid" => {
  let offset = 0;
  while (offset < raw.length) {
    const end = raw.indexOf(0, offset);
    const entryEnd = end === -1 ? raw.length : end;
    const entry = raw.subarray(offset, entryEnd);
    if (
      entry.length >= nodeOptionsKey.length &&
      entry.subarray(0, nodeOptionsKey.length).equals(nodeOptionsKey)
    ) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(
          entry.subarray(nodeOptionsKey.length),
        );
      } catch {
        return "invalid";
      }
    }
    if (end === -1) break;
    offset = end + 1;
  }
  return undefined;
};

/**
 * Linux keeps the `execve` environment in `/proc/self/environ` after
 * `process.env` is rewritten. Other platforms have no equivalent immutable
 * block, so the launch value stays unrecoverable there.
 */
export const readLaunchNodeOptions = (): LaunchNodeOptions => {
  if (process.platform !== "linux") return { kind: "unrecoverable" };
  let raw: Buffer;
  try {
    raw = readFileSync("/proc/self/environ");
  } catch {
    return { kind: "unrecoverable" };
  }
  const value = nodeOptionsFromEnviron(raw);
  return value === "invalid"
    ? { kind: "unrecoverable" }
    : { kind: "recovered", value };
};

/**
 * Node options that take the next command-line token when it is not `=`.
 * Boolean flags and V8 flags do not. Names are the dashed form Node looks up
 * after replacing `_`. An option absent from both sets, followed by the
 * program entry, leaves the boundary unrecoverable.
 */
const VALUE_OPTION_NAMES =
  "--allow-fs-read,--allow-fs-write,--build-sea,--build-snapshot-config,--conditions,--cpu-prof-dir,--cpu-prof-interval,--cpu-prof-name,--debug-port,--diagnostic-dir,--disable-proto,--disable-warning,--dns-result-order,--env-file,--env-file-if-exists,--eval,--experimental-config-file,--experimental-default-type,--experimental-loader,--experimental-sea-config,--experimental-test-isolation,--heap-prof-dir,--heap-prof-interval,--heap-prof-name,--heapsnapshot-near-heap-limit,--heapsnapshot-signal,--icu-data-dir,--import,--input-type,--inspect-port,--inspect-publish-uid,--loader,--localstorage-file,--max-http-header-size,--max-old-space-size-percentage,--network-family-autoselection-attempt-timeout,--openssl-config,--print,--redirect-warnings,--report-dir,--report-directory,--report-filename,--report-signal,--require,--run,--secure-heap,--secure-heap-min,--snapshot-blob,--test-concurrency,--test-coverage-branches,--test-coverage-exclude,--test-coverage-functions,--test-coverage-include,--test-coverage-lines,--test-global-setup,--test-isolation,--test-name-pattern,--test-reporter,--test-reporter-destination,--test-shard,--test-skip-pattern,--test-timeout,--title,--tls-cipher-list,--tls-keylog,--trace-event-categories,--trace-event-file-pattern,--trace-require-module,--unhandled-rejections,--use-largepages,--v8-pool-size,--watch-kill-signal,--watch-path,-C,-e,-p,-pe,-r";
const FLAG_OPTION_NAMES =
  "--abort-on-uncaught-exception,--allow-addons,--allow-child-process,--allow-inspector,--allow-net,--allow-wasi,--allow-worker,--build-snapshot,--check,--completion-bash,--cpu-prof,--disable-sigusr1,--disable-wasm-trap-handler,--disallow-code-generation-from-strings,--enable-etw-stack-walking,--enable-fips,--enable-network-family-autoselection,--enable-source-maps,--entry-url,--experimental-addon-modules,--experimental-async-context-frame,--experimental-default-config-file,--experimental-eventsource,--experimental-import-meta-resolve,--experimental-inspector-network-resource,--experimental-network-inspection,--experimental-permission,--experimental-print-required-tla,--experimental-quic,--experimental-storage-inspection,--experimental-stream-iter,--experimental-test-coverage,--experimental-test-module-mocks,--experimental-transform-types,--experimental-vm-modules,--experimental-webstorage,--experimental-worker-inspection,--expose-gc,--force-context-aware,--force-fips,--force-node-api-uncaught-exceptions-policy,--frozen-intrinsics,--heap-prof,--heap-snapshot-on-oom,--help,--huge-max-old-generation-size,--insecure-http-parser,--inspect,--inspect-brk,--inspect-wait,--interactive,--interpreted-frames-native-stack,--jitless,--max-heap-size,--max-old-space-size,--max-semi-space-size,--no-addons,--no-async-context-frame,--no-deprecation,--no-experimental-detect-module,--no-experimental-fetch,--no-experimental-global-customevent,--no-experimental-global-navigator,--no-experimental-global-webcrypto,--no-experimental-repl-await,--no-experimental-require-module,--no-experimental-sqlite,--no-experimental-strip-types,--no-experimental-websocket,--no-experimental-webstorage,--no-extra-info-on-fatal-exception,--no-force-async-hooks-checks,--no-global-search-paths,--no-network-family-autoselection,--no-require-module,--no-strip-types,--no-warnings,--node-memory-debug,--openssl-legacy-provider,--openssl-shared-config,--pending-deprecation,--permission,--permission-audit,--preserve-symlinks,--preserve-symlinks-main,--prof,--prof-process,--report-compact,--report-exclude-env,--report-exclude-network,--report-on-fatalerror,--report-on-signal,--report-uncaught-exception,--test,--test-force-exit,--test-only,--test-rerun-failures,--test-update-snapshots,--throw-deprecation,--tls-max-v1.2,--tls-max-v1.3,--tls-min-v1.0,--tls-min-v1.1,--tls-min-v1.2,--tls-min-v1.3,--trace-atomics-wait,--trace-deprecation,--trace-env,--trace-env-js-stack,--trace-env-native-stack,--trace-exit,--trace-promises,--trace-sigint,--trace-sync-io,--trace-tls,--trace-uncaught,--trace-warnings,--track-heap-objects,--use-bundled-ca,--use-env-proxy,--use-openssl-ca,--use-system-ca,--v8-options,--version,--watch,--watch-preserve-output,--zero-fill-buffers,-c,-h,-i,-v";
const VALUE_OPTIONS = new Set(VALUE_OPTION_NAMES.split(","));
const FLAG_OPTIONS = new Set(FLAG_OPTION_NAMES.split(","));

/** Provenance of the Node option tokens that were `process.execArgv` at start. */
export type LaunchExecArgv =
  | { readonly kind: "recovered"; readonly value: readonly string[] }
  | { readonly kind: "unrecoverable" };

const commandLineTokens = (raw: Buffer): readonly string[] | "invalid" => {
  if (raw.length === 0) return "invalid";
  const end = raw[raw.length - 1] === 0 ? raw.length - 1 : raw.length;
  const tokens: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  while (offset < end) {
    const next = raw.indexOf(0, offset);
    const tokenEnd = next === -1 || next > end ? end : next;
    try {
      tokens.push(decoder.decode(raw.subarray(offset, tokenEnd)));
    } catch {
      return "invalid";
    }
    if (next === -1 || next >= end) break;
    offset = next + 1;
  }
  return tokens.length === 0 ? "invalid" : tokens;
};

const normalizedOption = (
  token: string,
): { readonly name: string; readonly inline: boolean } => {
  if (!token.startsWith("--")) return { name: token, inline: false };
  const equals = token.indexOf("=");
  const rawName = equals === -1 ? token : token.slice(0, equals);
  return {
    name: `${rawName.slice(0, 2)}${rawName.slice(2).replaceAll("_", "-")}`,
    inline: equals !== -1,
  };
};

/** Options whose argument is the program entry rather than a script path. */
const ENTRY_OPTIONS = new Set(["-e", "--eval", "-p", "--print", "-pe"]);

/**
 * Node option tokens from an `execve` command line. The executable and the
 * program entry are omitted. `--` ends the list and is omitted. A title
 * overwrite leaves one token and null padding, which has no program entry.
 * The buffer is not retained.
 */
export const execArgvFromCommandLine = (raw: Buffer): LaunchExecArgv => {
  const tokens = commandLineTokens(raw);
  if (tokens === "invalid" || tokens.length === 0 || tokens[0] === "")
    return { kind: "unrecoverable" };
  const exec: string[] = [];
  let sawEntry = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.length === 0) return { kind: "unrecoverable" };
    if (token === "--") {
      const entry = tokens[index + 1];
      if (entry === undefined || entry.length === 0)
        return { kind: "unrecoverable" };
      sawEntry = true;
      break;
    }
    if (token === "-" || !token.startsWith("-")) {
      sawEntry = true;
      break;
    }
    exec.push(token);
    const option = normalizedOption(token);
    const entryOption = ENTRY_OPTIONS.has(option.name);
    if (option.inline) {
      if (entryOption) sawEntry = true;
      continue;
    }
    if (VALUE_OPTIONS.has(option.name)) {
      const value = tokens[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-"))
        return { kind: "unrecoverable" };
      exec.push(value);
      index += 1;
      if (entryOption) sawEntry = true;
      continue;
    }
    if (FLAG_OPTIONS.has(option.name)) continue;
    const next = tokens[index + 1];
    if (next !== undefined && (next.length === 0 || !next.startsWith("-")))
      return { kind: "unrecoverable" };
  }
  // No script, eval string, or stdin entry. A title-only buffer looks like this.
  if (!sawEntry) return { kind: "unrecoverable" };
  return { kind: "recovered", value: exec };
};

/**
 * Linux keeps the `execve` argument vector in `/proc/self/cmdline` after
 * `process.execArgv` is rewritten. `process.title` and `--title` overwrite
 * that vector. Other platforms have no equivalent immutable block, so the
 * launch options stay unrecoverable there.
 */
export const readLaunchExecArgv = (): LaunchExecArgv => {
  if (process.platform !== "linux") return { kind: "unrecoverable" };
  let raw: Buffer;
  try {
    raw = readFileSync("/proc/self/cmdline");
  } catch {
    return { kind: "unrecoverable" };
  }
  return execArgvFromCommandLine(raw);
};

/** Heap for this process. Unrecoverable launch provenance stays unknown. */
export const resolveLaunchRegexWorkerHeap = (
  launchExecArgv: LaunchExecArgv,
  launchNodeOptions: LaunchNodeOptions,
  request: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): RegexWorkerHeapLimit =>
  launchExecArgv.kind === "unrecoverable" ||
  launchNodeOptions.kind === "unrecoverable"
    ? { kind: "unknown" }
    : resolveRegexWorkerHeap(
        launchExecArgv.value,
        launchNodeOptions.value,
        request,
      );

const launchExecArgv = readLaunchExecArgv();
const launchNodeOptions = readLaunchNodeOptions();

const launchRegexWorkerHeap = resolveLaunchRegexWorkerHeap(
  launchExecArgv,
  launchNodeOptions,
);

const heapBound = (
  heap: RegexWorkerHeapLimit,
  request: RegexWorkerHeapRequest,
): string => {
  const recovery = regexWorkerHeapRequestRecovery(request);
  if (heap.kind === "unknown")
    return `The worker requests ${String(request.heapMiB)} MiB. The effective old-generation heap was not established from the launch flags. --max-old-space-size, --max-old-space-size-percentage, --max-heap-size, --env-file, --env-file-if-exists, --experimental-config-file, and --experimental-default-config-file can change that request. ${recovery}`;
  const override = `A positive Node --max-old-space-size, including NODE_OPTIONS, overrides the ${String(request.heapMiB)} MiB worker request`;
  return heap.overridden
    ? `${override} and sets this process's effective heap to ${String(heap.mib)} MiB. ${recovery}`
    : `${override}. This process has no positive override, so the effective heap is ${String(heap.mib)} MiB. ${recovery}`;
};

/**
 * Capability text for the supervised ECMAScript matching boundary: the
 * effective budgets, their sources, and where to change them. Providers repeat
 * it per search operation, so setting bounds and step-by-step recovery stay
 * with the deadline and heap errors instead.
 */
export const regexMatchingLimitation = (
  heap: RegexWorkerHeapLimit,
  deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
  request: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): string => {
  const requested = `${String(request.heapMiB)} MiB worker heap request (source ${request.source})`;
  const heapText =
    heap.kind === "unknown"
      ? `a ${requested}; launch heap flags can change the effective old-generation heap, which was not established`
      : heap.overridden
        ? `an effective ${String(heap.mib)} MiB old-generation heap set by a positive Node --max-old-space-size over its ${requested}`
        : `an effective ${String(heap.mib)} MiB old-generation heap from its ${requested}`;
  return `Regex mode uses ECMAScript Unicode semantics in a cancellable worker with a ${String(deadline.deadlineMs)} ms matching deadline (source ${deadline.source}) and ${heapText}. inspect_analysis_settings and update_analysis_settings read and change regex.matching_deadline_ms and regex.worker_heap_request_mib; ${REGEX_MATCHING_DEADLINE_SETTING} and ${REGEX_WORKER_HEAP_REQUEST_SETTING} seed them at launch. Deadline and heap errors report the bounds and recovery. Matching failure leaves the service available.`;
};

/** Capability text for this process's launch heap, deadline, and heap request. */
export const launchRegexMatchingLimitation = (
  deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
  request: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): string =>
  regexMatchingLimitation(
    resolveLaunchRegexWorkerHeap(launchExecArgv, launchNodeOptions, request),
    deadline,
    request,
  );

/**
 * Capability text for the default deadline on this process's launch heap.
 * Providers that resolved `REA_REGEX_MATCHING_DEADLINE_MS` pass that value to
 * `launchRegexMatchingLimitation` instead of this constant.
 */
export const REGEX_MATCHING_LIMITATION = launchRegexMatchingLimitation();

/** Supervised regex deadline. The worker heap is a separate, launch-flag-sensitive cap. */
export const regexMatchingDeadlineError = (
  operation: string,
  deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
): AnalysisResourceConstraintError =>
  new AnalysisResourceConstraintError(
    operation,
    "cpu",
    `Regex matching exceeded its supervised deadline of ${String(deadline.deadlineMs)} ms (source ${deadline.source}). ${regexMatchingDeadlineRecovery(deadline)} The service remains available.`,
    {
      matching_deadline_ms: deadline.deadlineMs,
      matching_deadline_source: deadline.source,
    },
    {
      limit: analysisSettingLimit(
        "regex.matching_deadline_ms",
        deadline.deadlineMs,
        deadline.source,
      ),
      remediationAction: `${regexMatchingDeadlineRecovery(deadline)} Simplify the ECMAScript Unicode regex or use literal mode, then retry in the same session.`,
    },
  );

/** Regex worker heap at the effective old-generation limit, which a launch flag can change. */
export const regexWorkerHeapError = (
  operation: string,
  cause: Error,
  heap: RegexWorkerHeapLimit = launchRegexWorkerHeap,
  request: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
): AnalysisResourceConstraintError =>
  new AnalysisResourceConstraintError(
    operation,
    "memory",
    heap.kind === "effective"
      ? `Regex worker exhausted its effective ${String(heap.mib)} MiB old-generation heap.`
      : "Regex worker exhausted its old-generation heap. The effective heap was not established.",
    heap.kind === "effective"
      ? {
          worker_heap_mib: heap.mib,
          requested_worker_heap_mib: request.heapMiB,
          requested_worker_heap_source: request.source,
        }
      : {
          requested_worker_heap_mib: request.heapMiB,
          requested_worker_heap_source: request.source,
        },
    {
      cause,
      ...(heap.kind === "effective" && !heap.overridden
        ? {
            limit: analysisSettingLimit(
              "regex.worker_heap_request_mib",
              request.heapMiB,
              request.source,
            ),
          }
        : {}),
      remediationAction: `${heapBound(heap, request)} Use update_analysis_settings with setting regex.worker_heap_request_mib to change the request for the next worker; launch heap flags can override it. Restart REA after changing --max-old-space-size or ${REGEX_WORKER_HEAP_REQUEST_SETTING} in the launch environment. A launch --max-old-space-size-percentage takes precedence over that flag in either order. Simplify the pattern or use literal mode.`,
    },
  );
const replySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("matched"),
    indices: z.array(z.int().nonnegative()),
  }),
  z.strictObject({ status: z.literal("invalid_pattern"), reason: z.string() }),
]);

// Code is constant; caller patterns and target strings cross only workerData.
const WORKER_SOURCE = String.raw`
(async () => {
const { parentPort, workerData } = await import("node:worker_threads");
let expression;
try {
  expression = new RegExp(workerData.pattern, workerData.caseSensitive ? "u" : "iu");
} catch (cause) {
  parentPort.postMessage({ status: "invalid_pattern", reason: cause instanceof Error ? cause.message : String(cause) });
}
if (expression !== undefined) {
  const indices = [];
  for (const [index, value] of workerData.values.entries())
    if (expression.test(value)) indices.push(index);
  parentPort.postMessage({ status: "matched", indices });
}
})();
`;

/** Match an inventory off the service thread, and prove worker exit before returning. */
export const matchRegexValues = async (input: {
  readonly operation: string;
  readonly pattern: string;
  readonly caseSensitive: boolean;
  readonly values: readonly string[];
  readonly signal?: AbortSignal | undefined;
  readonly invalidPattern?: (reason: string) => AnalysisError;
  /** Resolved deadline. Omitted means the 5000 ms default, not ambient `process.env`. */
  readonly deadline?: RegexMatchingDeadline | undefined;
  /** Resolved heap request. Omitted means the 128 MiB default, not ambient `process.env`. */
  readonly heapRequest?: RegexWorkerHeapRequest | undefined;
}): Promise<Result<readonly number[], AnalysisError>> => {
  const deadline = input.deadline ?? DEFAULT_REGEX_MATCHING_DEADLINE;
  const heapRequest = input.heapRequest ?? DEFAULT_REGEX_WORKER_HEAP_REQUEST;
  if (input.signal?.aborted)
    return err(
      new AnalysisCancelledError(input.operation, {
        cause: input.signal.reason,
      }),
    );
  let worker: Worker;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        pattern: input.pattern,
        caseSensitive: input.caseSensitive,
        values: input.values,
      },
      resourceLimits: { maxOldGenerationSizeMb: heapRequest.heapMiB },
    });
  } catch (cause: unknown) {
    return err(
      new AnalysisOutputError(input.operation, "Cannot start regex worker", {
        cause,
      }),
    );
  }
  try {
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: Result<readonly number[], AnalysisError>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () =>
        finish(
          err(
            new AnalysisCancelledError(input.operation, {
              cause: input.signal?.reason,
            }),
          ),
        );
      const timer = setTimeout(
        () =>
          finish(err(regexMatchingDeadlineError(input.operation, deadline))),
        deadline.deadlineMs,
      );
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
      worker.once("message", (message: unknown) => {
        const reply = replySchema.safeParse(message);
        if (!reply.success)
          return finish(
            err(
              new AnalysisOutputError(
                input.operation,
                "Regex worker reply is malformed",
              ),
            ),
          );
        if (reply.data.status === "invalid_pattern")
          return finish(
            err(
              input.invalidPattern?.(reply.data.reason) ??
                new AnalysisInputError(
                  input.operation,
                  {
                    userMessage: `Invalid regex pattern: ${reply.data.reason}`,
                  },
                  [
                    {
                      path: ["pattern"],
                      reason: "invalid_format",
                      message: "Supply a valid regular expression.",
                    },
                  ],
                ),
            ),
          );
        if (
          reply.data.indices.some(
            (index, position, indices) =>
              index >= input.values.length ||
              (position > 0 && index <= (indices[position - 1] ?? -1)),
          )
        )
          return finish(
            err(
              new AnalysisOutputError(
                input.operation,
                "Regex worker returned invalid inventory indices",
              ),
            ),
          );
        finish(ok(reply.data.indices));
      });
      worker.once("error", (cause: Error & { code?: string }) =>
        finish(
          err(
            cause.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? regexWorkerHeapError(
                  input.operation,
                  cause,
                  resolveLaunchRegexWorkerHeap(
                    launchExecArgv,
                    launchNodeOptions,
                    heapRequest,
                  ),
                  heapRequest,
                )
              : new AnalysisOutputError(
                  input.operation,
                  `Regex worker failed: ${cause.message}`,
                  { cause },
                ),
          ),
        ),
      );
      worker.once("exit", (code) =>
        finish(
          err(
            new AnalysisOutputError(
              input.operation,
              `Regex worker exited without a result (${String(code)})`,
            ),
          ),
        ),
      );
    });
  } finally {
    await worker.terminate();
  }
};
