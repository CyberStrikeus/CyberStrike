import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { digestProcessCommitment } from "../../../src/domain/process/processScenario.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../fixtures/processDescendantIdentifiers.mjs", import.meta.url),
);
const identitySchema = z.strictObject({
  root_pid: z.int().positive(),
  child_pid: z.int().positive(),
});

itWithCaptureCapability.each([
  { adapter: "cli", pids: true },
  { adapter: "mcp", pids: true },
  { adapter: "cli", pids: false },
  { adapter: "mcp", pids: false },
] as const)(
  "normalizes sampled child output and preserves original bytes with pids=$pids through $adapter",
  async ({ adapter, pids }) => {
    const root = await createTestTempDirectory("rea-descendant-pid-adapter-");
    const identityPath = join(root, "identity.json");
    const scenarioPath = join(root, "scenario.json");
    const scenario = {
      executable: process.execPath,
      arguments: [fixture, identityPath],
      working_directory: root,
      timeout_ms: 5_000,
      idle_timeout_ms: 5_000,
      settle_ms: 100,
      normalization: {
        pids,
        ports: false,
        paths: false,
        time_bucket_ms: 10_000,
      },
    };
    await writeFile(scenarioPath, JSON.stringify(scenario));
    let client: Client | undefined;
    if (adapter === "mcp") {
      const session = createTestBinarySession(() => {
        throw new Error("Process capture must not launch a binary provider");
      });
      const server = createServer({ kind: "session", session });
      client = new Client({
        name: "descendant-pid-normalization",
        version: "1",
      });
      const connected = client;
      onTestFinished(async () => {
        await connected.close();
        await server.close();
        await session.close();
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    }
    const captures = [];
    for (let run = 0; run < (pids ? 2 : 1); run++) {
      let evidence;
      if (client !== undefined) {
        const response = await client.callTool({
          name: "capture_process_scenario",
          arguments: scenario,
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        evidence = parseEvidence(response.structuredContent);
        await client.ping();
      } else {
        const { stdout } = await exec(
          process.execPath,
          [
            "scripts/rea.mjs",
            "capture-process",
            scenarioPath,
            "--format",
            "json",
          ],
          { timeout: 20_000 },
        );
        evidence = parseEvidence(JSON.parse(stdout));
      }
      const capture = parseProcessCapture(evidence.normalized_result);
      const identity = identitySchema.parse(
        JSON.parse(await readFile(identityPath, "utf8")),
      );
      const original = `root pid ${identity.root_pid}\r\nchild pid ${identity.child_pid}\r\ncount 9007199254740991\r\n`;
      const expected = pids
        ? "root pid <pid>\r\nchild pid <pid>\r\ncount 9007199254740991\r\n"
        : original;
      const childSamples = capture.process_samples.filter(({ command }) =>
        command.endsWith("processDescendantIdentifiers.mjs child"),
      );
      expect(
        childSamples.length,
        "the child must have been positively sampled",
      ).toBeGreaterThan(0);
      expect(
        childSamples.some(({ pid, parent_pid }) =>
          pids
            ? pid !== 1 && parent_pid === 1
            : pid === identity.child_pid && parent_pid === identity.root_pid,
        ),
      ).toBe(true);
      expect(capture.frames.map(({ data }) => data).join("")).toBe(expected);
      expect(
        capture.frames.map(({ raw_data, data }) => raw_data ?? data).join(""),
      ).toBe(original);
      expect(capture.rendered_frames.at(-1)?.lines).toEqual(
        expect.arrayContaining(expected.trimEnd().split("\r\n")),
      );
      expect(capture.rendered_frames.at(-1)?.serialized_state).toContain(
        pids ? "child pid <pid>" : `child pid ${identity.child_pid}`,
      );
      expect(capture.truncation_details.raw_terminal).toMatchObject({
        observed_bytes: Buffer.byteLength(original),
        retained_bytes: Buffer.byteLength(original),
      });
      expect(capture.manifest.comparison_contract).toHaveProperty(
        "terminal_observation_version",
        "deferred-rendered-journal-v1",
      );
      expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
      captures.push(capture);
    }
    const [first, second] = captures;
    if (first === undefined) throw new Error("Capture was not retained");
    if (second !== undefined)
      expect(compareProcessCaptures(first, second).terminal).toBe("unchanged");
    const legacyContract = { ...first.manifest.comparison_contract };
    delete legacyContract.terminal_observation_version;
    const legacy = parseProcessCapture({
      ...first,
      manifest: {
        ...first.manifest,
        comparison_contract: legacyContract,
        comparison_contract_sha256: digestProcessCommitment(legacyContract),
      },
    });
    expect(() => compareProcessCaptures(legacy, first)).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            expected: ["terminal_observation_version"],
          }),
        ],
      }),
    );
  },
  30_000,
);
