import {
  requireMcpLifecycleResult,
  requireMcpToolError,
  sortVerifierNames,
} from "../../lib/mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { TOOL_CONTRACTS } from "../../../dist/contracts/toolContracts.js";
import { analysisErrorProjectionSchema } from "../../../dist/contracts/errorSchemas.js";

/** Real unusable Java runtimes and selectors must lead to applicable recovery. */
export async function verifyAndroidFailureRecovery({
  java,
  jvmArguments = [],
  entrypoint,
  environment,
  path,
  repository,
  execute,
  fixture,
}) {
  const root = await mkdtemp(join(tmpdir(), "rea-android-recovery-"));
  const javaName = process.platform === "win32" ? "java.exe" : "java";
  const jlinkName = process.platform === "win32" ? "jlink.exe" : "jlink";
  try {
    const withoutJar = { ...environment };
    delete withoutJar.REA_JADX_MCP_JAR;
    await verifyAndroidReadiness({
      entrypoint,
      environment: withoutJar,
      repository,
      available: false,
      remediation: /REA_JADX_MCP_JAR/u,
    });
    let jlink;
    for (const candidate of isAbsolute(java)
      ? [join(dirname(java), jlinkName)]
      : (environment.PATH ?? "")
          .split(delimiter)
          .map((directory) => join(directory, jlinkName))) {
      try {
        await access(candidate);
        jlink = candidate;
        break;
      } catch (cause) {
        if (cause.code !== "ENOENT" && cause.code !== "ENOTDIR") throw cause;
      }
    }
    if (jlink === undefined)
      throw new Error(
        "Android failure-recovery verification requires the full JDK's jlink via JAVA_HOME or PATH.",
      );
    const jre = join(root, "jre");
    await execute(
      jlink,
      [
        ...jvmArguments.map((argument) => `-J${argument}`),
        "--add-modules",
        "java.base",
        "--output",
        jre,
      ],
      {
        timeout: 60_000,
      },
    );
    await execute(join(jre, "bin", javaName), ["-version"], {
      timeout: 10_000,
    });
    const empty = join(root, "empty-path");
    await mkdir(empty);
    if (process.platform === "linux") {
      // Keep the real ownership prerequisite available while removing Java.
      const { stdout } = await execute("/bin/sh", ["-c", "command -v ps"], {
        env: environment,
        timeout: 10_000,
      });
      const ps = stdout.trim();
      assert.ok(
        isAbsolute(ps),
        "Linux recovery verification requires procps ps",
      );
      await symlink(ps, join(empty, "ps"));
    }
    const withoutJavaHome = { ...environment };
    delete withoutJavaHome.JAVA_HOME;
    for (const key of Object.keys(withoutJavaHome))
      if (key.toLowerCase() === "path") delete withoutJavaHome[key];
    const invalidJar = join(root, "invalid.jar");
    await writeFile(invalidJar, "not a Java archive");
    const environments = [
      {
        label: "JRE without compiler",
        env: { ...environment, JAVA_HOME: jre },
        observation: "jdk.compiler",
        diagnostics: {
          failure_kind: "java_runtime",
          failure_code: "runtime_missing",
          jdk_compiler: false,
        },
        message: /full JDK/u,
        remediation: /java --list-modules/u,
      },
      {
        label: "missing java",
        env: { ...withoutJavaHome, PATH: empty },
        observation: `Cannot find an executable ${javaName}`,
        diagnostics: {
          failure_kind: "java_runtime",
          failure_code: "runtime_missing",
          phase: "path-lookup",
        },
        message: /Cannot find an executable java/u,
        remediation: /JAVA_HOME|PATH/u,
      },
      {
        label: "invalid engine archive with a working JDK",
        env: { ...environment, REA_JADX_MCP_JAR: invalidJar },
        observation: "Cannot inspect REA_JADX_MCP_JAR",
        diagnostics: {
          failure_kind: "jar",
          failure_code: "version_unresolved",
        },
        message: /REA_JADX_MCP_JAR/u,
        remediation: /jadx-headless-mcp/u,
        forbiddenGuidance: /Select a full JDK/u,
      },
    ];
    if (process.platform === "darwin") {
      // /usr/bin/java either resolves an installed runtime or reports the actual stub failure.
      try {
        await execute("/usr/bin/java", ["-version"], { timeout: 10_000 });
      } catch {
        environments.push({
          label: "macOS Java stub",
          env: { ...withoutJavaHome, PATH: "/usr/bin:/bin" },
          observation: "Unable to locate a Java Runtime",
          diagnostics: {
            failure_kind: "java_probe",
            failure_code: "runtime_unavailable",
          },
          availabilityReason: "provider_unavailable",
          availabilityRemediation: /selected Java runtime/u,
          message: /selected Java runtime/u,
          remediation: /selected launcher/u,
        });
      }
    }
    for (const scenario of environments) {
      let failure;
      try {
        await execute(
          process.execPath,
          [entrypoint, "inspect-android-package", path, "--json"],
          {
            cwd: repository,
            env: scenario.env,
            timeout: 45_000,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        assert.fail(`${scenario.label} unexpectedly succeeded`);
      } catch (cause) {
        assert.equal(cause.code, 1);
        failure = analysisErrorProjectionSchema.parse(JSON.parse(cause.stdout));
      }
      assert.equal(failure.code, "capability_unavailable");
      assert.ok(
        JSON.stringify(failure).includes(scenario.observation),
        JSON.stringify(failure),
      );
      assert.ok(failure.details.diagnostics);
      for (const [key, value] of Object.entries(scenario.diagnostics))
        assert.deepEqual(failure.details.diagnostics[key], value);
      assert.match(failure.message, scenario.message);
      assert.match(failure.remediation.action, scenario.remediation);
      if (scenario.forbiddenGuidance)
        assert.doesNotMatch(failure.message, scenario.forbiddenGuidance);
      assert.doesNotMatch(JSON.stringify(failure), /rea doctor/u);
      await verifyAndroidReadiness({
        entrypoint,
        environment: scenario.env,
        repository,
        available: false,
        unavailableReason: scenario.availabilityReason ?? "provider_missing",
        remediation:
          scenario.availabilityRemediation ??
          new RegExp(
            scenario.observation.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
            "u",
          ),
      });
      console.log(`PASS CLI applicable recovery: ${scenario.label}`);
    }
    await verifyAndroidReadiness({
      entrypoint,
      environment,
      repository,
      available: true,
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      cwd: repository,
      env: environment,
      stderr: "pipe",
    });
    const client = new Client({
      name: "rea-real-android-failures",
      version: "1",
    });
    try {
      await client.connect(transport);
      for (const name of [
        "inspect_android_class",
        "inspect_android_method",
        "trace_android_references",
      ]) {
        const response = await client.callTool(
          {
            name,
            arguments: {
              path,
              class_name: "no.such.Class",
              ...(name === "inspect_android_method"
                ? { method_name: "missing" }
                : {}),
            },
          },
          { timeout: 150_000 },
        );
        assert.equal(response.isError, true);
        assert.equal(requireMcpToolError(response).code, "invalid_request");
        assert.deepEqual(requireMcpToolError(response).details.issues[0].path, [
          "class_name",
        ]);
        assert.match(
          requireMcpToolError(response).details.issues[0].message,
          /search_android_classes/u,
        );
        assert.doesNotMatch(JSON.stringify(response), /rea doctor/u);
        console.log(`PASS MCP selector correction: ${name}`);
      }
      const method = await client.callTool(
        {
          name: "inspect_android_method",
          arguments: {
            path,
            class_name: fixture.class_name,
            method_name: "noSuchMethod",
          },
        },
        { timeout: 150_000 },
      );
      assert.equal(requireMcpToolError(method).code, "invalid_request");
      assert.deepEqual(requireMcpToolError(method).details.issues[0].path, [
        "method_name",
      ]);
      await client.ping();
      const control = await client.callTool(
        { name: "inspect_android_package", arguments: { path } },
        { timeout: 150_000 },
      );
      assert.notEqual(control.isError, true, JSON.stringify(control));
      assert.equal(
        control.structuredContent.normalized_result.package_name,
        fixture.package,
      );
      console.log("PASS MCP valid package after selector failures");
    } finally {
      await client.close();
      await transport.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const verifyAndroidReadiness = async ({
  entrypoint,
  environment,
  repository,
  available,
  remediation,
  unavailableReason = "provider_missing",
}) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    cwd: repository,
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "rea-android-readiness", version: "1" });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    const catalogNames = sortVerifierNames(
      catalog.tools.map(({ name }) => name),
    );
    const statusReply = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const status = requireMcpLifecycleResult(statusReply, "binary_session");
    const availability = status.tool_availability;
    assert.deepEqual(
      sortVerifierNames(availability.map(({ name }) => name)),
      sortVerifierNames(TOOL_CONTRACTS.map(({ name }) => name)),
      "Readiness must retain one availability record for the complete canonical catalog",
    );
    assert.deepEqual(
      catalogNames,
      sortVerifierNames(TOOL_CONTRACTS.map(({ name }) => name)),
      "Readiness must not truncate the SDK tool catalog",
    );
    const byName = new Map(availability.map((item) => [item.name, item]));
    for (const name of [
      "inspect_android_package",
      "search_android_classes",
      "inspect_android_class",
      "inspect_android_method",
      "trace_android_references",
    ]) {
      const item = byName.get(name);
      assert.ok(item, `Missing Android availability entry ${name}`);
      assert.equal(item.available, available, `${name} readiness mismatch`);
      if (available) {
        assert.equal(item.reason, "available");
        assert.equal(item.remediation, null);
      } else {
        assert.equal(item.reason, unavailableReason);
        assert.match(item.remediation, remediation);
      }
    }
    const graph = byName.get("project_android_application_graph");
    assert.ok(graph, "Missing execution-free Android graph projection");
    assert.equal(graph.available, true);
    assert.equal(graph.reason, "available");
    assert.equal(graph.remediation, null);
    console.log(
      `PASS stdio Android readiness: ${available ? "ready" : "unavailable"}`,
    );
  } finally {
    await client.close();
    await transport.close();
  }
};
