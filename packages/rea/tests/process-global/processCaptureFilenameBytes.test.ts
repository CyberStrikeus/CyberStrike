import { createHash } from "node:crypto";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { processFilesystemSnapshotSchema } from "../../src/domain/process/processCapture.js";
import { processScenarioSchema } from "../../src/domain/process/processScenario.js";
import { snapshotRoots } from "../../src/process/capture/FilesystemSnapshot.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { advertisedSchemaErrors } from "../fixtures/mcpAdvertisedSchemaValidity.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, opendir: vi.fn(actual.opendir) };
});

const actualFs = await vi.importActual<typeof fs>("node:fs/promises");
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.opendir).mockImplementation(actualFs.opendir);
});

// macOS rejects these names at creation. Simulate only directory-entry bytes;
// subsequent lookup, hashing, resource cleanup and coverage use production code.
const injectNames = (names: Buffer[]): void => {
  vi.mocked(fs.opendir).mockImplementation(async (...args) => {
    expect(args[1]).toMatchObject({ encoding: "buffer" });
    const directory = await actualFs.opendir(...args);
    const read = directory.read.bind(directory);
    const pending = [...names];
    vi.spyOn(directory, "read").mockImplementation(async () => {
      const name = pending.shift();
      return name === undefined ? read() : ({ name } as unknown as Dirent);
    });
    return directory;
  });
};

it.each([false, true])(
  "retains invalid basename bytes without looking up a replacement alias (sibling=%s)",
  async (sibling) => {
    const root = await createTestTempDirectory("rea-capture-name-bytes-");
    const content = "replacement sibling";
    if (sibling) await fs.writeFile(join(root, "�"), content);
    injectNames([Buffer.from([0xff])]);
    const snapshot = await snapshotRoots(
      processScenarioSchema.parse({
        executable: process.execPath,
        working_directory: root,
        filesystem_observation_paths: [root],
      }),
    );
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.completeRoots).toEqual([]);
    expect(snapshot.coverage.enumeration_omissions).toEqual([
      {
        path: "root_0:.",
        reason: "unrepresentable_name",
        system_code: null,
        raw_name_hex: "ff",
      },
    ]);
    expect(snapshot.coverage.enumeration_truncated).toBe(true);
    expect(snapshot.files.filter(({ type }) => type === "file")).toEqual(
      sibling
        ? [
            expect.objectContaining({
              path: "root_0:�",
              sha256: createHash("sha256").update(content).digest("hex"),
            }),
          ]
        : [],
    );
    expect(snapshot.coverage.hashed_bytes).toBe(sibling ? content.length : 0);
    expect(processFilesystemSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  },
);

it("bounds invalid-name enumeration with the selected files limit", async () => {
  const root = await createTestTempDirectory("rea-capture-name-budget-");
  injectNames(Array.from({ length: 10 }, () => Buffer.from([0xff])));
  const snapshot = await snapshotRoots(
    processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [root],
      limits: { files: 3 },
    }),
  );
  expect(snapshot.files).toHaveLength(1);
  expect(snapshot.coverage.enumeration_omissions).toHaveLength(2);
  expect(snapshot.coverage.enumeration_reasons).toEqual([
    "unrepresentable_name",
    "files_limit",
  ]);
  expect(snapshot.completeRoots).toEqual([]);
});

it.skipIf(process.platform !== "linux")(
  "keeps actual Linux non-UTF-8 filenames distinct from a replacement sibling",
  async () => {
    const root = await createTestTempDirectory("rea-capture-linux-name-");
    await fs.writeFile(
      Buffer.concat([Buffer.from(`${root}/`), Buffer.from([0xff])]),
      "invalid basename",
    );
    await fs.writeFile(join(root, "�"), "valid sibling");
    const snapshot = await snapshotRoots(
      processScenarioSchema.parse({
        executable: process.execPath,
        working_directory: root,
        filesystem_observation_paths: [root],
      }),
    );
    expect(snapshot.files.map(({ path }) => path)).toEqual([
      "root_0:.",
      "root_0:�",
    ]);
    expect(snapshot.coverage.enumeration_omissions).toEqual([
      {
        path: "root_0:.",
        reason: "unrepresentable_name",
        system_code: null,
        raw_name_hex: "ff",
      },
    ]);
    expect(snapshot.coverage.hashed_bytes).toBe(13);
    expect(snapshot.completeRoots).toEqual([]);
  },
);

it("advertises byte-preserving omissions in valid SDK-converted MCP schemas", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Schema discovery must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "capture-name-bytes", version: "1" });
  try {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tool = (await client.listTools()).tools.find(
      ({ name }) => name === "capture_process_scenario",
    );
    expect(tool).toBeDefined();
    if (tool === undefined) throw new Error("Missing process capture contract");
    expect(advertisedSchemaErrors([tool])).toEqual([]);
    expect(JSON.stringify(tool.outputSchema)).toContain("unrepresentable_name");
    expect(JSON.stringify(tool.outputSchema)).toContain("raw_name_hex");
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});
