import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Verify changed-source admission and retained private database identity through MCP. */
export async function verifyGhidraTargetAdmission({
  call,
  reject,
  target,
  entry,
  runtimeRoot,
}) {
  const workspace = await mkdtemp(
    join(tmpdir(), "rea-ghidra-source-admission-"),
  );
  const source = join(workspace, "caller-selected.%PATH%");
  try {
    const original = await readFile(target.path);
    await writeFile(source, original);
    await call("close_binary");
    const opened = await call("open_binary", {
      path: source,
      provider_id: "ghidra",
    });
    assert.equal(opened.sha256, target.sha256);
    const selectedPath = await realpath(source);
    assert.equal(opened.path, selectedPath);
    const before = await call("binary_session");
    const changed = Buffer.concat([
      original,
      Buffer.from("REA_SOURCE_CHANGED_AFTER_OPEN"),
    ]);
    const changedSha256 = createHash("sha256").update(changed).digest("hex");
    await writeFile(source, changed);
    const failure = await reject("analyze_function", { procedure: entry });
    assert.equal(failure.code, "artifact_changed");
    assert.equal(failure.category, "integrity_mismatch");
    assert.equal(failure.details.operation, "analyze_function");
    assert.equal(failure.details.path, selectedPath);
    assert.ok(failure.details.reason.includes(target.sha256));
    assert.ok(failure.details.reason.includes(changedSha256));
    assert.match(failure.remediation.action, /open_binary/u);
    assert.doesNotMatch(failure.remediation.action, /doctor/u);
    const after = await call("binary_session");
    assert.equal(after.analysis_run.run_id, before.analysis_run.run_id);
    assert.equal(after.sha256, target.sha256);
    assert.equal(
      after.capabilities.find(
        ({ operation }) => operation === "analyze_function",
      )?.available,
      true,
      "An artifact identity mismatch must not mark the installed provider unavailable",
    );
    assert.deepEqual(
      (await readdir(runtimeRoot)).filter((name) =>
        name.startsWith("rea-ghidra-"),
      ),
      [],
      "Failed admission must remove the private snapshot without launching Ghidra",
    );
    assert.deepEqual(await readFile(source), changed);
    const permissionDenied = await verifySourceReadFailures({
      call,
      reject,
      source,
      bytes: changed,
      entry,
      runtimeRoot,
    });

    const reopened = await call("open_binary", {
      path: source,
      provider_id: "ghidra",
    });
    assert.equal(reopened.sha256, changedSha256);
    assert.notEqual(
      (await call("binary_session")).analysis_run.run_id,
      before.analysis_run.run_id,
    );
    const dossier = await call("analyze_function", {
      procedure: entry,
      detail: "complete",
    });
    const instruction = await call("inspect_native_instruction", {
      address: entry,
    });
    assert.equal(dossier.procedure.address, entry);
    assert.equal(instruction.status, "decoded");
    for (const address of [
      entry.toUpperCase(),
      entry.slice(2),
      `0x0000${entry.slice(2)}`,
      `ram:${entry}`,
      `%72%61%6D:${entry}`,
    ]) {
      assert.deepEqual(
        await call("inspect_native_instruction", { address }),
        instruction,
      );
      assert.equal(
        (await call("resolve_containing_procedure", { address })).procedure
          .address,
        entry,
      );
    }
    // Imported facts belong to the captured bytes even if the caller's path disappears.
    await rm(source);
    assert.deepEqual(
      await call("analyze_function", { procedure: entry, detail: "complete" }),
      dossier,
    );
    assert.deepEqual(
      await call("inspect_native_instruction", { address: entry }),
      instruction,
    );
    assert.equal((await call("binary_session")).sha256, changedSha256);
    await call("close_binary");
    await call("open_binary", { path: target.path, provider_id: "ghidra" });
    return { permissionDenied };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifySourceReadFailures({
  call,
  reject,
  source,
  bytes,
  entry,
  runtimeRoot,
}) {
  const permissionDenied =
    typeof process.getuid === "function" && process.getuid() !== 0;
  const scenarios = [
    "missing",
    "directory",
    ...(permissionDenied ? ["permission"] : []),
  ];
  for (const scenario of scenarios) {
    // Same-target reopen may admit restored bytes through retained-client health.
    // Each rejection needs a cold client, without an existing private snapshot.
    await call("close_binary");
    await call("open_binary", { path: source, provider_id: "ghidra" });
    const before = await call("binary_session");
    if (scenario === "permission") await chmod(source, 0);
    else {
      await rm(source);
      if (scenario === "directory") await mkdir(source);
    }
    try {
      const failure = await reject("analyze_function", { procedure: entry });
      assert.equal(
        failure.code,
        scenario === "permission" ? "access_denied" : "artifact_changed",
      );
      assert.equal(failure.details.path, before.path);
      assert.equal(failure.details.operation, "analyze_function");
      if (scenario === "permission") {
        assert.ok(["EACCES", "EPERM"].includes(failure.details.system_code));
        assert.match(failure.remediation.action, /read access/u);
      } else assert.match(failure.remediation.action, /open_binary/u);
      assert.doesNotMatch(failure.remediation.action, /doctor/u);
      const after = await call("binary_session");
      assert.equal(after.analysis_run.run_id, before.analysis_run.run_id);
      assert.equal(after.sha256, before.sha256);
      assert.equal(
        after.capabilities.find(
          ({ operation }) => operation === "analyze_function",
        )?.available,
        true,
      );
      assert.deepEqual(
        (await readdir(runtimeRoot)).filter((name) =>
          name.startsWith("rea-ghidra-"),
        ),
        [],
      );
    } finally {
      if (scenario === "permission") await chmod(source, 0o600);
      await rm(source, { recursive: true, force: true });
      await writeFile(source, bytes);
    }
  }
  return permissionDenied;
}
