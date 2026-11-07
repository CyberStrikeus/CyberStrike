import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const RSS_SAMPLE_INTERVAL_MS = 10;
const MAXIMUM_PROFILE_BUFFER_BYTES = 2 * 1_024 * 1_024;
const MAXIMUM_PROFILE_MODULES = 10_000;

/**
 * Measure the first usable MCP catalog through the installed process boundary.
 */
export async function measureMcpStartup({
  command,
  args,
  environment,
  policy,
}) {
  const transport = new StdioClientTransport({
    command,
    args,
    env: environment,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = boundedAppend(stderr, chunk.toString());
  });
  const rss = createLinuxRssSampler(() => transport.pid);
  const client = new Client({
    name: "package-startup-probe",
    version: "1.0.0",
  });
  const startedAt = performance.now();
  // One deadline for both phases. Each request also uses the time still left,
  // so a shorter first-catalog budget stops a pending initialize or tools/list
  // instead of waiting out that phase's own budget.
  const firstCatalog = armFirstCatalogDeadline(policy.firstCatalog, startedAt);
  rss.start();
  try {
    await awaitPhaseWithinFirstCatalog(
      policy.initialize,
      firstCatalog,
      (timeout) => client.connect(transport, { timeout }),
    );
    const initializedAt = performance.now();
    const tools = await awaitPhaseWithinFirstCatalog(
      policy.toolsList,
      firstCatalog,
      (timeout) =>
        client.listTools(undefined, {
          timeout,
        }),
    );
    const listedAt = performance.now();
    rss.stop();
    const measurement = {
      process_started_to_initialized_ms: elapsed(startedAt, initializedAt),
      initialized_to_tools_list_ms: elapsed(initializedAt, listedAt),
      process_started_to_tools_list_ms: elapsed(startedAt, listedAt),
      listed_tool_count: tools.tools.length,
      rss: rss.result(),
    };
    assertStartupBudgets(measurement, policy);
    return measurement;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `packaged MCP startup probe failed: ${detail}${stderr.length === 0 ? "" : `\n${stderr}`}`,
      { cause },
    );
  } finally {
    firstCatalog.clear();
    rss.stop();
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

/**
 * Profile ESM file loading in a separate diagnostic child.
 */
export async function profileMcpModuleLoading({
  command,
  args,
  environment,
  policy,
  packageName,
}) {
  const profile = createEsmModuleProfileCollector(packageName);
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...environment, NODE_DEBUG: "esm" },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => profile.append(chunk.toString()));
  const client = new Client({
    name: "package-module-profile",
    version: "1.0.0",
  });
  try {
    await withPhaseBudget(policy.doctor, () =>
      client.connect(transport, {
        timeout: policy.doctor.milliseconds,
      }),
    );
    await withPhaseBudget(policy.toolsList, () =>
      client.listTools(undefined, {
        timeout: policy.toolsList.milliseconds,
      }),
    );
    return profile.result();
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

/**
 * Parse Linux procfs VmRSS text into bytes.
 */
export const parseLinuxVmRssBytes = (status) => {
  const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
  return match === null ? null : Number(match[1]) * 1_024;
};

/**
 * Collect unique file-backed ESM module URLs from Node's diagnostic stream.
 */
export const createEsmModuleProfileCollector = (packageName = "rea-agents") => {
  const modules = new Set();
  let buffer = "";
  let debugLines = 0;
  let truncated = false;
  const consume = (line) => {
    if (line.startsWith("ESM ")) debugLines += 1;
    for (const match of line.matchAll(/file:\/\/\/[^\s'",}\])]+/gu)) {
      if (modules.size >= MAXIMUM_PROFILE_MODULES) {
        truncated = true;
        break;
      }
      modules.add(match[0]);
    }
  };
  return {
    append(chunk) {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAXIMUM_PROFILE_BUFFER_BYTES) {
        buffer = buffer.slice(-MAXIMUM_PROFILE_BUFFER_BYTES);
        truncated = true;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    },
    result() {
      if (buffer.length > 0) consume(buffer);
      const values = [...modules];
      const packageSegment = `/node_modules/${packageName}/`;
      return {
        supported: true,
        method: "node-debug-esm",
        unique_file_modules: values.length,
        unique_package_modules: values.filter((value) =>
          value.includes(packageSegment),
        ).length,
        unique_dependency_modules: values.filter(
          (value) =>
            value.includes("/node_modules/") && !value.includes(packageSegment),
        ).length,
        debug_lines: debugLines,
        truncated,
      };
    },
  };
};

const createLinuxRssSampler = (pid) => {
  if (process.platform !== "linux")
    return {
      start() {},
      stop() {},
      result: () => ({
        supported: false,
        method: null,
        peak_bytes: null,
      }),
    };
  let peakBytes = null;
  let timer;
  const sample = () => {
    const currentPid = pid();
    if (currentPid === null) return;
    try {
      const current = parseLinuxVmRssBytes(
        readFileSync(`/proc/${String(currentPid)}/status`, "utf8"),
      );
      if (current !== null && (peakBytes === null || current > peakBytes))
        peakBytes = current;
    } catch {
      // The short-lived child may exit between resolving its PID and reading.
    }
  };
  return {
    start() {
      sample();
      timer = setInterval(sample, RSS_SAMPLE_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      sample();
    },
    result: () => ({
      supported: true,
      method: "linux-proc-status-vmrss-sampled",
      peak_bytes: peakBytes,
    }),
  };
};

/** Same sentence as `mcpPhaseBudgetRecovery`; this script cannot import that TypeScript module. */
export const mcpStartupPhaseBudgetRecovery = (budget) =>
  [
    `The effective ${budget.setting} value for the ${budget.phase} is ${String(budget.milliseconds)} ms (source ${budget.source}; default ${String(budget.defaultMilliseconds)} ms, floor ${String(budget.floorMilliseconds)} ms, maximum ${String(budget.maximumMilliseconds)} ms).`,
    `Set ${budget.setting} in the environment that starts REA to a positive decimal integer from ${String(budget.floorMilliseconds)} to ${String(budget.maximumMilliseconds)}, then restart REA.`,
  ].join(" ");

const phaseTimeout = (cause) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.includes("Request timed out") ||
    message.includes("Maximum total timeout exceeded") ||
    message.includes("timed out")
  );
};

const withPhaseBudget = async (budget, operation) => {
  try {
    return await operation();
  } catch (cause) {
    if (!phaseTimeout(cause)) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${detail} ${mcpStartupPhaseBudgetRecovery(budget)}`, {
      cause,
    });
  }
};

const firstCatalogBudgetExceeded = (budget) =>
  new Error(
    `packaged MCP exceeded the first-catalog phase budget. ${mcpStartupPhaseBudgetRecovery(budget)}`,
  );

/**
 * Wall-clock end of the first-catalog budget, measured from the same instant
 * as the phase durations. The SDK timeout starts only once its request is
 * sent, so this timer still stops a child that has not reached that request.
 */
const armFirstCatalogDeadline = (budget, startedAt) => {
  const deadline = startedAt + budget.milliseconds;
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(
      resolve,
      Math.max(1, Math.ceil(deadline - performance.now())),
    );
  });
  return {
    budget,
    deadline,
    expired,
    clear() {
      clearTimeout(timer);
    },
  };
};

const phaseRequestTimeout = (phase, deadline) => {
  const remaining = deadline - performance.now();
  if (remaining <= 0) return 0;
  return Math.max(1, Math.min(phase.milliseconds, Math.ceil(remaining)));
};

/**
 * Bound one pending phase by its own budget and by the time left in the
 * first-catalog budget. The recovery names whichever bound is shorter.
 */
const awaitPhaseWithinFirstCatalog = async (phase, firstCatalog, operation) => {
  const timeout = phaseRequestTimeout(phase, firstCatalog.deadline);
  if (timeout === 0) throw firstCatalogBudgetExceeded(firstCatalog.budget);
  const remaining = firstCatalog.deadline - performance.now();
  const budget = remaining < phase.milliseconds ? firstCatalog.budget : phase;
  const pending = withPhaseBudget(budget, () => operation(timeout)).then(
    (value) => ({ kind: "fulfilled", value }),
    (cause) => ({ kind: "rejected", cause }),
  );
  const outcome = await Promise.race([
    pending,
    firstCatalog.expired.then(() => ({ kind: "expired" })),
  ]);
  if (outcome.kind === "expired")
    throw firstCatalogBudgetExceeded(firstCatalog.budget);
  if (outcome.kind === "rejected") throw outcome.cause;
  return outcome.value;
};

const assertStartupBudgets = (measurement, policy) => {
  if (
    measurement.process_started_to_initialized_ms >
    policy.initialize.milliseconds
  )
    throw new Error(
      `packaged MCP exceeded the initialize phase budget. ${mcpStartupPhaseBudgetRecovery(policy.initialize)}`,
    );
  if (measurement.initialized_to_tools_list_ms > policy.toolsList.milliseconds)
    throw new Error(
      `packaged MCP exceeded the tools/list phase budget. ${mcpStartupPhaseBudgetRecovery(policy.toolsList)}`,
    );
  if (
    measurement.process_started_to_tools_list_ms >
    policy.firstCatalog.milliseconds
  )
    throw firstCatalogBudgetExceeded(policy.firstCatalog);
};

const elapsed = (startedAt, completedAt) =>
  Math.round((completedAt - startedAt) * 100) / 100;

const boundedAppend = (current, chunk) =>
  `${current}${chunk}`.slice(-64 * 1_024);
