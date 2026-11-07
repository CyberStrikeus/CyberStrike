import assert from "node:assert/strict";

/** Prove competing Linux launches cannot forward documents into the active MCP owner. */
export async function verifyLinuxHopperLaunchIsolation({
  call,
  runCli,
  dispatcher,
  primary,
  secondary,
}) {
  const documents = await call("list_documents");
  const current = await call("current_document");
  const procedures = await call("list_procedures");
  for (const target of [primary, secondary]) {
    let failure;
    try {
      await runCli([
        dispatcher,
        "inspect",
        target,
        "--provider",
        "hopper",
        "--format",
        "json",
      ]);
    } catch (error) {
      assert.equal(error.code, 1);
      failure = JSON.parse(error.stdout);
    }
    assert.ok(
      failure,
      "A competing CLI launch was allowed to reach Linux Hopper",
    );
    assert.equal(failure.code, "provider_unavailable");
    assert.match(
      failure.message,
      /Linux Hopper is already active in REA session/u,
    );
    assert.ok(failure.message.includes(target));
    assert.deepEqual(
      await call("list_documents"),
      documents,
      "A rejected CLI launch changed the owning session's documents",
    );
    assert.equal(await call("current_document"), current);
    assert.deepEqual(await call("list_procedures"), procedures);
  }
  return {
    sameTargetRejected: true,
    differentTargetRejected: true,
    ownerDocumentsPreserved: true,
  };
}
