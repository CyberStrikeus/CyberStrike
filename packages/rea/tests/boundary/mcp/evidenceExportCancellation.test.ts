import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished } from "vitest";
import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([false, true])(
  "stops an SDK export cancellation before publication and keeps the same session usable (overwrite: %s)",
  async (overwrite) => {
    const root = await createTestTempDirectory("rea-mcp-export-cancel-");
    const path = join(root, "bundle.json");
    if (overwrite) await writeFile(path, "original destination");
    const session = createTestBinarySession(() => {
      throw new Error("Evidence export must not start a binary provider");
    });
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "large_observation",
        parameters: {},
        result: { observed: "雪😀".repeat(1024 * 1024) },
      },
    );
    expect(session.recordEvidence(evidence).ok).toBe(true);
    const server = createServer({ kind: "session", session });
    const client = new Client({
      name: "evidence-export-cancellation",
      version: "1",
    });
    const controller = new AbortController();
    onTestFinished(async () => {
      controller.abort();
      await client.close();
      await server.close();
      await session.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const cancellation = client
      .callTool(
        { name: "export_evidence_bundle", arguments: { path, overwrite } },
        { signal: controller.signal },
      )
      .then(
        () => "completed",
        (error: unknown) => error,
      );
    // Observe actual staged bytes, rather than only a locally rejected promise.
    const deadline = performance.now() + 5000;
    let stagedBytes = 0;
    while (stagedBytes === 0 && performance.now() < deadline) {
      const staging = (await readdir(root)).find((name) =>
        name.startsWith(".rea-write-"),
      );
      if (staging !== undefined) {
        const staged = await stat(join(root, staging, "content")).catch(
          (cause: unknown) => {
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ENOENT"
            )
              return undefined;
            throw cause;
          },
        );
        stagedBytes = staged?.size ?? 0;
      }
      await setImmediate();
    }
    expect(stagedBytes).toBeGreaterThan(0);
    controller.abort(new Error("SDK export cancellation verification"));
    expect(await cancellation).toMatchObject({
      message: expect.stringContaining("SDK export cancellation verification"),
    });
    await expect
      .poll(() => readdir(root), { timeout: 5000 })
      .toEqual(overwrite ? ["bundle.json"] : []);
    if (overwrite)
      expect(await readFile(path, "utf8")).toBe("original destination");
    expect(session.hasEvidence(evidence.evidence_id)).toBe(true);
    await client.ping();
    const next = await client.callTool({
      name: "export_evidence_bundle",
      arguments: { path, overwrite },
    });
    expect(next.isError, JSON.stringify(next)).not.toBe(true);
    expect(await readEvidenceBundle(path)).toMatchObject({
      ok: true,
      value: {
        records: [
          {
            evidence_id: evidence.evidence_id,
            normalized_result: evidence.normalized_result,
          },
        ],
      },
    });
    await client.ping();
  },
);
