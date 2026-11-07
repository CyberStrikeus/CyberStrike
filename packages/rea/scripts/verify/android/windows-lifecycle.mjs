import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readdir,
  realpath,
  rmdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolveJadxConfigurationInputs } from "../../../dist/android/JadxConfiguration.js";
import { validateVerifierJadxConfiguration } from "../../lib/jadx-configuration-inspection.mjs";
import { verifyWindowsGuardianIsolation } from "./windows-guardian-isolation.mjs";

/** Verify real Windows cancellation, disconnect and abrupt CLI owner exit. */
export async function verifyWindowsAndroidLifecycle(options) {
  assert.equal(process.platform, "win32");
  await verifyJavaSelection(options.environment);
  const cancellation = await verifyMcp(options, "cancel");
  await verifyMcp(options, "disconnect");
  const abruptWorkspaceRemoved = await verifyCliOwnerExit(options);
  await verifyWindowsGuardianIsolation();
  return {
    mcp_cancelled_engine_exited: true,
    mcp_cancelled_workspace_removed: true,
    mcp_ping_and_next_call: true,
    mcp_disconnect_engine_exited: true,
    cli_abrupt_owner_exit_engine_exited: true,
    cli_abrupt_owner_exit_workspace_cleanup: abruptWorkspaceRemoved,
    guardian_two_owner_isolation: true,
    observed_resources: cancellation,
    java_home_and_quoted_case_insensitive_path: true,
  };
}

async function verifyJavaSelection(environment) {
  const selected = await resolveJadxConfigurationInputs(
    environment,
    "inspect_android_package",
  );
  await validateVerifierJadxConfiguration(
    selected,
    environment,
    "inspect_android_package",
  );
  const root = await mkdtemp(join(tmpdir(), "rea-windows-java-selection-"));
  const alias = join(root, "JDK 路径 with spaces");
  const pathEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !["path", "java_home"].includes(key.toLowerCase()),
    ),
  );
  try {
    // The owned junction borrows the selected JDK directory without copying it.
    await symlink(dirname(selected.java), alias, "junction");
    pathEnvironment.Path = `"${alias}"`;
    const onPath = await resolveJadxConfigurationInputs(
      pathEnvironment,
      "inspect_android_package",
    );
    await validateVerifierJadxConfiguration(
      onPath,
      pathEnvironment,
      "inspect_android_package",
    );
    assert.equal(onPath.java, await realpath(selected.java));
    console.log(
      "PASS Windows JAVA_HOME and quoted Unicode/space Path selection",
    );
  } finally {
    await unlink(alias).catch((cause) => {
      if (cause.code !== "ENOENT") throw cause;
    });
    await rmdir(root);
  }
}

async function verifyMcp({ entrypoint, environment, path, repository }, mode) {
  const baseline = await runtimeRoots();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    cwd: repository,
    env: environment,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65536);
  });
  const client = new Client({
    name: `rea-windows-android-${mode}`,
    version: "1",
  });
  let observer;
  try {
    await client.connect(transport);
    assert.ok(transport.pid !== null);
    observer = observeJava(transport.pid);
    const controller = new AbortController();
    const pending = client
      .callTool(
        { name: "inspect_android_package", arguments: { path } },
        { timeout: 150000, signal: controller.signal },
      )
      .then(
        (response) => ({ response }),
        (error) => ({ error }),
      );
    const resources = await observer.acquired;
    if (mode === "cancel") controller.abort();
    else await client.close();
    const outcome = await deadline(pending, 15000);
    assert.ok("error" in outcome, "Cancelled request published a success");
    await observer.verifyExit();
    await waitFor(
      async () => {
        const remaining = await runtimeRoots();
        return remaining.every((root) => baseline.includes(root));
      },
      15000,
      "Owned Android workspace remained after cleanup",
    );
    if (mode === "cancel") {
      await waitFor(
        () => stderr.includes('"status":"error"'),
        15000,
        `Server did not finish the cancelled request: ${stderr}`,
      );
      assert.ok(
        !stderr.includes('"status":"ok"'),
        "Cancelled operation was logged successful",
      );
      await client.ping();
      const next = await client.callTool(
        { name: "inspect_android_package", arguments: { path } },
        { timeout: 150000 },
      );
      assert.notEqual(next.isError, true, JSON.stringify(next));
      assert.ok(next.structuredContent?.evidence_id);
    }
    console.log(
      `PASS Windows MCP ${mode}: real Java exit and workspace cleanup`,
    );
    return resources;
  } finally {
    await client.close();
    await transport.close();
    await observer?.close();
  }
}

async function verifyCliOwnerExit({
  entrypoint,
  environment,
  path,
  repository,
}) {
  const baseline = new Set(await runtimeRoots());
  const child = spawn(
    process.execPath,
    [entrypoint, "inspect-android-package", path, "--format", "json"],
    { cwd: repository, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-65536);
  });
  child.stderr.resume();
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.ok(child.pid !== undefined);
  const observer = observeJava(child.pid);
  try {
    await observer.acquired;
    // Node's Windows SIGTERM terminates the retained child handle abruptly.
    // The Java job must settle through kill-on-owner-close without JS cleanup.
    assert.equal(child.kill(), true);
    await deadline(exited, 15000);
    await observer.verifyExit();
    assert.equal(output, "", "Aborted CLI published successful Evidence");
    const created = (await runtimeRoots()).filter(
      (name) => !baseline.has(name),
    );
    assert.ok(
      created.length <= 1,
      "Concurrent Android workspaces make abrupt cleanup observation ambiguous",
    );
    if (created.length === 0) {
      console.log(
        "PASS Windows CLI abrupt owner exit: real Java job and workspace cleanup",
      );
      return true;
    }
    const ownedName = created[0];
    try {
      await waitFor(
        async () => !(await runtimeRoots()).includes(ownedName),
        5000,
        "Android workspace remained after abrupt owner exit",
      );
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        cause.message !== "Android workspace remained after abrupt owner exit"
      )
        throw cause;
    }
    const removed = !(await runtimeRoots()).includes(ownedName);
    console.log(
      removed
        ? "PASS Windows CLI abrupt owner exit: real Java job and workspace cleanup"
        : "OBSERVED Windows CLI abrupt owner exit: Java job cleaned, workspace residue remains",
    );
    return removed;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await deadline(exited, 15000);
    await observer.close();
  }
}

function observeJava(ownerPid) {
  assert.ok(Number.isSafeInteger(ownerPid) && ownerPid > 0);
  // Retain actual process handles and creation times. The process table only
  // discovers the child; no PID or executable path grants termination authority.
  const source = `
    $ErrorActionPreference='Stop'
    $owner=Get-Process -Id ${ownerPid}
    $null=$owner.Handle; $ownerStart=$owner.StartTime
    $java=$null; $deadline=[DateTime]::UtcNow.AddSeconds(45)
    try {
      while ([DateTime]::UtcNow -lt $deadline) {
        if ($owner.HasExited) { throw 'REA owner exited before Java acquisition' }
        $rows=Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${ownerPid}'
        foreach ($row in $rows) {
          if ($row.Name -eq 'java.exe' -and $row.CommandLine -like '*ReaJadxBridge.java*') {
            $candidate=Get-Process -Id $row.ProcessId
            $null=$candidate.Handle
            $sameCreation=$candidate.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssffffff') -eq $row.CreationDate.ToUniversalTime().ToString('yyyyMMddHHmmssffffff')
            if ($sameCreation -and $candidate.StartTime -ge $ownerStart -and !$candidate.HasExited) {
              $java=$candidate
              $resourceArgs=@([regex]::Matches($row.CommandLine,'-Xmx[0-9]+m|-XX:ActiveProcessorCount=[0-9]+') | ForEach-Object {$_.Value})
              @{affinity=[int64]$java.ProcessorAffinity; priority=[string]$java.PriorityClass; jvm_arguments=$resourceArgs} | ConvertTo-Json -Compress
              break
            }
            $candidate.Dispose()
          }
        }
        if ($null -ne $java) { break }
        Start-Sleep -Milliseconds 100
      }
      if ($null -eq $java) { throw 'No real owned Java engine was acquired' }
      $null=[Console]::ReadLine()
      if (!$java.WaitForExit(15000)) { throw 'Retained Java process did not exit' }
      @{exited=$java.HasExited} | ConvertTo-Json -Compress
    } finally { if ($null -ne $java) {$java.Dispose()}; $owner.Dispose() }
  `;
  const observer = spawn(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(source, "utf16le").toString("base64"),
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let stdout = "";
  let stderr = "";
  observer.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk.toString()).slice(-65536);
  });
  observer.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-65536);
  });
  const exited = new Promise((resolve, reject) => {
    observer.once("error", reject);
    observer.once("close", resolve);
  });
  const acquired = waitFor(
    () => stdout.includes("\n") || observer.exitCode !== null,
    50000,
    "Java process observer did not acquire a handle",
  ).then(() => {
    assert.ok(stdout.includes("\n"), stderr);
    return JSON.parse(stdout.split(/\r?\n/u)[0]);
  });
  return {
    acquired,
    async verifyExit() {
      observer.stdin.end("verify\n");
      assert.equal(await deadline(exited, 20000), 0, stderr);
      assert.equal(
        JSON.parse(stdout.trim().split(/\r?\n/u).at(-1)).exited,
        true,
      );
    },
    async close() {
      if (observer.exitCode === null && observer.signalCode === null) {
        observer.stdin.end();
        observer.kill();
      }
      await deadline(exited, 20000);
    },
  };
}

async function runtimeRoots() {
  return (await readdir(tmpdir())).filter((name) =>
    name.startsWith("rea-android-"),
  );
}

async function waitFor(predicate, milliseconds, message) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(message);
}

async function deadline(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Windows lifecycle deadline exceeded")),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
