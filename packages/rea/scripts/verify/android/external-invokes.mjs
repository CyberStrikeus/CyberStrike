import assert from "node:assert/strict";
import { delimiter, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { artifactMcpCall } from "../../lib/artifact-e2e.mjs";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../lib/mcp-verification-environment.mjs";
import {
  requireMcpOutput,
  requireMcpToolError,
} from "../../lib/mcp-verifier-results.mjs";
import { hashAndroidFile } from "./digest.mjs";

const operation = "trace_android_references";
const className = "android.app.NotificationManager";
const prototype = [
  "(ILandroid/app/Notification;)V",
  "(Ljava/lang/String;ILandroid/app/Notification;)V",
];
const input = (path, index) => ({
  path,
  class_name: className,
  method_name: "notify",
  overload_index: index,
});

const check = (value, digest, index, dexEntry) => {
  const evidence = parseEvidence(value);
  assert.equal(evidence.operation, operation);
  assert.equal(evidence.subject.digest.sha256, digest);
  const result = evidence.normalized_result;
  assert.equal(result.target_definition, "external");
  assert.equal(result.reference_scope, "direct_dex_invokes");
  assert.equal(result.dex_descriptor, prototype[index]);
  assert.equal(result.reference_unit, "using_node");
  assert.equal(result.total, index === 0 ? 3 : 1);
  assert.deepEqual(result.direct_invokes_coverage, {
    complete_using_nodes: result.total,
    partial_using_nodes: 0,
    unknown_using_nodes: 0,
    recorded_sites: index === 0 ? 4 : 1,
  });
  for (const caller of result.references) {
    assert.equal(caller.source_selector.class_name, caller.containing_class);
    assert.equal(caller.source_selector.method_name, caller.name);
    assert.equal(caller.direct_invokes_exhaustive, true);
    for (const site of caller.direct_invokes) {
      assert.equal(site.dex_entry, dexEntry);
      assert.equal(site.opcode, "INVOKE_VIRTUAL");
    }
  }
  if (index === 0) {
    const overloaded = result.references.filter(
      (caller) => caller.containing_class === "fixture.Caller",
    );
    assert.deepEqual(
      overloaded.map((caller) => caller.source_selector.overload_index),
      [0, 1],
    );
    assert.deepEqual(
      overloaded[0].direct_invokes.map((site) => site.dex_code_unit_offset),
      [1, 4],
    );
    assert.deepEqual(
      overloaded[1].direct_invokes.map((site) => site.dex_code_unit_offset),
      [0],
    );
  }
  return evidence;
};

const cli = async (options, path, index, selector = input(path, index)) => {
  const result = await options.execute(
    process.execPath,
    [
      options.entrypoint,
      "trace-android-references",
      path,
      selector.class_name,
      "--method-name",
      selector.method_name,
      ...(index === undefined ? [] : ["--overload-index", String(index)]),
      "--json",
    ],
    {
      cwd: options.repository,
      env: options.environment,
      timeout: 150_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return JSON.parse(result.stdout);
};

const verifyApk = async (options, path, dexEntry) => {
  const digest = await hashAndroidFile(path);
  const cliResults = [];
  for (const index of [0, 1])
    cliResults.push(
      check(await cli(options, path, index), digest, index, dexEntry),
    );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.entrypoint, "mcp"],
    cwd: options.repository,
    env: { ...options.environment, ...INLINE_EVIDENCE_MCP_ENVIRONMENT },
    stderr: "pipe",
  });
  const client = new Client({
    name: "rea-real-external-references",
    version: "1",
  });
  await withVerifierCleanup(async () => {
    await client.connect(transport, { timeout: 30_000 });
    const call = (name, args) =>
      artifactMcpCall(client, { name, arguments: args }, { timeout: 150_000 });
    for (const index of [0, 1]) {
      const result = check(
        requireMcpOutput(await call(operation, input(path, index)), operation),
        digest,
        index,
        dexEntry,
      );
      assert.deepEqual(
        result.normalized_result,
        cliResults[index].normalized_result,
      );
      for (const caller of result.normalized_result.references) {
        const body = parseEvidence(
          requireMcpOutput(
            await call("inspect_android_method", {
              path,
              ...caller.source_selector,
            }),
            "inspect_android_method",
          ),
        );
        assert.equal(
          body.normalized_result.method.name,
          caller.source_selector.method_name,
        );
        assert.equal(
          body.normalized_result.method.overload_index,
          caller.source_selector.overload_index,
        );
        assert.equal(body.normalized_result.body_status, "available");
      }
    }
    const ambiguous = input(path, 0);
    delete ambiguous.overload_index;
    for (const args of [
      ambiguous,
      input(path, 99),
      { ...input(path, 0), class_name: "fixture.Absent" },
    ]) {
      const error = requireMcpToolError(await call(operation, args));
      assert.equal(error.category, "invalid_input");
      if (args === ambiguous)
        for (const descriptor of prototype)
          assert.ok(error.details.issues[0].message.includes(descriptor));
    }
    const replay = check(
      requireMcpOutput(await call(operation, input(path, 0)), operation),
      digest,
      0,
      dexEntry,
    );
    assert.deepEqual(replay.normalized_result, cliResults[0].normalized_result);
  }, [() => client.close(), () => transport.close()]);
  assert.equal(
    await hashAndroidFile(path),
    digest,
    "Static references changed APK bytes",
  );
  console.log(
    `PASS external CLI/MCP parity, repeated/overloaded/nested callers, post-source identity, refusal recovery and awaited cleanup (${dexEntry})`,
  );
};

const verifyLimit = async (
  options,
  path,
  stage = "caller_inventory",
  selector,
) => {
  const digest = await hashAndroidFile(path);
  try {
    await cli(options, path, 0, selector);
    assert.fail("Oversized external reference inventory was accepted");
  } catch (cause) {
    assert.equal(cause.code, 1);
    const failure = JSON.parse(cause.stdout);
    assert.equal(failure.category, "resource_constraint");
    assert.equal(failure.details.reported_limits.stage, stage);
    assert.equal(failure.retryable, false);
  }
  assert.equal(await hashAndroidFile(path), digest);
  console.log(
    `PASS real external ${stage} representation refusal retains typed resource constraint and immutable APK`,
  );
};

const checkSiteBudget = (value, digest) => {
  const evidence = parseEvidence(value);
  assert.equal(evidence.subject.digest.sha256, digest);
  const result = evidence.normalized_result;
  assert.equal(result.total, 11);
  const partial = result.references.filter(
    (caller) => !caller.direct_invokes_exhaustive,
  ).length;
  assert.ok(partial > 0);
  assert.deepEqual(result.direct_invokes_coverage, {
    complete_using_nodes: 11 - partial,
    partial_using_nodes: partial,
    unknown_using_nodes: 0,
    recorded_sites: result.references.reduce(
      (count, caller) => count + caller.direct_invokes.length,
      0,
    ),
  });
  assert.equal(result.references[0].containing_class, "fixture.AHeavy");
  assert.equal(result.references[0].direct_invokes_exhaustive, false);
  assert.ok(result.references[0].direct_invokes.length < 10000);
  assert.ok(
    result.references
      .slice(1)
      .every((caller) => caller.containing_class === "fixture.ZShort"),
  );
  assert.deepEqual(
    result.references.map((caller) => caller.source_selector),
    [
      { class_name: "fixture.AHeavy", method_name: "call", overload_index: 0 },
      ...Array.from({ length: 10 }, (_, index) => ({
        class_name: "fixture.ZShort",
        method_name: `tail${index}`,
        overload_index: 0,
      })),
    ],
  );
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 8 * 1024 * 1024);
  return evidence;
};

/** Optional instruction positions cannot displace the complete caller inventory. */
const verifySiteBudget = async (options, path, control) => {
  const digest = await hashAndroidFile(path);
  const first = checkSiteBudget(await cli(options, path, 0), digest);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.entrypoint, "mcp"],
    cwd: options.repository,
    env: { ...options.environment, ...INLINE_EVIDENCE_MCP_ENVIRONMENT },
    stderr: "pipe",
  });
  const client = new Client({ name: "rea-external-site-budget", version: "1" });
  await withVerifierCleanup(async () => {
    await client.connect(transport, { timeout: 30_000 });
    const call = (args) =>
      artifactMcpCall(
        client,
        { name: operation, arguments: args },
        { timeout: 150_000 },
      );
    const firstReply = await call(input(path, 0));
    assert.ok(Buffer.byteLength(JSON.stringify(firstReply)) < 8 * 1024 * 1024);
    const result = checkSiteBudget(
      requireMcpOutput(firstReply, operation),
      digest,
    );
    assert.deepEqual(result.normalized_result, first.normalized_result);
    assert.equal(
      requireMcpToolError(
        await call({ ...input(path, 0), class_name: "fixture.Absent" }),
      ).category,
      "invalid_input",
    );
    const prototypeLimit = requireMcpToolError(
      await call({
        ...input(
          resolve(options.classes, "external-oversized-prototype.apk"),
          0,
        ),
        class_name: "external.Library",
        method_name: "wide",
      }),
    );
    assert.equal(prototypeLimit.category, "resource_constraint");
    assert.equal(
      prototypeLimit.details.reported_limits.stage,
      "method_inventory",
    );
    check(
      requireMcpOutput(await call(input(control, 0)), operation),
      await hashAndroidFile(control),
      0,
      "classes.dex",
    );
    const replay = checkSiteBudget(
      requireMcpOutput(await call(input(path, 0)), operation),
      digest,
    );
    assert.deepEqual(replay.normalized_result, first.normalized_result);
  }, [() => client.close(), () => transport.close()]);
  assert.equal(await hashAndroidFile(path), digest);
  console.log(
    "PASS site-heavy CLI/MCP complete11 callers, partial positions, bounded output, target replacement/recovery and awaited cleanup",
  );
};

/** Extend the existing real Android lane with reference-only targets, never target execution. */
export const verifyAndroidExternalReferences = async (options) => {
  const {
    java,
    jar,
    classes,
    repository,
    execute,
    environment,
    jvmArguments = [],
  } = options;
  // The metadata verifier owns compiler selection and compiles both regressions
  // into this exact classes directory before invoking this consumer.
  const result = await execute(
    java,
    [
      ...jvmArguments,
      "-classpath",
      `${classes}${delimiter}${jar}`,
      "ReaJadxExternalReferencesRegression",
      resolve(repository, "tests/fixtures/android/external-invokes"),
      classes,
    ],
    { env: environment, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.match(
    result.stdout,
    /EXTERNAL_REFERENCE_REGRESSION_PASS prototypes=2 using_nodes=3 sites=4 overloaded_callers=true nested=true multidex=true no_source=true post_codegen=true/u,
  );
  assert.match(result.stdout, /EXTERNAL_SITE_BUDGET_PASS callers=11/u);
  assert.match(
    result.stdout,
    /EXTERNAL_PROTOTYPE_LIMIT_PASS single_prototype=true/u,
  );
  await verifyApk(
    options,
    resolve(classes, "external-invokes.apk"),
    "classes.dex",
  );
  await verifyApk(
    options,
    resolve(classes, "external-invokes-multidex.apk"),
    "classes2.dex",
  );
  await verifyLimit(options, resolve(classes, "external-invokes-large.apk"));
  await verifyLimit(
    options,
    resolve(classes, "external-oversized-prototype.apk"),
    "method_inventory",
    {
      class_name: "external.Library",
      method_name: "wide",
    },
  );
  await verifySiteBudget(
    options,
    resolve(classes, "external-invokes-site-heavy.apk"),
    resolve(classes, "external-invokes.apk"),
  );
};
