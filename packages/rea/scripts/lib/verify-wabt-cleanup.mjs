import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { requireMcpToolError } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { WABT_OPERATION_TIMEOUT_MS } from "./wabt-verifier-timeouts.mjs";
const execute = promisify(execFile);
/** Real WABT inspection with authored cleanup denials and same-connection recovery. */
export async function verifyWabtCleanup(entrypoint, environment, parent) {
  // Production canonicalizes the temporary parent before creating its root.
  const root = await realpath(await mkdtemp(join(parent, "wabt-cleanup-")));
  return withVerifierCleanup(async () => {
    const valid = join(root, "valid.wasm"),
      invalid = join(root, "invalid.wasm");
    await writeFile(
      valid,
      Buffer.from("0061736d01000000000a066f7061717565616263", "hex"),
    );
    await writeFile(invalid, Buffer.from("0061736d01000000ff", "hex"));
    const preload = fileURLToPath(
      new URL("../../tests/fixtures/wasm/cleanupPreload.mjs", import.meta.url),
    );
    const records = [];
    async function setup(name, mode, input) {
      const temporary = join(root, name);
      await mkdir(temporary);
      const trace = join(root, name + ".jsonl");
      return {
        temporary,
        trace,
        env: {
          ...environment,
          HOME: root,
          USERPROFILE: root,
          REA_LOG_LEVEL: "silent",
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary,
          REA_CLEANUP_PROBE_ROOT: temporary,
          REA_CLEANUP_PROBE_TRACE: trace,
          REA_CLEANUP_PROBE_MODE: mode,
          REA_CLEANUP_PROBE_INPUT: input,
        },
      };
    }
    async function observations(configuration) {
      const trace = await readFile(configuration.trace, "utf8").catch((e) => {
        if (e.code === "ENOENT") return "";
        throw e;
      });
      return {
        trace:
          trace.trim() === "" ? [] : trace.trim().split("\n").map(JSON.parse),
        remaining: await readdir(configuration.temporary),
      };
    }
    for (const [name, mode, input] of [
      ["normal", "normal", valid],
      ["valid-recovered", "runtime-once", valid],
      ["invalid-recovered", "runtime-once", invalid],
      ["descriptor-recovered", "input-once", valid],
    ]) {
      const c = await setup(name, mode, input);
      let response,
        status = 0;
      try {
        response = await execute(
          process.execPath,
          [
            "--import",
            preload,
            entrypoint,
            "inspect-wasm-artifact",
            input,
            "--json",
          ],
          {
            env: c.env,
            timeout: WABT_OPERATION_TIMEOUT_MS,
            maxBuffer: 64 * 1024 * 1024,
          },
        );
      } catch (e) {
        if (typeof e.code !== "number" || typeof e.stdout !== "string") throw e;
        response = e;
        status = e.code;
      }
      const output = JSON.parse(response.stdout);
      const facts = await observations(c);
      assert.deepEqual(facts.remaining, []);
      if (mode === "normal") {
        assert.equal(status, 0);
        assert.equal(output.normalized_result.validation, "valid");
      } else {
        assert.equal(status, 1);
        assert.equal(
          output.code,
          name === "valid-recovered" ? "execution_failure" : "invalid_request",
        );
        if (name === "valid-recovered") {
          assert.equal(
            output.details?.partial_observation?.normalized_result?.validation,
            "valid",
          );
          assert.equal(
            output.details?.partial_observation?.evidence_id,
            records[0].output.evidence_id,
          );
        }
        if (mode === "input-once") {
          assert.equal(
            output.details?.issues?.[0]?.message,
            "authored descriptor cleanup denial",
          );
          const closes = facts.trace.filter(
            (fact) => fact.kind === "input-close",
          );
          assert.ok(closes.length >= 2);
          assert.equal(closes[0].path, input);
          assert.equal(closes[0].denied, true);
          assert.ok(Number.isInteger(closes[0].descriptor));
          for (const retry of closes.slice(1)) {
            assert.equal(retry.path, input);
            assert.equal(retry.descriptor, closes[0].descriptor);
            assert.equal(retry.denied, false);
          }
        }
        assert.notEqual(output.details?.cleanup, "incomplete");
        assert.equal(output.details?.resources, undefined);
        if (input === invalid) {
          assert.equal(output.code, "invalid_request");
          assert.ok(output.details?.captured_output?.stderr);
        }
      }
      if (mode === "runtime-once") {
        assert.equal(facts.trace.length, 2);
        assert.equal(facts.trace[0].path, facts.trace[1].path);
        assert.equal(facts.trace[0].denied, true);
        assert.equal(facts.trace[1].exists, false);
      }
      records.push({ kind: "cli", name, status, output, ...facts });
    }
    for (const mode of ["runtime-once", "runtime-until-allowed"]) {
      const c = await setup("mcp-" + mode, mode, valid);
      const client = new Client({ name: "wabt-cleanup-probe", version: "1" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", preload, entrypoint, "mcp"],
        env: c.env,
        stderr: "pipe",
      });
      const calls = [];
      await withVerifierCleanup(async () => {
        await client.connect(transport);
        const request = {
          name: "inspect_wasm_artifact",
          arguments: { path: valid },
        };
        const call = () =>
          client.callTool(request, { timeout: WABT_OPERATION_TIMEOUT_MS });
        const first = await call();
        calls.push(first);
        assert.equal(requireMcpToolError(first).code, "cleanup_incomplete");
        if (mode === "runtime-until-allowed") {
          const second = await call();
          calls.push(second);
          assert.equal(requireMcpToolError(second).code, "cleanup_incomplete");
          assert.equal(
            (await observations(c)).remaining.filter((name) =>
              name.startsWith("rea-wabt-"),
            ).length,
            1,
          );
          await writeFile(join(c.temporary, "allow"), "restore");
        }
        const last = await call();
        calls.push(last);
        assert.notEqual(last.isError, true, JSON.stringify(last));
        assert.equal(
          last.structuredContent.normalized_result.validation,
          "valid",
        );
      }, [() => client.close(), () => transport.close()]);
      const facts = await observations(c);
      assert.deepEqual(
        facts.remaining,
        mode === "runtime-until-allowed" ? ["allow"] : [],
      );
      records.push({ kind: "mcp", mode, calls, ...facts });
    }
    return records.reduce(
      (count, record) =>
        count + (record.kind === "cli" ? 1 : record.calls.length),
      0,
    );
  }, [() => rm(root, { recursive: true, force: true })]);
}
