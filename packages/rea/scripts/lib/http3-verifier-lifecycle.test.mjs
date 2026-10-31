import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import {
  attemptAll,
  prepareAttempt,
  publishAttempt,
  finishProducerGroups,
} from "./http3-verifier-lifecycle.mjs";
import { cleanupOwnedProcessGroup } from "../../dist/process/ProcessOwnership.js";
import { runOwnedCommand } from "../../dist/process/OwnedCommand.js";
import { verifyConcurrency } from "./http3-capture-assertions.mjs";

async function waitForFile(path) {
  const signal = AbortSignal.timeout(5_000);
  for (;;) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await setTimeout(10, undefined, { signal });
  }
}

function startAttemptWorker(root, report) {
  const worker = `
    import { readFile, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { setTimeout } from "node:timers/promises";
    import { prepareAttempt, publishAttempt } from ${JSON.stringify(
      new URL("./http3-verifier-lifecycle.mjs", import.meta.url).href,
    )};
    const [root, serialized] = process.argv.slice(1);
    const report = JSON.parse(serialized);
    const attempt = await prepareAttempt(root, true, report);
    await writeFile(join(root, report.run_id + ".ready"), "");
    for (;;) {
      try { await readFile(join(root, report.run_id + ".finish")); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await setTimeout(10);
    }
    await publishAttempt(root, attempt.directory, report);
  `;
  return runOwnedCommand(
    {
      command: process.execPath,
      arguments: [
        "--input-type=module",
        "--eval",
        worker,
        root,
        JSON.stringify(report),
      ],
      cwd: root,
      hostEnvironment: process.env,
      runId: randomUUID(),
    },
    { timeoutMs: 10_000, diagnosticBytes: 4096 },
  ).then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
}

test("cleanup continues through failed closes and reaches its audit", async () => {
  const attempted = [];
  const failures = await attemptAll(
    ["client", "transport", "audit"].map((name) => [
      name,
      async () => {
        attempted.push(name);
        if (name !== "audit") throw new Error(`${name} failed`);
      },
    ]),
  );
  assert.deepEqual(attempted, ["client", "transport", "audit"]);
  assert.deepEqual(
    failures.map((failure) => failure.action),
    ["client", "transport"],
  );
});

test("a failed reinspection cannot leave the earlier success as the current result", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-http3-results-"));
  try {
    await writeFile(
      join(root, "verification.json"),
      '{"status":"passed","run_id":"legacy"}',
    );
    const first = await prepareAttempt(root, true, { run_id: "first" });
    await publishAttempt(root, first.directory, {
      run_id: "first",
      status: "passed",
    });
    const next = await prepareAttempt(root, true, { run_id: "next" });
    assert.equal(
      JSON.parse(await readFile(join(root, "verification-latest.json"))).status,
      "running",
    );
    await publishAttempt(root, next.directory, {
      run_id: "next",
      status: "failed",
      error: { message: "new failure" },
    });
    assert.equal(
      JSON.parse(await readFile(join(root, "verification-latest.json"))).run_id,
      "next",
    );
    assert.equal(
      JSON.parse(await readFile(join(root, "verification-latest.json"))).status,
      "failed",
    );
    await assert.rejects(readFile(join(next.directory, "verification.json")), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(root, "verification.json")), {
      code: "ENOENT",
    });
    assert.equal(
      JSON.parse(await readFile(join(first.directory, "verification.json")))
        .status,
      "passed",
    );
    assert.equal(
      JSON.parse(
        await readFile(join(first.directory, "legacy-verification.json")),
      ).run_id,
      "legacy",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate overlapping attempts finishing in reverse order retain the newer failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-http3-overlap-"));
  const commands = [];
  const failed = {
    run_id: "newer",
    status: "failed",
    error: { message: "newer inspection failed" },
    cleanup_failures: [{ action: "transport-close", message: "close failed" }],
  };
  let primaryError;
  const start = (report) => {
    const command = startAttemptWorker(root, report);
    commands.push(command);
    return command;
  };
  try {
    const older = start({ run_id: "older", status: "passed" });
    await waitForFile(join(root, "older.ready"));
    const newer = start(failed);
    await waitForFile(join(root, "newer.ready"));
    await writeFile(join(root, "newer.finish"), "");
    const newerResult = await newer;
    if (newerResult.error) throw newerResult.error;
    assert.equal(newerResult.result.exitCode, 0);
    assert.equal(newerResult.result.signal, null);
    const marker = await readFile(join(root, "verification-latest.json"));
    await writeFile(join(root, "older.finish"), "");
    const olderResult = await older;
    if (olderResult.error) throw olderResult.error;
    assert.equal(olderResult.result.exitCode, 0);
    assert.equal(olderResult.result.signal, null);
    assert.deepEqual(
      await readFile(join(root, "verification-latest.json")),
      marker,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "verifications/newer/result.json"))),
      failed,
    );
    await assert.rejects(
      readFile(join(root, "verifications/newer/verification.json")),
      {
        code: "ENOENT",
      },
    );
    assert.equal(
      JSON.parse(
        await readFile(join(root, "verifications/older/verification.json")),
      ).status,
      "passed",
    );
  } catch (error) {
    primaryError = error;
  } finally {
    // Release both barriers even after an assertion/setup failure. Each command
    // retains native supervision through termination before the root is removed.
    const failures = await attemptAll(
      ["older", "newer"].map((name) => [
        name,
        () => writeFile(join(root, name + ".finish"), ""),
      ]),
    );
    const outcomes = await Promise.all(commands);
    const retained = outcomes.filter(
      ({ error }) => error?.cleanupFailure || error?.cleanupResult,
    );
    if (retained.length)
      primaryError = new AggregateError(
        [primaryError, ...retained.map(({ error }) => error)].filter(Boolean),
        `Worker cleanup failed; retained test evidence at ${root}`,
        { cause: primaryError },
      );
    else
      failures.push(
        ...(await attemptAll([
          ["root", () => rm(root, { recursive: true, force: true })],
        ])),
      );
    if (failures.length)
      primaryError = new AggregateError(
        [primaryError, ...failures].filter(Boolean),
        "Test cleanup failed",
        { cause: primaryError },
      );
  }
  if (primaryError) throw primaryError;
});

test("publication waits for the lock before reading the current owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-http3-lock-"));
  let database;
  let publication;
  let primaryError;
  try {
    const older = await prepareAttempt(root, true, { run_id: "older" });
    database = new DatabaseSync(join(root, ".verification-lock.sqlite"));
    database.exec("BEGIN EXCLUSIVE");
    publication = publishAttempt(root, older.directory, {
      run_id: "older",
      status: "passed",
    });
    await waitForFile(join(older.directory, "verification.json"));
    const marker = join(root, "verification-latest.json");
    assert.equal(JSON.parse(await readFile(marker)).status, "running");
    // This connection represents another marker writer. Its replacement must
    // be observed only after the blocked publisher acquires the same lock.
    const newer = { run_id: "newer", status: "failed" };
    await writeFile(marker, JSON.stringify(newer));
    database.close();
    database = undefined;
    await publication;
    assert.deepEqual(JSON.parse(await readFile(marker)), newer);
  } catch (error) {
    primaryError = error;
  } finally {
    const failures = await attemptAll([
      ["lock", () => database?.close()],
      [
        "publication",
        async () => {
          if (publication) await publication;
        },
      ],
      ["root", () => rm(root, { recursive: true, force: true })],
    ]);
    if (failures.length)
      primaryError = new AggregateError(
        [primaryError, ...failures].filter(Boolean),
        "Test cleanup failed",
        { cause: primaryError },
      );
  }
  if (primaryError) throw primaryError;
});

test("a failed marker read releases the lock and preserves the attempt report", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-http3-lock-failure-"));
  try {
    const older = await prepareAttempt(root, true, { run_id: "older" });
    await writeFile(join(root, "verification-latest.json"), "{");
    const report = {
      run_id: "older",
      status: "failed",
      error: { message: "inspection failed" },
    };
    await assert.rejects(
      publishAttempt(root, older.directory, report),
      SyntaxError,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(older.directory, "result.json"))),
      report,
    );
    const next = await prepareAttempt(root, true, { run_id: "next" });
    await publishAttempt(root, next.directory, {
      run_id: "next",
      status: "passed",
    });
    assert.equal(
      JSON.parse(await readFile(join(root, "verification-latest.json"))).run_id,
      "next",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch reverses origin completion; client and capture may arrive in other orders", () => {
  const names = ["parallel-0", "parallel-1", "parallel-2"];
  const header = (text) => ({ base64: Buffer.from(text).toString("base64") });
  const messages = Object.fromEntries(
    names.map((name) => [
      name,
      {
        headers: [[header("x-lab-case"), header(name)]],
        body: { base64: header(name).base64 },
      },
    ]),
  );
  const event = (kind, index, connection, monotonic) => ({
    event: kind,
    case: names[index],
    stream_id: index * 4,
    connection,
    monotonic,
    ...messages[names[index]],
  });
  const manifest = {
    requests: messages,
    responses: messages,
    events: [
      ...[0, 1, 2].map((i) => event("request-sent", i, "client", i)),
      ...[1, 2, 0].map((i) => event("request-received", i, "origin", 10)),
      ...[0, 2, 1].map((i) => event("response-sent", i, "origin", 20)),
      ...[2, 0, 1].map((i) => event("response-received", i, "client", 30)),
      ...["client", "origin"].map((connection) => ({
        event: "handshake",
        connection,
        alpn: "h3",
        quic_version: 1,
      })),
    ],
  };
  const record = (name) => ({
    reported: {
      id: name,
      request: { headers: [["x-lab-case", name]] },
      client_conn: { id: "client-uuid" },
      server_conn: { id: "origin-uuid" },
    },
  });
  const normal = {
    records: [...[1, 0, 2].map((i) => record(names[i])), record("curl")],
  };
  const orders = verifyConcurrency(normal, manifest);
  assert.deepEqual(orders.dispatched_at_origin, [
    "parallel-0",
    "parallel-2",
    "parallel-1",
  ]);
  manifest.events = manifest.events.filter(
    (item) => item.event !== "response-sent",
  );
  manifest.events.push(
    ...[2, 1, 0].map((i) => event("response-sent", i, "origin", 20)),
  );
  assert.throws(() => verifyConcurrency(normal, manifest), {
    code: "ERR_ASSERTION",
  });
});

test("cleanup verifies and retires a separately owned producer group", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-http3-group-"));
  const runId = randomUUID();
  const child = spawn("/usr/bin/sleep", ["60"], {
    detached: true,
    env: { ...process.env, REA_PROCESS_RUN_ID: runId },
    stdio: "ignore",
  });
  let primaryError;
  let cleaned = false;
  try {
    await once(child, "spawn");
    await writeFile(
      join(root, "process-groups.jsonl"),
      JSON.stringify({
        runId,
        leaderPid: child.pid,
        processGroupId: child.pid,
      }) + "\n",
    );
    const result = await finishProducerGroups(root, runId);
    assert.deepEqual(result.failures, []);
    assert.equal(result.observation[0][1].state, "empty");
  } catch (error) {
    primaryError = error;
  } finally {
    const failures = await attemptAll([
      [
        "process",
        async () => {
          const result = await cleanupOwnedProcessGroup({
            runId,
            leaderPid: child.pid,
            processGroupId: child.pid,
          });
          assert.equal(
            result.cleaned,
            true,
            `Retained ownership evidence at ${root}: ${JSON.stringify(result)}`,
          );
          cleaned = true;
        },
      ],
      [
        "root",
        async () => {
          if (cleaned) await rm(root, { recursive: true, force: true });
        },
      ],
    ]);
    if (failures.length)
      primaryError = new AggregateError(
        [primaryError, ...failures].filter(Boolean),
        "Test cleanup failed",
        { cause: primaryError },
      );
  }
  if (primaryError) throw primaryError;
});
