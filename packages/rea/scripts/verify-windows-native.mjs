#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  readdir,
  rm,
  symlink,
  writeFile,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyWindowsProtocolInput } from "./lib/windows-protocol-input.mjs";
import { verifyWindowsJobMemoryLimit } from "./lib/windows-job-memory-limit.mjs";
import { verifyVolumeRootAppendLease } from "./lib/windows-volume-root-append-lease.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

if (process.platform !== "win32")
  throw new Error(
    "Windows native conformance requires a real Windows x64 host.",
  );
const packageRoot = resolve(process.argv[2] ?? ".");
const { requireWindowsNativeAuthority } = await import(
  pathToFileURL(join(packageRoot, "dist/windows/WindowsNativeLoader.js"))
);
const native = requireWindowsNativeAuthority();
const { WindowsPrivateRuntime, windowsPrivateRuntime } = await import(
  pathToFileURL(join(packageRoot, "dist/windows/WindowsPrivateRuntime.js"))
);
const { ghidraSessionRoot } = await import(
  pathToFileURL(join(packageRoot, "dist/ghidra/GhidraSessionRoot.js"))
);
const { PrivateRuntimeRoot } = await import(
  pathToFileURL(join(packageRoot, "dist/process/PrivateRuntimeRoot.js"))
);
const { PrivateRuntimeRootUnavailableError } = await import(
  pathToFileURL(
    join(packageRoot, "dist/process/PrivateRuntimeRootUnavailableError.js"),
  )
);
const workspace = await mkdtemp(join(tmpdir(), "rea-native-conformance-"));
// A pwsh caller can supply module paths incompatible with Windows PowerShell.
// Each independent observer must discover its own module path.
const windowsPowerShellEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name.toLowerCase() !== "psmodulepath",
  ),
);
// Windows PowerShell observers call .NET members directly: no cmdlets,
// pipelines, module autoloading, type-table updates or JSON serializer, which
// made up most of the earlier ACL observer's 1.2-2.9s in-script time on hosted
// runners. The deadline bounds a hung observer rather than the observation. It
// must also cover a cold powershell.exe start on a starved runner: one run
// printed nothing within 15s, and another ran the same phases ~20x slower.
const windowsPowerShellObserverTimeoutMs = 60_000;
const windowsPowerShellArguments = (script) => [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  script,
];
// Shared prelude: fail on the first error and emit JSON booleans without
// loading ConvertTo-Json.
const windowsPowerShellObserverPrelude = String.raw`
  $ErrorActionPreference = 'Stop'
  function Format-JsonBoolean([bool]$value) { if ($value) { 'true' } else { 'false' } }
`;
const observeWithWindowsPowerShell = (script, observerEnvironment) =>
  execFileSync(
    "powershell.exe",
    windowsPowerShellArguments(windowsPowerShellObserverPrelude + script),
    {
      encoding: "utf8",
      timeout: windowsPowerShellObserverTimeoutMs,
      windowsHide: true,
      env: { ...windowsPowerShellEnvironment, ...observerEnvironment },
    },
  );
// Independent private-runtime DACL observer. Every identity it reads is
// requested and checked in SID form; it never resolves account names. Get-Acl
// and the ETS Access property are avoided: Access requests NTAccount rules.
const privateRuntimeAclObserver = String.raw`
  $clock = [Diagnostics.Stopwatch]::StartNew()
  function Trace-AclPhase([string]$phase) {
    [Console]::Error.WriteLine('private-runtime-acl: ' + $phase + ' ' + $clock.ElapsedMilliseconds + 'ms')
  }
  Trace-AclPhase 'started'
  # Separates powershell.exe startup from the observation itself.
  [Console]::Error.WriteLine('private-runtime-acl: process-uptime ' + [int]([DateTime]::Now - [Diagnostics.Process]::GetCurrentProcess().StartTime).TotalMilliseconds + 'ms')
  $p = $env:REA_TEST_PRIVATE_RUNTIME_PATH
  $sid = [Security.Principal.SecurityIdentifier]
  $a = [Security.AccessControl.DirectorySecurity]::new($p, [Security.AccessControl.AccessControlSections]'Access, Owner')
  Trace-AclPhase 'acl-read'
  $u = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $owner = $a.GetOwner($sid)
  if ($owner -isnot $sid) { throw 'ACL owner observation must stay in SID form' }
  Trace-AclPhase 'owner-sid-read'
  $rules = $a.GetAccessRules($true, $true, $sid)
  $trusteesOnlyUserAndSystem = $true
  foreach ($rule in $rules) {
    $trustee = $rule.IdentityReference
    if ($trustee -isnot $sid) { throw 'ACL rule observation must stay in SID form' }
    if ($trustee.Value -ne $u.Value -and $trustee.Value -ne 'S-1-5-18') { $trusteesOnlyUserAndSystem = $false }
  }
  Trace-AclPhase 'rule-sids-read'
  [IO.File]::SetAttributes($p, [IO.FileAttributes]([int][IO.File]::GetAttributes($p) -bor 1))
  Trace-AclPhase 'readonly-set'
  [Console]::Out.Write(
    '{"protected":' + (Format-JsonBoolean $a.AreAccessRulesProtected) +
    ',"ownerMatchesUser":' + (Format-JsonBoolean ($owner.Value -eq $u.Value)) +
    ',"trusteesOnlyUserAndSystem":' + (Format-JsonBoolean $trusteesOnlyUserAndSystem) +
    ',"count":' + $rules.Count +
    ',"rootReadonly":' + (Format-JsonBoolean (([int][IO.File]::GetAttributes($p) -band 1) -ne 0)) + '}')
  Trace-AclPhase 'complete'
`;
// Keep account-name resolution out of the observer statically. The former
// Update-TypeData guard reloaded PowerShell's type data at runtime; its phase
// took 0.3-9.5s on hosted runners.
assert.doesNotMatch(
  privateRuntimeAclObserver,
  /Get-Acl|\.Access\b|NTAccount|\.Translate\b/u,
  "The private-runtime ACL observer must read only SID forms.",
);
const environment = Object.entries(process.env)
  .filter(([, value]) => value !== undefined)
  .map(([key, value]) => `${key}=${value}`);
const quote = (value) =>
  `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const startDeleteSharingDeniedReader = async (path) => {
  const child = spawn(
    "powershell.exe",
    windowsPowerShellArguments(
      "$ErrorActionPreference = 'Stop'; " +
        "$stream = [IO.File]::Open($env:REA_CLEANUP_HELD_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); " +
        "try { [Console]::WriteLine('ready'); [void][Console]::In.ReadLine() } " +
        "finally { $stream.Dispose() }",
    ),
    {
      env: { ...windowsPowerShellEnvironment, REA_CLEANUP_HELD_PATH: path },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const closed = once(child, "close");
  void closed.catch(() => undefined);
  try {
    const [ready] = await once(child.stdout, "data", {
      signal: AbortSignal.timeout(windowsPowerShellObserverTimeoutMs),
    });
    assert.equal(String(ready).trim(), "ready");
  } catch (cause) {
    try {
      child.kill();
      await closed;
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Reader startup and child cleanup failed",
        { cause },
      );
    }
    throw cause;
  }
  return { child, closed };
};
const stopDeleteSharingDeniedReader = async ({ child, closed }) => {
  child.kill();
  await closed;
};
const live = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const launch = (arguments_) =>
  native.call("process_spawn", [
    process.execPath,
    [process.execPath, ...arguments_].map(quote).join(" "),
    workspace,
    environment,
  ]);
const wait = async (child) => {
  let output = "";
  for (let attempt = 0; attempt < 400; attempt++) {
    const state = native.call("process_poll", [child.handle]);
    output += state.stdout.toString();
    if (
      state.exitCode !== null &&
      state.activeProcesses === 0 &&
      state.stdoutEnded &&
      state.stderrEnded
    )
      return { ...state, output };
    await delay();
  }
  throw new Error("Owned job did not settle within the fixture deadline.");
};
const report = { ok: false, artifact: "verified", controls: {}, processes: {} };
try {
  // Exercise the loader in a process whose image is not named node.exe. The
  // ordinary Windows lane otherwise cannot detect eager Node-API imports.
  const renamedHost = join(workspace, "rea-renamed-node.exe");
  const renamedHostFixture = join(workspace, "renamed-host.mjs");
  const loaderUrl = pathToFileURL(
    join(packageRoot, "dist/windows/WindowsNativeLoader.js"),
  ).href;
  await copyFile(process.execPath, renamedHost);
  await writeFile(
    renamedHostFixture,
    `import {basename} from 'node:path';
import {requireWindowsNativeAuthority} from ${JSON.stringify(loaderUrl)};
const {inspection}=requireWindowsNativeAuthority();
process.stdout.write(JSON.stringify({executable:basename(process.execPath),abiVersion:inspection.abiVersion}));\n`,
  );
  const renamedHostResult = execFileSync(renamedHost, [renamedHostFixture], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  assert.deepEqual(JSON.parse(renamedHostResult), {
    executable: "rea-renamed-node.exe",
    abiVersion: 1,
  });
  report.controls.renamedHostNodeApi = true;
  const sourceDirectory = join(workspace, "source");
  await mkdir(sourceDirectory);
  const source = join(sourceDirectory, "target.bin");
  await writeFile(source, Buffer.alloc(1024 * 1024, 0x37));
  const sourceIdentity = native.call("open", [source]);
  try {
    for (const requested of [
      source.replaceAll("\\", "/"),
      source.replace(/\\/u, "/"),
    ]) {
      const admitted = native.call("open", [requested]);
      try {
        assert.equal(admitted.requestedPath, requested);
        assert.equal(admitted.finalPath, sourceIdentity.finalPath);
        assert.equal(admitted.fileId, sourceIdentity.fileId);
        assert.equal(native.call("read", [admitted.handle, 0, 1])[0], 0x37);
      } finally {
        native.call("close", [admitted.handle]);
      }
    }
  } finally {
    native.call("close", [sourceIdentity.handle]);
  }
  for (const rejected of [
    source.replace(/^([A-Za-z]):\\/u, "$1:"),
    `${sourceDirectory}/../source/target.bin`,
    `${sourceDirectory}//target.bin`,
    `${source}:stream`,
    `\\\\?\\${source.replaceAll("\\", "/")}`,
    "//localhost/share/target.bin",
  ])
    assert.throws(() => native.call("open", [rejected]));
  assert.throws(
    () => native.call("cutter_bridge_verify_directory", [sourceDirectory]),
    /owner|DACL/u,
  );
  report.controls.ordinaryDriveSeparatorsAndRequestedIdentity = true;
  // An owned runtime's DELETE lease conflicts with a fresh parent admission.
  // This produces a genuine sharing failure after successful authority caching,
  // without another executable, and proves that no child runtime was created.
  const sharingParent = WindowsPrivateRuntime.create(
    workspace,
    "rea-sharing-parent-",
  );
  try {
    await assert.rejects(
      PrivateRuntimeRoot.create({ parent: sharingParent.observation.path }),
      (failure) => {
        assert.ok(failure instanceof PrivateRuntimeRootUnavailableError);
        assert.equal(failure.retryable, true);
        assert.ok(failure.cause instanceof Error);
        assert.equal(failure.cause.win32Code, 32);
        assert.equal(failure.cause.runtimeAllocation, "not-started");
        return true;
      },
    );
    assert.deepEqual(await readdir(sharingParent.observation.path), []);
    report.controls.transientRuntimeAdmissionBeforeAllocation = true;
  } finally {
    await sharingParent.close();
  }
  const driveRoot = parse(workspace).root;
  const runtimeParent = ghidraSessionRoot({
    base: join(driveRoot, ".Tmp", "scratch"),
  });
  assert.equal(runtimeParent, driveRoot);
  const driveRootRuntime = native.call("runtime_create", [
    runtimeParent,
    "rea-drive-root-",
  ]);
  try {
    assert.equal(driveRootRuntime.path.startsWith(`${driveRoot}\\`), false);
    assert.equal(dirname(driveRootRuntime.path), driveRoot);
    const snapshot = await native.call("runtime_snapshot", [
      driveRootRuntime.handle,
      source,
      "probe.bin",
    ]);
    const sourceBytes = await readFile(source);
    assert.equal(
      snapshot.sha256,
      createHash("sha256").update(sourceBytes).digest("hex"),
    );
    assert.equal(snapshot.source.requestedPath, source);
    const readback = native.call("runtime_open", [
      driveRootRuntime.handle,
      "probe.bin",
    ]);
    try {
      assert.equal(readback.size, sourceBytes.byteLength);
      assert.deepEqual(
        native.call("read", [readback.handle, 0, 65536]),
        sourceBytes.subarray(0, 65536),
      );
    } finally {
      native.call("close", [readback.handle]);
    }
  } finally {
    native.call("runtime_close", [driveRootRuntime.handle]);
  }
  assert.equal(await exists(driveRootRuntime.path), false);
  report.controls.driveRootRuntimeParent = true;
  const snapshotOwner = WindowsPrivateRuntime.create(
    workspace.replace(/\\/u, "/"),
    "single-flight-",
  );
  try {
    const rejectedController = new AbortController();
    const requestedSource = source.replaceAll("\\", "/");
    const accepted = snapshotOwner.snapshot(requestedSource, "accepted.bin");
    const rejected = snapshotOwner.snapshot(
      source,
      "rejected.bin",
      rejectedController.signal,
    );
    rejectedController.abort();
    await assert.rejects(rejected, /Runtime snapshot is still pending/u);
    const completed = await accepted;
    assert.equal(completed.source.requestedPath, requestedSource);
    assert.equal(
      completed.sha256,
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    );
    assert.equal(
      await exists(join(snapshotOwner.observation.path, "rejected.bin")),
      false,
    );
    report.controls.singleFlightCancellationOwnership = true;
  } finally {
    await snapshotOwner.close();
  }
  const unrelatedFile = join(workspace, "unrelated-file");
  await writeFile(unrelatedFile, "preserve unrelated writes");
  if (process.argv[3] !== undefined) {
    await verifyVolumeRootAppendLease({
      fixturePath: process.argv[3],
      volumeRoot: parse(source).root,
      verifyAdmission: () => {
        const rootGuard = native.call("open", [source]);
        native.call("close", [rootGuard.handle]);
      },
    });
    report.controls.volumeRootAdmissionWithAppendHandle = true;
  }
  const admitted = native.call("open", [source]);
  try {
    await assert.rejects(
      rename(sourceDirectory, `${sourceDirectory}-replacement`),
    );
    await assert.rejects(open(source, "r+"));
    await rename(unrelatedFile, `${unrelatedFile}-renamed`);
    if (process.argv[3] !== undefined) {
      const observation = JSON.parse(
        execFileSync(
          resolve(process.argv[3]),
          ["reparse-directory", sourceDirectory, workspace],
          { encoding: "utf8" },
        ),
      );
      assert.equal(
        observation.reparseConversionDenied,
        true,
        "An admitted ancestor was converted into a junction.",
      );
      report.controls.inPlaceAncestorReparseDenied = true;
    }
    assert.throws(() => native.call("read", [{}, 0, 1]));
    assert.throws(() => native.call("read", [admitted.handle, NaN, 1]));
    assert.equal(native.call("read", [admitted.handle, 0, 1])[0], 0x37);
  } finally {
    native.call("close", [admitted.handle]);
  }
  assert.throws(() => native.call("read", [admitted.handle, 0, 1]));
  const junction = join(workspace, "junction");
  await symlink(sourceDirectory, junction, "junction");
  assert.throws(
    () => native.call("open", [join(junction, "target.bin")]),
    /Reparse/u,
  );
  assert.throws(
    () => native.call("cutter_bridge_verify_directory", [junction]),
    /Reparse/u,
  );
  assert.throws(() => native.call("open", [source + ":stream"]));
  const runtime = native.call("runtime_create", [
    workspace.replaceAll("\\", "/"),
    "private root with spaces-",
  ]);
  const sentinel = join(sourceDirectory, "sentinel");
  await writeFile(sentinel, "preserve");
  const runtimeVerificationErrors = [];
  try {
    const acl = JSON.parse(
      observeWithWindowsPowerShell(privateRuntimeAclObserver, {
        REA_TEST_PRIVATE_RUNTIME_PATH: runtime.path,
      }),
    );
    assert.deepEqual(acl, {
      protected: true,
      ownerMatchesUser: true,
      trusteesOnlyUserAndSystem: true,
      count: 2,
      rootReadonly: true,
    });
    native.call("runtime_mkdir", [runtime.handle, "inputs"]);
    native.call("runtime_write", [
      runtime.handle,
      "descriptor.json",
      Buffer.from("fixture"),
    ]);
    assert.equal(
      native.call("cutter_bridge_verify_directory", [runtime.path]).privateDacl,
      true,
    );
    assert.equal(
      native
        .call("cutter_bridge_read_descriptor", [
          runtime.path,
          "descriptor.json",
          64 * 1024,
        ])
        .toString("utf8"),
      "fixture",
    );
    const descriptorJunction = join(runtime.path, "descriptor-link.json");
    await symlink(sourceDirectory, descriptorJunction, "junction");
    assert.throws(() =>
      native.call("cutter_bridge_read_descriptor", [
        runtime.path,
        "descriptor-link.json",
        64 * 1024,
      ]),
    );
    assert.throws(
      () =>
        native.call("cutter_bridge_read_descriptor", [
          runtime.path,
          "descriptor.json",
          3,
        ]),
      /byte limit/u,
    );
    assert.throws(
      () =>
        native.call("cutter_bridge_read_descriptor", [
          runtime.path,
          "..\\escape.json",
          64 * 1024,
        ]),
      /filename component/u,
    );
    assert.throws(() =>
      native.call("runtime_write", [
        runtime.handle,
        "descriptor.json",
        Buffer.from("replace"),
      ]),
    );
    assert.throws(() =>
      native.call("runtime_mkdir", [runtime.handle, "..\\escape"]),
    );
    const pending = native.call("runtime_snapshot", [
      runtime.handle,
      source,
      "inputs\\target.bin",
    ]);
    assert.ok(pending instanceof Promise);
    assert.throws(
      () => native.call("runtime_close", [runtime.handle]),
      /pending/u,
    );
    const snapshot = await pending;
    assert.equal(
      snapshot.sha256,
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    );
    assert.equal(snapshot.source.requestedPath, source);
    await assert.rejects(
      writeFile(join(runtime.path, "inputs", "target.bin"), "replace"),
    );
    await symlink(
      sourceDirectory,
      join(runtime.path, "outside-junction"),
      "junction",
    );
    const cancelled = native.call("runtime_snapshot", [
      runtime.handle,
      source,
      "cancelled.bin",
    ]);
    native.call("runtime_snapshot_cancel", [runtime.handle]);
    await assert.rejects(cancelled, /cancelled/u);
    assert.equal(await exists(join(runtime.path, "cancelled.bin")), false);
    const readbackRuntime = WindowsPrivateRuntime.create(
      workspace.replaceAll("\\", "/"),
      "readback-",
    );
    try {
      readbackRuntime.writeFile("written.txt", "runtime-write-readback");
      assert.equal(
        readbackRuntime.readFile("written.txt"),
        "runtime-write-readback",
      );
      const readbackSnapshot = await readbackRuntime.snapshot(
        source,
        "snapshot.bin",
      );
      assert.equal(
        readbackSnapshot.sha256,
        createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
      );
      assert.equal(
        readbackRuntime.readFile("snapshot.bin"),
        await readFile(source, "utf8"),
      );
      const writtenPath = join(readbackRuntime.observation.path, "written.txt");
      await assert.rejects(writeFile(writtenPath, "replace"));
      await assert.rejects(rename(writtenPath, `${writtenPath}.renamed`));
      await assert.rejects(rm(writtenPath));
      assert.equal(
        readbackRuntime.readFile("written.txt"),
        "runtime-write-readback",
      );
      const snapshotPath = join(
        readbackRuntime.observation.path,
        "snapshot.bin",
      );
      // Java RandomAccessFile uses read/write sharing without delete sharing.
      // Exercise that independent Win32 reader contract without requiring Java.
      const readerDigest = observeWithWindowsPowerShell(
        String.raw`
          $stream = [IO.File]::Open($env:REA_SNAPSHOT_READER_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          $hash = [Security.Cryptography.SHA256]::Create()
          try { [Console]::Out.Write([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) }
          finally { $hash.Dispose(); $stream.Dispose() }
        `,
        { REA_SNAPSHOT_READER_PATH: snapshotPath },
      );
      assert.equal(readerDigest, readbackSnapshot.sha256);
      await assert.rejects(writeFile(snapshotPath, "replace"));
      await assert.rejects(rename(snapshotPath, `${snapshotPath}.renamed`));
      await assert.rejects(rm(snapshotPath));
      assert.equal(
        readbackRuntime.readFile("snapshot.bin"),
        await readFile(source, "utf8"),
      );
      report.controls = {
        ...report.controls,
        completedRuntimeFileReadback: true,
        completedRuntimeFileMutationDenied: true,
        snapshotReadWriteSharingReader: true,
      };
    } finally {
      await readbackRuntime.close();
    }
    const retryRuntime = WindowsPrivateRuntime.create(
      workspace,
      "cleanup-retry-",
    );
    const heldPath = join(retryRuntime.observation.path, "snapshot.bin");
    let holder;
    await withVerifierCleanup(async () => {
      await retryRuntime.snapshot(source, "snapshot.bin");
      holder = await startDeleteSharingDeniedReader(heldPath);
      // The reader denies delete sharing. Cleanup must retain ownership when
      // its handle-relative open receives ERROR_SHARING_VIOLATION (32) through
      // the bounded automatic retries; a later explicit close must succeed.
      await assert.rejects(retryRuntime.close(), { win32Code: 32 });
      assert.equal(
        windowsPrivateRuntime(retryRuntime.observation.path),
        retryRuntime,
      );
      assert.equal(await exists(heldPath), true);
      assert.throws(
        () => retryRuntime.writeFile("after-close.txt", "forbidden"),
        /cleanup is pending/u,
      );
      holder.child.stdin.end("\n");
      const [exitCode] = await holder.closed;
      assert.equal(exitCode, 0);
      await retryRuntime.close();
      await retryRuntime.close();
      assert.equal(await exists(retryRuntime.observation.path), false);
      assert.throws(
        () => windowsPrivateRuntime(retryRuntime.observation.path),
        /No native private runtime/u,
      );
      report.controls.cleanupFailureRetainsOwnershipForRetry = true;
    }, [
      async () => {
        if (holder !== undefined) await stopDeleteSharingDeniedReader(holder);
      },
      () => retryRuntime.close(),
    ]);
    const transientRuntime = WindowsPrivateRuntime.create(
      workspace,
      "cleanup-transient-",
    );
    const transientHeldPath = join(
      transientRuntime.observation.path,
      "snapshot.bin",
    );
    let transientHolder;
    await withVerifierCleanup(async () => {
      await transientRuntime.snapshot(source, "snapshot.bin");
      transientHolder = await startDeleteSharingDeniedReader(transientHeldPath);
      // Keep the reader held through the first close attempt. Without retries,
      // close rejects before the next event-loop turn; with retries, it remains
      // pending until the caller releases this sharing conflict.
      let closeSettled = false;
      const closing = transientRuntime.close();
      void closing.then(
        () => {
          closeSettled = true;
        },
        () => {
          closeSettled = true;
        },
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closeSettled, false);
      transientHolder.child.stdin.end("\n");
      const [, [exitCode]] = await Promise.all([
        closing,
        transientHolder.closed,
      ]);
      assert.equal(exitCode, 0);
      assert.equal(await exists(transientRuntime.observation.path), false);
      assert.throws(
        () => windowsPrivateRuntime(transientRuntime.observation.path),
        /No native private runtime/u,
      );
      report.controls.cleanupTransientConflictRetries = true;
    }, [
      async () => {
        if (transientHolder !== undefined)
          await stopDeleteSharingDeniedReader(transientHolder);
      },
      () => transientRuntime.close(),
    ]);
    report.controls = {
      ...report.controls,
      protectedDaclReadback: true,
      sourceReplacementDenied: true,
      sourceWriteDenied: true,
      unrelatedFilesystemRenamePreserved: true,
      junctionAdmissionDenied: true,
      alternateStreamsDenied: true,
      forgedAndClosedHandlesDenied: true,
      immutableSnapshotDigest: true,
      asynchronousSnapshot: true,
      snapshotCancellation: true,
    };
    // Paths are newline-separated: Windows file names cannot contain control
    // characters, and the observer then needs no JSON parser.
    const readonlyChildren = JSON.parse(
      observeWithWindowsPowerShell(
        String.raw`
          $observations = foreach ($item in $env:REA_TEST_READONLY_CHILDREN.Split([char]10)) {
            $current = [int][IO.File]::GetAttributes($item)
            $next = if (($current -band 16) -ne 0) { $current -bor 1 } else { 1 }
            [IO.File]::SetAttributes($item, [IO.FileAttributes]$next)
            $a = [int][IO.File]::GetAttributes($item)
            '{"readonly":' + (Format-JsonBoolean (($a -band 1) -ne 0)) +
              ',"directory":' + (Format-JsonBoolean (($a -band 16) -ne 0)) +
              ',"onlyReadonly":' + (Format-JsonBoolean ($a -eq 1)) + '}'
          }
          [Console]::Out.Write('[' + ($observations -join ',') + ']')
        `,
        {
          REA_TEST_READONLY_CHILDREN: [
            join(runtime.path, "inputs"),
            join(runtime.path, "inputs", "target.bin"),
          ].join("\n"),
        },
      ),
    );
    assert.deepEqual(readonlyChildren, [
      { readonly: true, directory: true, onlyReadonly: false },
      { readonly: true, directory: false, onlyReadonly: true },
    ]);
  } catch (failure) {
    runtimeVerificationErrors.push(failure);
  }
  try {
    native.call("runtime_close", [runtime.handle]);
  } catch (cleanupFailure) {
    runtimeVerificationErrors.push(cleanupFailure);
  }
  if (runtimeVerificationErrors.length === 1)
    throw runtimeVerificationErrors[0];
  if (runtimeVerificationErrors.length > 1)
    throw new AggregateError(
      runtimeVerificationErrors,
      "Native runtime verification and cleanup failed",
    );
  assert.equal(await exists(runtime.path), false);
  assert.equal(await readFile(sentinel, "utf8"), "preserve");
  report.controls.cleanupDoesNotTraverseJunctions = true;
  report.controls.readonlyRootAndChildrenRemoved = true;
  report.controls.readonlyFileWithoutArchiveAttributeRemoved = true;
  const fixture = join(workspace, "tree.mjs");
  await writeFile(
    fixture,
    `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const depth=Number(process.argv[2]); writeFileSync(process.argv[3]+depth,String(process.pid));
if(depth>0)spawn(process.execPath,[import.meta.filename,String(depth-1),process.argv[3]],{detached:true,stdio:'ignore'});
setInterval(()=>{},1000);\n`,
  );
  const pidPrefix = join(workspace, "pid-");
  const child = launch(["--max-old-space-size=128", fixture, "2", pidPrefix]);
  const unrelated = spawn(
    process.execPath,
    ["--max-old-space-size=128", "-e", "setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  try {
    for (
      let attempt = 0;
      attempt < 200 && !(await exists(pidPrefix + "0"));
      attempt++
    )
      await delay();
    const pids = await Promise.all(
      [0, 1, 2].map(async (depth) =>
        Number(await readFile(pidPrefix + depth, "utf8")),
      ),
    );
    assert.ok(native.call("process_poll", [child.handle]).activeProcesses >= 3);
    native.call("process_terminate", [child.handle]);
    assert.equal((await wait(child)).activeProcesses, 0);
    assert.equal(pids.some(live), false);
    assert.ok(unrelated.pid !== undefined && live(unrelated.pid));
    report.processes.descendantsAndDetachedDescendantsTerminated = true;
    report.processes.unrelatedProcessPreserved = true;
  } finally {
    native.call("process_terminate", [child.handle]);
    await wait(child);
    native.call("process_close", [child.handle]);
    if (unrelated.exitCode === null) {
      const closed = new Promise((resolve) => unrelated.once("close", resolve));
      unrelated.kill();
      await closed;
    }
  }
  const ownerClose = launch([
    "--max-old-space-size=128",
    fixture,
    "0",
    join(workspace, "owner-close-"),
  ]);
  native.call("process_close", [ownerClose.handle]);
  for (let attempt = 0; attempt < 100 && live(ownerClose.pid); attempt++)
    await delay();
  assert.equal(live(ownerClose.pid), false);
  report.processes.killOnOwnerClose = true;
  report.processes.protocolInput = await verifyWindowsProtocolInput(
    packageRoot,
    workspace,
  );
  report.processes.jobMemoryLimit = await verifyWindowsJobMemoryLimit(
    packageRoot,
    workspace,
  );
  const exited = launch([
    "--max-old-space-size=128",
    "-e",
    "console.log('observed');process.exit(7)",
  ]);
  const settled = await wait(exited);
  assert.equal(settled.exitCode, 7);
  assert.match(settled.output, /observed/u);
  native.call("process_close", [exited.handle]);
  report.processes.normalExitAndOutput = true;
  const forwardCommand = process.execPath.replaceAll("\\", "/");
  const forwardProcess = native.call("process_spawn", [
    forwardCommand,
    [forwardCommand, "-e", "console.log('forward executable')"]
      .map(quote)
      .join(" "),
    workspace,
    environment,
  ]);
  try {
    const completed = await wait(forwardProcess);
    assert.equal(completed.exitCode, 0);
    assert.match(completed.output, /forward executable/u);
    report.processes.ordinaryDriveSeparators = true;
  } finally {
    native.call("process_close", [forwardProcess.handle]);
  }
  const boundaryFixture = process.argv[3];
  if (boundaryFixture !== undefined) {
    const before = JSON.parse(
      execFileSync(boundaryFixture, [], { encoding: "utf8" }),
    );
    const boundary = native.call("process_spawn", [
      boundaryFixture,
      `${quote(boundaryFixture)} breakaway`,
      workspace,
      environment,
    ]);
    const denied = await wait(boundary);
    native.call("process_close", [boundary.handle]);
    assert.equal(JSON.parse(denied.output).breakawayDenied, true);
    const tokenChild = native.call("process_spawn", [
      boundaryFixture,
      quote(boundaryFixture),
      workspace,
      environment,
    ]);
    const observed = await wait(tokenChild);
    native.call("process_close", [tokenChild.handle]);
    assert.equal(JSON.parse(observed.output).defaultOwnerIsUser, true);
    const after = JSON.parse(
      execFileSync(boundaryFixture, [], { encoding: "utf8" }),
    );
    assert.deepEqual(after, before);
    report.processes.breakawayDenied = true;
    report.processes.childOwnerNormalizedWithoutChangingCaller = true;
    report.callerToken = before;
    const environmentChild = native.call("process_spawn", [
      boundaryFixture,
      `${quote(boundaryFixture)} environment`,
      workspace,
      [
        "z_REA=z",
        "_REA=underscore",
        "A_REA=a",
        "REA_CASE=first",
        "rea_case=last",
        "REA_ß=sharp",
        "REA_SS=double",
      ],
    ]);
    const childEnvironment = await wait(environmentChild);
    native.call("process_close", [environmentChild.handle]);
    assert.deepEqual(JSON.parse(childEnvironment.output), {
      ordinallySorted: true,
      lastDuplicateSelected: true,
      unicodeNamesPreserved: true,
    });
    report.processes.windowsEnvironmentSemantics = true;
    // Observed through this process's own id: a separate probe process would
    // get its own processor group, so it cannot stand in for the process that
    // spawns the child.
    const callerAffinity = JSON.parse(
      execFileSync(boundaryFixture, ["affinity", String(process.pid)], {
        encoding: "utf8",
      }),
    );
    const affinityChild = native.call("process_spawn", [
      boundaryFixture,
      `${quote(boundaryFixture)} affinity`,
      workspace,
      environment,
    ]);
    const observedAffinity = await wait(affinityChild);
    native.call("process_close", [affinityChild.handle]);
    assert.equal(observedAffinity.exitCode, 0);
    const childAffinity = JSON.parse(observedAffinity.output);
    // Masks cross as hexadecimal strings because a mask can exceed the
    // safe-integer range. Sharing one processor group makes the caller's mask
    // applicable, so it must be inherited exactly. Windows placing the child in
    // another group is only permitted when the caller asked for no bound of its
    // own, which its group's whole active set establishes; a narrower mask has
    // to fail the spawn rather than widen to that group's default.
    const sharedGroup =
      callerAffinity.singleProcessorGroup &&
      childAffinity.singleProcessorGroup &&
      callerAffinity.processorGroup === childAffinity.processorGroup;
    if (sharedGroup)
      assert.equal(childAffinity.affinityMask, callerAffinity.affinityMask);
    else assert.equal(callerAffinity.affinityMask, callerAffinity.systemMask);
    report.processes.callerAffinityBoundsOwnedProcessOrRefusesToWiden = true;
    report.callerAffinity = {
      ...callerAffinity,
      sharedGroupWithChild: sharedGroup,
    };
  }
  const ownerFixture = join(workspace, "owner.mjs");
  const ownerPidFile = join(workspace, "crash-child.pid");
  const moduleUrl = pathToFileURL(
    join(packageRoot, "dist/windows/WindowsNativeLoader.js"),
  ).href;
  await writeFile(
    ownerFixture,
    `import {writeFileSync} from 'node:fs';
import {requireWindowsNativeAuthority} from ${JSON.stringify(moduleUrl)};
const native=requireWindowsNativeAuthority();
const env=Object.entries(process.env).map(([k,v])=>k+'='+v);
const child=native.call('process_spawn',[process.execPath,${JSON.stringify([process.execPath, "--max-old-space-size=128", fixture, "0", join(workspace, "crash-descendant-")].map(quote).join(" "))},${JSON.stringify(workspace)},env]);
writeFileSync(${JSON.stringify(ownerPidFile)},String(child.pid));setInterval(()=>{},1000);\n`,
  );
  const owner = spawn(
    process.execPath,
    ["--max-old-space-size=128", ownerFixture],
    { stdio: "ignore" },
  );
  try {
    for (
      let attempt = 0;
      attempt < 200 && !(await exists(ownerPidFile));
      attempt++
    )
      await delay();
    const pid = Number(await readFile(ownerPidFile, "utf8"));
    const closed = new Promise((resolve) => owner.once("close", resolve));
    owner.kill("SIGKILL");
    await closed;
    for (let attempt = 0; attempt < 100 && live(pid); attempt++) await delay();
    assert.equal(live(pid), false);
    report.processes.ownerForcedExitKillsOwnedChild = true;
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) {
      const closed = new Promise((resolve) => owner.once("close", resolve));
      owner.kill("SIGKILL");
      await closed;
    }
  }
  report.ok = true;
  if (process.argv[4] !== undefined)
    await writeFile(process.argv[4], `${JSON.stringify(report)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (cause) {
  console.error(
    "Native conformance failed",
    cause.code ?? cause.name,
    cause.constraint ?? "assertion",
  );
  throw cause;
} finally {
  await rm(workspace, { recursive: true, force: true }).catch((cause) =>
    console.error("Fixture cleanup failed", cause.code),
  );
}
