import { pathToFileURL } from "node:url";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

// Two command families share --evidence_output publication; the same real
// staged write is driven across its commit point through the compiled CLI.
const families = [
  {
    command: "inspect-model-artifact",
    operation: "inspect_model_artifact",
    target: async (root: string): Promise<string> => {
      const header = Buffer.from(
        JSON.stringify({
          weight: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
        }),
      );
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(header.length));
      const path = join(root, "fixture.safetensors");
      await writeFile(path, Buffer.concat([length, header, Buffer.alloc(4)]));
      return path;
    },
  },
  {
    command: "inspect-desktop-application",
    operation: "inspect_desktop_application",
    target: async (root: string): Promise<string> => {
      const path = join(root, "installation");
      await mkdir(join(path, "resources"), { recursive: true });
      await writeFile(join(path, "resources/app.asar"), "path convention");
      return path;
    },
  },
] as const;

type Family = (typeof families)[number];

const publish = async (
  cli: TestCli,
  family: Family,
  detail: "summary" | "complete",
  publication: Record<string, unknown>,
) => {
  const root = await createTestTempDirectory("rea-evidence-output-");
  const target = await family.target(root);
  const destination = join(root, "parent.json");
  const marker = join(root, "signal.json");
  const reply = await cli.run({
    cwd: root,
    arguments: [
      family.command,
      target,
      "--detail",
      detail,
      "--evidence_output",
      destination,
      "--json",
    ],
    environment: {
      HOME: root,
      REA_LOG_LEVEL: "silent",
      REA_TEST_EVIDENCE_PUBLICATION: JSON.stringify({
        prefix: join(await realpath(root), ".rea-write-"),
        marker,
        ...publication,
      }),
      NODE_OPTIONS: `--max-old-space-size=2048 --import=${pathToFileURL(resolve("tests/fixtures/evidencePublicationPreload.mjs")).href}`,
    },
  });
  const staging = (await readdir(root)).filter((name) =>
    name.startsWith(".rea-write-"),
  );
  return { reply, destination, marker, staging };
};

const cliError = (json: unknown) => analysisErrorProjectionSchema.parse(json);

const committedParent = async (destination: string) => {
  const bytes = await readFile(destination);
  const records = parseEvidenceBundle(JSON.parse(bytes.toString())).records;
  expect(records).toHaveLength(1);
  return { bytes: bytes.length, parent: records[0]! };
};

const signalDelivery =
  process.platform === "win32" ? ("event" as const) : ("os" as const);

cliTest.for(
  families.flatMap((family) => [
    { family, detail: "summary" as const, signal: "SIGINT" as const },
    { family, detail: "summary" as const, signal: "SIGTERM" as const },
    { family, detail: "complete" as const, signal: "SIGINT" as const },
  ]),
)(
  "$family.command keeps the committed $detail receipt when $signal arrives during final cleanup",
  async ({ family, detail, signal }, { cli }) => {
    const { reply, destination, marker, staging } = await publish(
      cli,
      family,
      detail,
      { phase: "cleanup", signal, delivery: signalDelivery },
    );
    expect(reply.exitCode).toBe(signal === "SIGINT" ? 130 : 143);
    const error = cliError(reply.json);
    expect(error.code).toBe("cancelled");
    expect(error.details?.operation).toBe(family.operation);
    const { bytes, parent } = await committedParent(destination);
    expect(error.details?.diagnostics).toEqual({
      evidence_bundle: { path: destination, bytes },
    });
    const partial = parseEvidence(error.details?.partial_observation);
    if (detail === "complete") expect(partial).toEqual(parent);
    else {
      expect(partial.evidence_links).toEqual([parent.evidence_id]);
      expect(partial.normalized_result).toMatchObject({
        kind: "summary",
        parent_evidence_id: parent.evidence_id,
      });
    }
    const proof = JSON.parse(await readFile(marker, "utf8"));
    expect(proof).toMatchObject({ phase: "cleanup", signal });
    expect(proof.listeners).toBeGreaterThan(0);
    expect(staging).toEqual([]);
  },
);

cliTest.for(families)(
  "$command creates no output or receipt when SIGINT arrives before commit",
  async (family, { cli }) => {
    const { reply, destination, marker, staging } = await publish(
      cli,
      family,
      "summary",
      { phase: "staging", signal: "SIGINT", delivery: signalDelivery },
    );
    expect(reply.exitCode).toBe(130);
    const error = cliError(reply.json);
    expect(error.code).toBe("cancelled");
    expect(error.details?.operation).toBe(family.operation);
    expect(error.details).not.toHaveProperty("diagnostics");
    expect(JSON.stringify(reply.json)).not.toContain(destination);
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    // The complete Evidence remains available when nothing was published.
    expect(parseEvidence(error.details?.partial_observation).operation).toBe(
      family.operation,
    );
    const proof = JSON.parse(await readFile(marker, "utf8"));
    expect(proof).toMatchObject({ phase: "staging", signal: "SIGINT" });
    expect(proof.listeners).toBeGreaterThan(0);
    expect(staging).toEqual([]);
  },
);

cliTest.for(families)(
  "$command delivers the receipt once a failed staging cleanup is confirmed by retry",
  async (family, { cli }) => {
    const { reply, destination, staging } = await publish(
      cli,
      family,
      "summary",
      { cleanup_failures: 1 },
    );
    expect(reply.exitCode).toBe(0);
    const { bytes, parent } = await committedParent(destination);
    expect(reply.json).toMatchObject({
      evidence_bundle: { path: destination, bytes },
      summary: {
        normalized_result: { parent_evidence_id: parent.evidence_id },
      },
    });
    expect(staging).toEqual([]);
  },
);

cliTest.for(families)(
  "$command reports the committed receipt when staging cleanup stays incomplete",
  async (family, { cli }) => {
    const { reply, destination, staging } = await publish(
      cli,
      family,
      "summary",
      { cleanup_failures: 1_000 },
    );
    expect(reply.exitCode).not.toBe(0);
    const error = cliError(reply.json);
    expect(error.code).toBe("cleanup_incomplete");
    const { bytes, parent } = await committedParent(destination);
    expect(error.details).toMatchObject({
      published: true,
      published_path: destination,
      bytes,
      cleanup: "incomplete",
    });
    expect(parseEvidence(error.details?.partial_observation)).toEqual(parent);
    expect(staging).toHaveLength(1);
  },
);
