#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { createPackageVerifierCommands } from "./lib/verify-package-commands.mjs";

const AGENTENV_VERSION = "0.9.1334";
const AGENTENV_PIN = `agentenv-framework ${AGENTENV_VERSION}`;
// The framework builds its infra images from public ECR, whose anonymous pull quota hosted
// runners share; a rate refusal earns one retry, anything else fails at once.
const PUBLIC_ECR_QUOTA =
  /public\.ecr\.aws[\s\S]{0,400}?(?:429 Too Many Requests|toomanyrequests)/u;
// The anonymous data-transfer cap is counted per source IP, so a pause on the same runner
// cannot lift it; the receipt names it instead of retrying.
const PUBLIC_ECR_DATA_LIMIT = /toomanyrequests: Data limit exceeded/u;
const QUOTA_RETRY_PAUSE_MS = 90_000;
// Both bundle attempts share this budget inside the 30-minute job; a retry needs real time left.
const RUN_BUDGET_MS = 22 * 60_000;
const FIRST_ATTEMPT_MS = 15 * 60_000;
const MIN_RETRY_MS = 5 * 60_000;

// Both tools are caller-supplied absolute paths, as every real-* lane names its upstream.
for (const key of ["REA_AGENT_ENV_COMMAND", "REA_DOCKER_COMMAND"])
  if (!isAbsolute(process.env[key] ?? ""))
    throw new Error(
      `verify:agentenv:environment requires absolute ${key}; see docs/testing.md. No dependencies are installed by this verifier.`,
    );
const agentEnv = process.env.REA_AGENT_ENV_COMMAND;
const docker = process.env.REA_DOCKER_COMMAND;
// The framework's local image store keeps its registry:2 helper running across runs; a first
// run on a fresh host creates it, so it is reported separately rather than counted as a leak.
const IMAGE_STORE_HELPER = /^agentenv-registry(?:-\d+)?$/u;
await Promise.all([access(agentEnv), access(docker)]);
const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const checkout = resolve(dirname(entrypoint), "..");
const run = createVerifierRun();
const runtime = await PrivateRuntimeRoot.create({
  prefix: "rea-agentenv-verifier-",
});
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const failures = [];
let cases = 0;
const receipt = {};
let knownContainers;
let commands;
try {
  commands = await createPackageVerifierCommands({ workspace: runtime });
  const version = await commands.exec(agentEnv, ["--version"], {
    env: environment,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  receipt.agent_env_version = version.stdout.trim();
  assert.equal(
    receipt.agent_env_version,
    `agent-env ${AGENTENV_VERSION}`,
    "The verifier requires the pinned framework executable; its observed version is retained in the receipt.",
  );
  const containersBefore = await containers();
  knownContainers = new Set(containersBefore.map((entry) => entry.id));
  receipt.docker_before = {
    containers: containersBefore.length,
    images: (await imageIds()).length,
  };
  // Source-owned capture: the Grafana-shaped HAR builder the view tests use.
  const { environmentManifestHar } = await import(
    new URL("../tests/fixtures/historicalHar.ts", import.meta.url).href
  );
  const harPath = join(runtime.path, "capture.har");
  await writeFile(harPath, JSON.stringify(environmentManifestHar()));
  // The lane proves this checkout, not the registry package: pack it and install the tarball in the image.
  const { stdout: packed } = await commands.execNpm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", runtime.path],
    { cwd: checkout, env: environment, maxBuffer: 16 * 1024 * 1024 },
  );
  const tarball = join(runtime.path, packedFilename(JSON.parse(packed)));
  await access(tarball);
  // The one-step build users run: it inspects the HAR, projects the manifest and writes the bundle.
  const bundle = join(runtime.path, "grafana-example");
  const built = await cli(
    "environment-build",
    harPath,
    bundle,
    "--package-tarball",
    tarball,
  );
  assert.equal(built.status, "built");
  assert.equal(built.capture.operation, "inspect_web_network_capture");
  assert.equal(built.capture.records, 28);
  cases++;
  assert.equal(built.name, "grafana-example");
  const toolCount = built.manifest.tools;
  assert.ok(toolCount > 0);
  assert.deepEqual(built.manifest.template_rules, [
    "after-uid-literal",
    "opaque-token",
    "sibling-variance",
    "prefix-variance",
  ]);
  cases++;
  // The bundle serves the state its server derives from the capture, which leaves the
  // manifest's write tools unserved; the build reports the count the bundle serves.
  assert.equal(built.state.served, true);
  const servedCount = built.tool_count;
  assert.ok(servedCount > 0 && servedCount < toolCount);
  // Every read tool and every served write tool is in the served catalog.
  assert.equal(
    built.coverage.reads.state +
      built.coverage.reads.recorded +
      built.coverage.writes.served.length,
    servedCount,
  );
  assert.equal(built.package_source.kind, "tarball");
  assert.deepEqual(built.files.map((file) => file.path).sort(), [
    "README.md",
    "artifacts/check_grafana-example/verify.py",
    "envs/grafana-example/Dockerfile",
    "envs/grafana-example/env.toml",
    "envs/grafana-example/evidence.json",
    "envs/grafana-example/manifest.json",
    "envs/grafana-example/rea-agents.tgz",
    "tasks/smoke.json",
  ]);
  const shipped = JSON.parse(
    await readFile(join(bundle, "envs/grafana-example/manifest.json"), "utf8"),
  );
  assert.equal(shipped.evidence_id, built.manifest.evidence_id);
  assert.equal(
    shipped.normalized_result.parent_evidence_id,
    built.capture.evidence_id,
  );
  const dockerfile = await readFile(
    join(bundle, "envs/grafana-example/Dockerfile"),
    "utf8",
  );
  assert.ok(dockerfile.includes("COPY rea-agents.tgz /tmp/"));
  assert.ok(dockerfile.includes("/tmp/rea-agents.tgz"));
  cases++;
  // The agentenv runner builds the image, deploys it on the local sandbox and runs the verifier.
  // One deadline for both attempts, well under the 30-minute job, so a hung or retried run ends
  // with this receipt rather than the runner's kill.
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  let attempts = 0;
  const runBundle = async (timeoutMs) => {
    attempts += 1;
    let outcome;
    try {
      const output = await commands.exec(
        agentEnv,
        ["run", bundle, "--sandbox", "local"],
        {
          cwd: runtime.path,
          env: environment,
          timeout: timeoutMs,
          diagnosticBytes: 4 * 1024 * 1024,
        },
      );
      outcome = {
        exitCode: 0,
        signal: null,
        stdout: { text: output.stdout },
        stderr: { text: output.stderr },
      };
      return outcome;
    } catch (cause) {
      outcome = cause?.snapshot;
      throw cause;
    } finally {
      // Recorded before the outcome is judged, so a failed receipt still says how the last
      // run ended, how many runs there were and whether the registry quota refused it.
      receipt.agent_env_run = runRecord(
        outcome,
        Date.now() - started,
        attempts,
      );
    }
  };
  let snapshot;
  try {
    snapshot = await runBundle(
      Math.min(FIRST_ATTEMPT_MS, deadline - Date.now()),
    );
  } catch (cause) {
    if (
      receipt.agent_env_run?.public_ecr_quota !== "rate" ||
      deadline - Date.now() - QUOTA_RETRY_PAUSE_MS < MIN_RETRY_MS
    )
      throw cause;
    await pause(QUOTA_RETRY_PAUSE_MS);
    snapshot = await runBundle(deadline - Date.now());
  }
  assert.equal(snapshot.exitCode, 0);
  assert.match(snapshot.stdout.text, /tasks\/smoke\.json v\d+: passed/u);
  assert.match(
    snapshot.stdout.text,
    new RegExp(
      `serve: listed ${String(servedCount)} tools, expected ${String(servedCount)};`,
      "u",
    ),
  );
  cases++;
} catch (cause) {
  failures.push(cause);
} finally {
  // The container inventory runs whether the bundle passed, failed or timed out, so a failed
  // receipt still says what the run left behind.
  if (knownContainers !== undefined)
    try {
      const containersAfter = await containers();
      const added = containersAfter.filter(
        (entry) => !knownContainers.has(entry.id),
      );
      const helpers = added.filter((entry) =>
        IMAGE_STORE_HELPER.test(entry.name),
      );
      const leaked = added.filter(
        (entry) => !IMAGE_STORE_HELPER.test(entry.name),
      );
      receipt.docker_after = {
        containers: containersAfter.length,
        images: (await imageIds()).length,
        image_store_helpers: helpers.map((entry) => entry.name),
        new_containers: leaked.map((entry) => `${entry.id} ${entry.name}`),
      };
      assert.deepEqual(leaked, []);
      if (failures.length === 0) cases++;
    } catch (cause) {
      failures.push(cause);
    }
  try {
    if (commands === undefined) await runtime.close();
    else await commands.close();
  } catch (cause) {
    failures.push(cause);
  }
}
const verifier = await completeVerifierRun(run);
try {
  assert.equal(verifier.process_lineage.status, "verified");
  assert.deepEqual(verifier.process_lineage.descendants, []);
} catch (cause) {
  failures.push(cause);
}
if (failures.length > 0) {
  console.error(
    JSON.stringify(
      { status: "failed", public_cases: cases, ...receipt, verifier },
      null,
      2,
    ),
  );
  throw new AggregateError(
    failures,
    "Environment bundle verification failed; export, run and cleanup failures are retained.",
  );
}
console.log(
  JSON.stringify(
    {
      status: "passed",
      public_cases: cases,
      upstream: AGENTENV_PIN,
      runner: `${process.platform} ${process.arch}; host Docker`,
      offline: false,
      ...receipt,
      verifier,
    },
    null,
    2,
  ),
);

async function cli(...args) {
  const { stdout } = await commands.exec(
    process.execPath,
    [entrypoint, ...args, "--json"],
    { env: environment, cwd: runtime.path, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

// The receipt's view of one `agent-env run`, passed or failed; `outcome` is absent when the
// command failed before producing a snapshot.
function runRecord(outcome, elapsedMs, attempts) {
  const quota = publicEcrQuota(outcome?.stderr.text ?? "");
  return {
    exit_code: outcome?.exitCode ?? null,
    ...(outcome?.signal ? { signal: outcome.signal } : {}),
    seconds: Math.round(elapsedMs / 1000),
    attempts,
    ...(attempts > 1
      ? { retried_for: "public ECR anonymous pull rate limit (429)" }
      : {}),
    ...(quota === undefined ? {} : { public_ecr_quota: quota }),
    stdout_tail: (outcome?.stdout.text ?? "").trim().split("\n").slice(-6),
  };
}

// Which public ECR refusal ended a run: the per-IP data cap or a request-rate refusal.
function publicEcrQuota(stderr) {
  if (!PUBLIC_ECR_QUOTA.test(stderr)) return undefined;
  return PUBLIC_ECR_DATA_LIMIT.test(stderr) ? "data_limit" : "rate";
}

// npm 11 prints `npm pack --json` as a one-element array; npm 12 keys the same record by package name.
function packedFilename(report) {
  const record = Array.isArray(report) ? report[0] : Object.values(report)[0];
  assert.equal(typeof record?.filename, "string");
  return record.filename;
}

// Containers are not verifier descendants, so leaks are checked by id against the pre-run set.
async function containers() {
  const { stdout } = await commands.exec(
    docker,
    ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}"],
    { env: environment },
  );
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, name = ""] = line.split("\t");
      return { id, name };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function imageIds() {
  const { stdout } = await commands.exec(docker, ["images", "-q"], {
    env: environment,
  });
  return [...new Set(stdout.split("\n").filter((line) => line.length > 0))];
}
