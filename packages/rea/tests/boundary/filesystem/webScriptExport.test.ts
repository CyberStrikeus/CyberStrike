import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open as fsOpen,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { exportWebScripts } from "../../../src/application/WebScriptExportService.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { publishWebScripts } from "../../../src/browser/assets/PublishWebScripts.js";
import { DestinationCaseCollisionFailure } from "../../../src/artifacts/ArtifactPaths.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { SafeOutputTreeCreationFailure } from "../../../src/artifacts/SafeOutputTreeCreationFailure.js";
import { selectScriptCapture } from "../../../src/browser/assets/ScriptCaptureAdapters.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION } from "../../../src/domain/browserNetworkEvidence.js";
import {
  webScriptExportManifestSchema,
  webScriptExportResultSchema,
} from "../../../src/domain/webScriptExport.js";
import { readWithoutFifoWriter } from "../../fixtures/fifoInput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  scriptCaptureEvidenceFixture,
  scriptScenarioFixture,
} from "../../fixtures/webScriptCapture.js";
import { injectPublishedDirectoryCloseFailure } from "../../support/publishedDirectoryCloseFailure.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const openMock = vi.mocked(fsOpen);
let actualFs: typeof import("node:fs/promises");

beforeEach(async () => {
  actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  openMock.mockImplementation((...args) => actualFs.open(...args));
});

afterEach(() => openMock.mockReset());

const setup = async (capture: unknown = scriptCaptureEvidenceFixture()) => {
  const root = await createTestTempDirectory("rea-web-script-export-");
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  const input = {
    capture_path: join(root, "capture.json"),
    output_directory: join(root, "export"),
  };
  await writeFile(input.capture_path, JSON.stringify(capture));
  return { root, input, resources };
};

describe("empty URL component publication", () => {
  it("isolates empty query and fragment identities while retaining durable script bytes", async () => {
    const scripts = [
      {
        url: "https://fixture.test/ordinary.js",
        bytes: Buffer.from("export const ordinary = 1;"),
      },
      {
        url: "https://fixture.test/query.js?",
        bytes: Buffer.from("export const query = 2;"),
      },
      {
        url: "https://fixture.test/fragment.js#",
        bytes: Buffer.from("export const fragment = 3;"),
      },
    ];
    const { input, resources } = await setup(scriptScenarioFixture(scripts));
    const exported = await exportWebScripts(input, resources);
    if (!exported.ok) throw exported.error;
    const result = webScriptExportResultSchema.parse(
      exported.value.normalized_result,
    );
    if (result.analysis_input === null)
      throw new Error("Missing analysis input");
    for (const [index, script] of result.scripts.entries()) {
      if (script.content.state !== "exported")
        throw new Error("Missing source bytes");
      const expected = scripts[index];
      if (expected === undefined) throw new Error("Missing expected source");
      expect(script.url).toBe(expected.url);
      expect(script.content.layout).toBe(index === 0 ? "url-path" : "isolated");
      expect(
        Buffer.compare(
          await readFile(
            join(
              result.analysis_input.input_path,
              script.content.relative_path,
            ),
          ),
          expected.bytes,
        ),
      ).toBe(0);
    }
    const manifest = JSON.parse(await readFile(result.manifest.path, "utf8"));
    expect(manifest.scripts).toEqual(result.scripts);
  });
});

describe("captured script publication boundary", () => {
  it("verifies durable bytes, manifest, capture identity, and existing module analysis", async () => {
    const capture = scriptScenarioFixture([
      {
        url: "https://fixture.test/app/main.js",
        bytes: Buffer.from(
          "import { marker } from './lib/dep.js'; export const result = marker;\n",
        ),
      },
      {
        url: "https://fixture.test/app/lib/dep.js",
        bytes: Buffer.from("export const marker = 'source-owned';\n"),
      },
    ]);
    const { input, resources } = await setup(capture);
    const exported = await exportWebScripts(input, resources);
    if (!exported.ok) throw exported.error;
    const result = webScriptExportResultSchema.parse(
      exported.value.normalized_result,
    );
    expect(result.capture_sha256).toBe(
      createHash("sha256")
        .update(await readFile(input.capture_path))
        .digest("hex"),
    );
    const manifest = await readFile(result.manifest.path);
    expect(result.manifest.sha256).toBe(
      createHash("sha256").update(manifest).digest("hex"),
    );
    const { manifest: descriptor, ...inline } = result;
    expect(descriptor.bytes).toBe(manifest.length);
    expect(JSON.parse(manifest.toString())).toEqual(inline);
    if (result.analysis_input === null)
      throw new Error("Missing analysis input");
    for (const [index, script] of result.scripts.entries()) {
      if (script.content.state !== "exported")
        throw new Error("Expected exported script");
      const bytes = await readFile(
        join(result.analysis_input.input_path, script.content.relative_path),
      );
      const expected = capture.events.items
        .filter(({ kind }) => kind === "network-content")
        .map((event) =>
          event.kind === "network-content" && event.body.state === "captured"
            ? Buffer.from(event.body.content, "base64")
            : Buffer.alloc(0),
        )[index];
      if (expected === undefined)
        throw new Error("Missing expected script bytes");
      expect(bytes.equals(expected)).toBe(true);
    }
    const analyzed = await analyzeJavaScriptApplication(result.analysis_input);
    if (!analyzed.ok) throw analyzed.error;
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      analyzed.value.normalized_result,
    );
    expect(analysis.statistics.parsed_javascript_files).toBe(2);
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          specifier: "./lib/dep.js",
          resolution_status: "resolved",
        }),
      }),
    );
  });

  it("links authenticated input Evidence", async () => {
    const { input, resources } = await setup();
    const result = await exportWebScripts(input, resources);
    if (!result.ok) throw result.error;
    expect(result.value.evidence_links).toEqual([
      scriptCaptureEvidenceFixture().evidence_id,
    ]);
  });

  it.each([
    "playwright-response-body-bytes",
    "browser-decoded-response-bytes",
  ] as const)(
    "preserves binary and empty response bytes and provenance for %s",
    async (representation) => {
      const binary = Buffer.from([255, 0, 254, 1]);
      const capture = scriptScenarioFixture([
        { url: "https://fixture.test/binary.js", bytes: binary },
        { url: "https://fixture.test/empty.js", bytes: Buffer.alloc(0) },
      ]);
      for (const event of capture.events.items) {
        if (event.kind === "network-content" && event.body.state === "captured")
          event.body.representation = representation;
      }
      const { input: binaryInput, resources: binaryResources } =
        await setup(capture);
      const binaryExport = await exportWebScripts(binaryInput, binaryResources);
      if (!binaryExport.ok) throw binaryExport.error;
      const parsed = webScriptExportResultSchema.parse(
        binaryExport.value.normalized_result,
      );
      const [first, second] = parsed.scripts;
      if (
        first?.content.state !== "exported" ||
        second?.content.state !== "exported" ||
        parsed.analysis_input === null
      )
        throw new Error("Missing exported bytes");
      expect(first.content.representation).toBe(representation);
      expect(second.content.representation).toBe(representation);
      expect(parsed.limitations).toContain(
        PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION,
      );
      const persisted = webScriptExportManifestSchema.parse(
        JSON.parse(await readFile(parsed.manifest.path, "utf8")),
      );
      expect(
        persisted.scripts.map(({ content }) =>
          content.state === "exported" ? content.representation : undefined,
        ),
      ).toEqual([representation, representation]);
      expect(persisted.limitations).toContain(
        PLAYWRIGHT_RESPONSE_BODY_PROVENANCE_LIMITATION,
      );
      const exportedBytes = await readFile(
        join(parsed.analysis_input.input_path, first.content.relative_path),
      );
      expect(exportedBytes.equals(binary)).toBe(true);
      expect(
        await readFile(
          join(parsed.analysis_input.input_path, second.content.relative_path),
        ),
      ).toHaveLength(0);
    },
  );

  it("retains missing sources in a manifest without inventing an analysis directory", async () => {
    const capture = scriptScenarioFixture();
    capture.events.items = capture.events.items.filter(
      ({ kind }) => kind !== "network-content",
    );
    capture.events.retained = capture.events.items.length;
    const { input, resources } = await setup(capture);
    const result = await exportWebScripts(input, resources);
    if (!result.ok) throw result.error;
    const parsed = webScriptExportResultSchema.parse(
      result.value.normalized_result,
    );
    expect(parsed.analysis_input).toBeNull();
    expect(parsed.scripts[0]?.content.state).toBe("unavailable");
    expect(await readdir(input.output_directory)).toEqual(["manifest.json"]);
  });
});

describe("captured script publication failures and cleanup", () => {
  it("preserves adapter-reported limitations without strengthening their string contract", async () => {
    const { input, resources } = await setup();
    const capture = {
      ...selectScriptCapture(scriptScenarioFixture()),
      limitations: ["", "producer-reported limitation"],
    };
    const result = await publishWebScripts(input, capture, "a".repeat(64), {
      resources,
    });
    expect(result.limitations.slice(0, 2)).toEqual(capture.limitations);
  });

  it.each([
    Buffer.from("{"),
    Buffer.from([255, 254]),
    Buffer.from(JSON.stringify({ unsupported: true })),
  ])(
    "rejects malformed capture bytes before creating output",
    async (bytes) => {
      const { input, resources } = await setup();
      await writeFile(input.capture_path, bytes);
      const result = await exportWebScripts(input, resources);
      if (result.ok) throw new Error("Expected invalid input");
      expect(result.error._tag).toBe("AnalysisInputError");
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("preserves an existing destination and refuses output through a symlink", async () => {
    const { root, input, resources } = await setup();
    const marker = join(root, "marker.js");
    await writeFile(marker, "keep");
    await symlink(
      root,
      input.output_directory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await exportWebScripts(input, resources);
    if (result.ok) throw new Error("Expected exclusive output failure");
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      operation: "export_web_scripts",
      issues: [{ path: ["output_directory"], reason: "invalid_value" }],
    });
    expect(result.error.userMessage).toContain("already exists");
    expect(await readFile(marker, "utf8")).toBe("keep");
  });

  it("rolls back only the new owned output when durable byte verification fails", async () => {
    const { root, input, resources } = await setup();
    const capture = selectScriptCapture(
      scriptScenarioFixture([
        { url: "https://fixture.test/a.js", bytes: Buffer.from("first") },
        { url: "https://fixture.test/b.js", bytes: Buffer.from("second") },
      ]),
    );
    const second = capture.scripts[1];
    if (second?.content.state !== "captured") throw new Error("Missing source");
    const broken = {
      ...capture,
      scripts: [
        capture.scripts[0],
        { ...second, content: { ...second.content, sha256: "0".repeat(64) } },
      ].filter((value) => value !== undefined),
    };
    await expect(
      publishWebScripts(input, broken, "a".repeat(64), { resources }),
    ).rejects.toMatchObject({ reason: "integrity" });
    expect(await readdir(root)).toEqual(["capture.json"]);
  });
});

describe("captured script output owner retry", () => {
  it("retains a setup-failed output tree in the caller resource scope", async () => {
    const { input, resources } = await setup();
    const capture = selectScriptCapture(scriptScenarioFixture());
    const createTree = SafeOutputTree.create.bind(SafeOutputTree);
    let cleanupAttempts = 0;
    const create = vi
      .spyOn(SafeOutputTree, "create")
      .mockImplementationOnce(async (outputRoot, platform) => {
        const tree = await createTree(outputRoot, platform);
        const rollbackTree = tree.rollback.bind(tree);
        vi.spyOn(tree, "rollback").mockImplementation(async () => {
          cleanupAttempts += 1;
          if (cleanupAttempts === 1)
            throw new Error("injected first cleanup failure");
          return rollbackTree();
        });
        throw new SafeOutputTreeCreationFailure(
          new Error("injected post-acquisition setup failure"),
          tree,
        );
      });
    try {
      await expect(
        publishWebScripts(input, capture, "a".repeat(64), { resources }),
      ).rejects.toMatchObject({ cleanupIncomplete: true });
      await expect(access(input.output_directory)).resolves.toBeUndefined();
    } finally {
      create.mockRestore();
    }
    await resources.close();
    expect(cleanupAttempts).toBe(2);
    await expect(access(input.output_directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // Windows commit does not open directory descriptors for fsync.
  it.skipIf(process.platform === "win32")(
    "returns completed output when retry closes a descriptor after commit",
    async () => {
      const { input, resources } = await setup();
      const failure = await injectPublishedDirectoryCloseFailure(
        input.output_directory,
      );
      try {
        const result = await exportWebScripts(input, resources);
        if (!result.ok) throw result.error;
        const published = webScriptExportResultSchema.parse(
          result.value.normalized_result,
        );
        expect(published.manifest.path).toBe(
          join(input.output_directory, "manifest.json"),
        );
        expect(failure.wasInjected()).toBe(true);
        expect(failure.owners).toHaveLength(2);
        expect(failure.owners[1]).toBe(failure.owners[0]);
        expect(failure.owners[0]?.handle.fd).toBe(-1);
        await expect(access(published.manifest.path)).resolves.toBeUndefined();
      } finally {
        failure.restore();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "retains published output and its result while cleanup remains unresolved",
    async () => {
      const { input, resources } = await setup();
      const failure = await injectPublishedDirectoryCloseFailure(
        input.output_directory,
        true,
      );
      try {
        const result = await exportWebScripts(input, resources);
        if (result.ok) throw new Error("Expected unresolved cleanup");
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(result.error.userMessage).not.toContain("Remove the residual");
        expect(result.error.partialObservation).toMatchObject({
          kind: "web-script-export",
          result: {
            output_directory: input.output_directory,
            manifest: { path: join(input.output_directory, "manifest.json") },
          },
        });
        await expect(
          access(join(input.output_directory, "manifest.json")),
        ).resolves.toBeUndefined();
        expect(failure.wasInjected()).toBe(true);
        expect(failure.owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
        failure.allowCleanup();
        await resources.close();
        expect(failure.owners.length).toBeGreaterThan(1);
        expect(
          failure.owners.every((owner) => owner === failure.owners[0]),
        ).toBe(true);
        expect(failure.owners[0]?.handle.fd).toBe(-1);
      } finally {
        failure.allowCleanup();
        failure.restore();
      }
    },
  );
});

describe("captured script publication failures and cleanup", () => {
  it("cancels before work and rolls back cancellation after output creation", async () => {
    const { root, input, resources } = await setup();
    const controller = new AbortController();
    controller.abort();
    const result = await exportWebScripts(input, resources, {
      signal: controller.signal,
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    await expect(
      publishWebScripts(
        input,
        selectScriptCapture(scriptScenarioFixture()),
        "a".repeat(64),
        { resources, signal: controller.signal },
      ),
    ).rejects.toBeDefined();
    expect(await readdir(root)).toEqual(["capture.json"]);
  });

  it("keeps the exact caller reason when cancellation interrupts the first output write", async () => {
    const { input, resources } = await setup(
      scriptScenarioFixture([
        {
          url: "https://fixture.test/first.js",
          bytes: Buffer.from("export const a = 1;"),
        },
        {
          url: "https://fixture.test/second.js",
          bytes: Buffer.from("export const b = 2;"),
        },
      ]),
    );
    const controller = new AbortController();
    const reason = { request: "stop export" };
    const create = SafeOutputTree.create.bind(SafeOutputTree);
    const createSpy = vi
      .spyOn(SafeOutputTree, "create")
      .mockImplementationOnce(async (...args) => {
        const tree = await create(...args);
        const write = tree.write.bind(tree);
        vi.spyOn(tree, "write").mockImplementationOnce(async (...writeArgs) => {
          controller.abort(reason);
          return write(...writeArgs);
        });
        return tree;
      });
    try {
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(resources.hasPending).toBe(false);
    } finally {
      createSpy.mockRestore();
    }
  });
});

describe("independent script publication failure", () => {
  it.each(
    [false, true].flatMap((rollbackFails) =>
      [false, true].map((sameReason) => ({ rollbackFails, sameReason })),
    ),
  )(
    "keeps write failure primary after cancellation (rollback fails: $rollbackFails, same reason: $sameReason)",
    async ({ rollbackFails, sameReason }) => {
      const { input, resources } = await setup();
      const controller = new AbortController();
      const physical = Object.assign(
        new Error("physical output write failed"),
        { code: "EIO" },
      );
      openMock.mockImplementation(async (...args) => {
        const handle = await actualFs.open(...args);
        if (
          String(args[0]).startsWith(input.output_directory) &&
          typeof args[1] === "number" &&
          (args[1] & constants.O_WRONLY) !== 0
        )
          vi.spyOn(handle, "write").mockImplementation(async () => {
            controller.abort(
              sameReason ? physical : { request: "later cancellation" },
            );
            throw physical;
          });
        return handle;
      });
      const rollback = rollbackFails
        ? vi
            .spyOn(SafeOutputTree.prototype, "rollback")
            .mockRejectedValue(new Error("rollback refused"))
        : undefined;
      let result: Awaited<ReturnType<typeof exportWebScripts>>;
      try {
        result = await exportWebScripts(input, resources, {
          signal: controller.signal,
        });
        if (result.ok) throw new Error("Expected physical output failure");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: rollbackFails
            ? "cleanup_incomplete"
            : "artifact_operation_failed",
          details: { reason: "io" },
        });
        expect(result.error.partialObservation).toBeUndefined();
        if (rollbackFails)
          expect(result.error.cleanupResources).toEqual([
            input.output_directory,
          ]);
        else {
          expect(result.error.cause).toBe(physical);
          await expect(access(input.output_directory)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      } finally {
        rollback?.mockRestore();
      }
      await resources.close();
      if (result.ok) throw new Error("Expected failure");
      expect(result.error.cleanupIncomplete).toBe(false);
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe("captured script cancellation finalization", () => {
  it("keeps the caller reason when rollback also fails after an interrupted write", async () => {
    const { input, resources } = await setup(
      scriptScenarioFixture([
        {
          url: "https://fixture.test/first.js",
          bytes: Buffer.from("export const a = 1;"),
        },
      ]),
    );
    const controller = new AbortController();
    const reason = { request: "stop export" };
    const create = SafeOutputTree.create.bind(SafeOutputTree);
    const createSpy = vi
      .spyOn(SafeOutputTree, "create")
      .mockImplementationOnce(async (...args) => {
        const tree = await create(...args);
        const write = tree.write.bind(tree);
        vi.spyOn(tree, "write").mockImplementationOnce(async (...args) => {
          controller.abort(reason);
          return write(...args);
        });
        vi.spyOn(tree, "rollback").mockRejectedValueOnce(
          new Error("injected rollback failure"),
        );
        return tree;
      });
    try {
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(true);
    } finally {
      createSpy.mockRestore();
      await resources.close();
    }
  });

  it("wraps a caller-owned cancellation reason under the export operation", async () => {
    const { input, resources } = await setup(
      scriptScenarioFixture([
        {
          url: "https://fixture.test/first.js",
          bytes: Buffer.from("export const a = 1;"),
        },
      ]),
    );
    const controller = new AbortController();
    const reason = new AnalysisCancelledError("upstream_workflow", {
      cause: { request: "stop upstream" },
    });
    const create = SafeOutputTree.create.bind(SafeOutputTree);
    const createSpy = vi
      .spyOn(SafeOutputTree, "create")
      .mockImplementationOnce(async (...args) => {
        const tree = await create(...args);
        const write = tree.write.bind(tree);
        vi.spyOn(tree, "write").mockImplementationOnce(async (...writeArgs) => {
          controller.abort(reason);
          return write(...writeArgs);
        });
        return tree;
      });
    try {
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).not.toBe(reason);
      if (!(result.error instanceof AnalysisCancelledError))
        throw new Error("Expected AnalysisCancelledError");
      expect(result.error.operation).toBe("export_web_scripts");
      expect(result.error.cause).toBe(reason);
    } finally {
      createSpy.mockRestore();
      await resources.close();
    }
  });
});

describe("captured script final commit cancellation", () => {
  it("reports cancellation with the completed output when abort lands during final commit", async () => {
    const { input, resources } = await setup();
    const controller = new AbortController();
    const reason = { request: "stop export" };
    const create = SafeOutputTree.create.bind(SafeOutputTree);
    const createSpy = vi
      .spyOn(SafeOutputTree, "create")
      .mockImplementationOnce(async (...args) => {
        const tree = await create(...args);
        const commit = tree.commit.bind(tree);
        vi.spyOn(tree, "commit").mockImplementation(async (...commitArgs) => {
          await commit(...commitArgs);
          controller.abort(reason);
        });
        return tree;
      });
    try {
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.partialObservation).toMatchObject({
        kind: "web-script-export",
        result: {
          output_directory: input.output_directory,
          manifest: { path: join(input.output_directory, "manifest.json") },
        },
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it.each([1, 2])(
    "returns cancellation after %i failed capture close attempts recover",
    async (failedCloses) => {
      const { input, resources } = await setup();
      const controller = new AbortController();
      const reason = { request: "stop export" };
      let closeCalls = 0;
      openMock.mockImplementation(async (...args) => {
        const handle = await actualFs.open(...args);
        if (String(args[0]) !== input.capture_path) return handle;
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "close").mockImplementation(async () => {
          closeCalls += 1;
          if (closeCalls <= failedCloses) {
            controller.abort(reason);
            throw new Error("injected capture close failure");
          }
          await close();
        });
        return handle;
      });
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected cancellation");
      expect(closeCalls).toBe(2);
      expect(result.error.cleanupIncomplete).toBe(failedCloses === 2);
      expect(resources.hasPending).toBe(failedCloses === 2);
      if (failedCloses === 2) {
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "cleanup_incomplete",
          details: { resources: [input.capture_path] },
        });
        expect(result.error.cleanupPrimary?.cause).toBe(reason);
      } else {
        expect(result.error.cause).toBe(reason);
      }
      await resources.close();
      expect(closeCalls).toBe(failedCloses + 1);
      expect(resources.hasPending).toBe(false);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cancelled",
      });
    },
  );
});

describe("captured script path validation", () => {
  it("identifies a missing capture file and rejected host path syntax", async () => {
    const { input, resources } = await setup();
    const missing = await exportWebScripts(
      {
        ...input,
        capture_path: `${input.capture_path}.missing`,
      },
      resources,
    );
    if (missing.ok) throw new Error("Expected unavailable input");
    expect(projectAnalysisError(missing.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["capture_path"],
            reason: "invalid_value",
            message: expect.stringContaining(`${input.capture_path}.missing`),
          },
        ],
      },
    });
    const relativeCapture = await exportWebScripts(
      {
        ...input,
        capture_path: "capture.json",
      },
      resources,
    );
    if (relativeCapture.ok) throw new Error("Expected host path error");
    expect(relativeCapture.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["capture_path"],
          reason: "invalid_format",
          message:
            "capture_path must be an absolute filesystem path on this host.",
        },
      ],
    });

    const relativeOutput = await exportWebScripts(
      {
        ...input,
        output_directory: "dist",
      },
      resources,
    );
    if (relativeOutput.ok) throw new Error("Expected host path error");
    expect(relativeOutput.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["output_directory"],
          reason: "invalid_format",
          message:
            "output_directory must be an absolute filesystem path on this host.",
        },
      ],
    });

    const bothRelative = await exportWebScripts(
      {
        capture_path: "capture.json",
        output_directory: "dist",
      },
      resources,
    );
    if (bothRelative.ok) throw new Error("Expected host path error");
    expect(bothRelative.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["capture_path"],
          reason: "invalid_format",
        },
        {
          path: ["output_directory"],
          reason: "invalid_format",
        },
      ],
    });
  });
});

describe("captured script selection failures", () => {
  it("accepts a capture symlink to a regular file and preserves its selected path", async () => {
    const { root, input, resources } = await setup();
    const selected = join(root, "selected-capture.json");
    await symlink(input.capture_path, selected, "file");

    const result = await exportWebScripts(
      { ...input, capture_path: selected },
      resources,
    );
    if (!result.ok) throw result.error;
    expect(result.value.subject?.local_path).toBe(selected);
    expect(
      webScriptExportResultSchema.parse(result.value.normalized_result)
        .capture_sha256,
    ).toBe(
      createHash("sha256")
        .update(await readFile(input.capture_path))
        .digest("hex"),
    );
    await expect(
      access(join(input.output_directory, "manifest.json")),
    ).resolves.toBeUndefined();
  });

  it
    .skipIf(process.platform === "win32")
    .each(["a named pipe", "a symlink to a named pipe"])(
    "rejects %s without waiting for a writer or creating output",
    async (kind) => {
      const { root, input, resources } = await setup();
      const fifoPath = join(root, "capture.pipe");
      await promisify(execFile)("mkfifo", [fifoPath]);
      const selected =
        kind === "a named pipe"
          ? fifoPath
          : join(root, "selected-capture.json");
      if (selected !== fifoPath) await symlink(fifoPath, selected, "file");

      const outcome = await readWithoutFifoWriter(fifoPath, () =>
        exportWebScripts({ ...input, capture_path: selected }, resources),
      );
      expect(outcome.state).toBe("completed");
      if (outcome.state !== "completed")
        throw new Error("Capture read waited for a FIFO writer");
      if (outcome.result.ok)
        throw new Error("Expected invalid capture selection");
      expect(projectAnalysisError(outcome.result.error)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["capture_path"],
              reason: "invalid_value",
              message: expect.stringContaining("regular file"),
            },
          ],
        },
      });
      expect(
        JSON.stringify(projectAnalysisError(outcome.result.error)),
      ).toContain(selected);
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a character device as a capture selection before parsing bytes",
    async () => {
      const { input, resources } = await setup();
      const result = await exportWebScripts(
        {
          ...input,
          capture_path: "/dev/null",
        },
        resources,
      );
      if (result.ok) throw new Error("Expected invalid capture selection");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["capture_path"],
              reason: "invalid_value",
              message: expect.stringContaining("regular file"),
            },
          ],
        },
      });
      expect(JSON.stringify(projectAnalysisError(result.error))).toContain(
        "/dev/null",
      );
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "honors a pre-aborted capture export before opening a named pipe",
    async () => {
      const { root, input, resources } = await setup();
      const fifoPath = join(root, "capture.pipe");
      await promisify(execFile)("mkfifo", [fifoPath]);
      const controller = new AbortController();
      controller.abort();

      const outcome = await readWithoutFifoWriter(fifoPath, () =>
        exportWebScripts({ ...input, capture_path: fifoPath }, resources, {
          signal: controller.signal,
        }),
      );
      expect(outcome.state).toBe("completed");
      if (outcome.state !== "completed")
        throw new Error("Aborted capture read waited for a FIFO writer");
      if (outcome.result.ok) throw new Error("Expected cancellation");
      expect(outcome.result.error._tag).toBe("AnalysisCancelledError");
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe("captured script path and permission failures", () => {
  it("reports a directory selected as the capture as invalid input", async () => {
    const { root, input, resources } = await setup();
    const directory = join(root, "captures");
    await mkdir(directory);

    const result = await exportWebScripts(
      {
        ...input,
        capture_path: directory,
      },
      resources,
    );
    if (result.ok) throw new Error("Expected invalid input");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["capture_path"],
            reason: "invalid_value",
            message: expect.stringContaining(directory),
          },
        ],
      },
    });
    await expect(access(input.output_directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an unreadable capture as a host access denial",
    async () => {
      const { input, resources } = await setup();
      await chmod(input.capture_path, 0o000);
      onTestFinished(() => chmod(input.capture_path, 0o600));

      const result = await exportWebScripts(input, resources);
      if (result.ok) throw new Error("Expected access denial");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "access_denied",
        details: { path: input.capture_path, system_code: "EACCES" },
      });
    },
  );
});

describe("capture read failure provenance", () => {
  it.each(
    ["EACCES", "EIO"].flatMap((code) =>
      [0, 1, 2].flatMap((failedCloses) =>
        [false, true].map((sameReason) => ({ code, failedCloses, sameReason })),
      ),
    ),
  )(
    "keeps $code primary through cancellation and $failedCloses failed closes (same reason: $sameReason)",
    async ({ code, failedCloses, sameReason }) => {
      const { input, resources } = await setup();
      const controller = new AbortController();
      const physical = Object.assign(
        new Error("physical capture read failed"),
        { code },
      );
      const closeFailure = new Error("capture close failed");
      let handle: Awaited<ReturnType<typeof actualFs.open>> | undefined;
      let closeCalls = 0;
      openMock.mockImplementation(async (...args) => {
        const opened = await actualFs.open(...args);
        if (String(args[0]) !== input.capture_path) return opened;
        handle = opened;
        vi.spyOn(opened, "read").mockImplementation(async () => {
          controller.abort(
            sameReason ? physical : { request: "later cancellation" },
          );
          throw physical;
        });
        const close = opened.close.bind(opened);
        vi.spyOn(opened, "close").mockImplementation(async () => {
          closeCalls++;
          if (closeCalls <= failedCloses) throw closeFailure;
          await close();
        });
        return opened;
      });
      const result = await exportWebScripts(input, resources, {
        signal: controller.signal,
      });
      if (result.ok) throw new Error("Expected physical capture read failure");
      const expectedCode =
        code === "EACCES" ? "access_denied" : "artifact_operation_failed";
      if (failedCloses === 2) {
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "cleanup_incomplete",
          details: {
            resources: [input.capture_path],
            diagnostics: { primary_error: { code: expectedCode } },
          },
        });
        expect(handle?.fd).toBeGreaterThanOrEqual(0);
      } else expect(projectAnalysisError(result.error).code).toBe(expectedCode);
      const primary = result.error.cleanupPrimary ?? result.error;
      if (failedCloses === 1)
        expect(primary.cause).toMatchObject({
          cause: physical,
          errors: [physical, closeFailure],
        });
      else expect(primary.cause).toBe(physical);
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await resources.close();
      expect(handle?.fd).toBe(-1);
      expect(closeCalls).toBe(failedCloses + 1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe(expectedCode);
    },
  );
});

describe("capture read and close failure", () => {
  it("retains a handle after capture read and close both fail", async () => {
    const { input, resources } = await setup();
    const readFailure = Object.assign(
      new Error("injected capture read failure"),
      { code: "EIO" },
    );
    const closeFailure = new Error("injected capture close failure");
    let openedHandle: Awaited<ReturnType<typeof actualFs.open>> | undefined;
    let closeCalls = 0;
    let allowClose = false;
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) !== input.capture_path) return handle;
      openedHandle = handle;
      vi.spyOn(handle, "read").mockRejectedValue(readFailure);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeCalls += 1;
        if (!allowClose) throw closeFailure;
        await close();
      });
      return handle;
    });

    try {
      const result = await exportWebScripts(input, resources);
      if (result.ok) throw new Error("Expected capture read failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: [input.capture_path],
          diagnostics: {
            primary_error: {
              code: "artifact_operation_failed",
              details: { reason: "io" },
            },
          },
        },
      });
      if (openedHandle === undefined)
        throw new Error("Expected the capture handle to be admitted");
      expect(openedHandle.fd).toBeGreaterThanOrEqual(0);
      expect(closeCalls).toBe(2);
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });

      await expect(resources.close()).rejects.toMatchObject({
        cleanup: {
          resources: [input.capture_path],
          reason: expect.stringContaining(closeFailure.message),
        },
      });
      expect(closeCalls).toBe(3);
      allowClose = true;
      await resources.close();
      expect(closeCalls).toBe(4);
      expect(openedHandle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "artifact_operation_failed",
        details: { reason: "io" },
      });
    } finally {
      allowClose = true;
      await resources.close().catch(() => undefined);
    }
  });
});

describe("capture handle ownership", () => {
  it("retains the failed handle and keeps invalid JSON primary", async () => {
    const { input, resources } = await setup();
    await writeFile(input.capture_path, "{");
    const closeFailure = new Error("injected capture close failure");
    const closeCalls = new Map<object, number>();
    let allowClose = false;
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) !== input.capture_path) return handle;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeCalls.set(handle, (closeCalls.get(handle) ?? 0) + 1);
        if (!allowClose) throw closeFailure;
        await close();
      });
      return handle;
    });

    try {
      const result = await exportWebScripts(input, resources);
      if (result.ok) throw new Error("Expected invalid capture failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: [input.capture_path],
          diagnostics: {
            primary_error: {
              code: "invalid_request",
              details: {
                issues: [{ path: ["capture_path"], reason: "invalid_format" }],
              },
            },
          },
        },
      });
      expect([...closeCalls.values()]).toEqual([2]);
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });

      await expect(resources.close()).rejects.toMatchObject({
        cleanup: {
          resources: [input.capture_path],
          reason: expect.stringContaining(closeFailure.message),
        },
      });
      expect([...closeCalls.values()]).toEqual([3]);

      allowClose = true;
      await resources.close();
      expect([...closeCalls.values()]).toEqual([4]);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
      });
    } finally {
      allowClose = true;
      await resources.close().catch(() => undefined);
    }
  });

  it("reports a recovered close failure without marking cleanup incomplete", async () => {
    const { input, resources } = await setup();
    await writeFile(input.capture_path, "{");
    const closeFailure = new Error("injected one-time capture close failure");
    let closeCalls = 0;
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) !== input.capture_path) return handle;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeCalls += 1;
        if (closeCalls === 1) throw closeFailure;
        await close();
      });
      return handle;
    });

    const result = await exportWebScripts(input, resources);
    if (result.ok) throw new Error("Expected invalid capture failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["capture_path"], reason: "invalid_format" }],
      },
    });
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    const cause = result.error.cause;
    if (!(cause instanceof AggregateError))
      throw new Error("Expected close diagnostic in the cause chain");
    expect(cause.errors.map((error) => String(error))).toContain(
      closeFailure.toString(),
    );
    expect(closeCalls).toBe(2);
    await resources.close();
  });

  it("makes scope close wait for an admitted capture read", async () => {
    const { input, resources } = await setup();
    let notifyOpen!: () => void;
    let releaseOpen!: () => void;
    const opened = new Promise<void>((resolve) => {
      notifyOpen = resolve;
    });
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    openMock.mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) === input.capture_path) {
        notifyOpen();
        await openGate;
      }
      return handle;
    });

    const exporting = exportWebScripts(input, resources);
    try {
      await opened;
      let closeFinished = false;
      const closing = resources.close().then(() => {
        closeFinished = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeFinished).toBe(false);

      releaseOpen();
      await closing;
      const result = await exporting;
      if (result.ok)
        throw new Error("Expected the closed scope to refuse publication");
      expect(result.error.userMessage).toContain("resource scope is closed");
      await expect(access(input.output_directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      releaseOpen();
      await resources.close().catch(() => undefined);
    }
  });
});

it("does not isolate a permission refusal just because a differently cased peer exists", async () => {
  const { input, resources } = await setup(
    scriptScenarioFixture([
      {
        url: "https://fixture.test/App.js",
        bytes: Buffer.from("export const upper = 1;"),
      },
      {
        url: "https://fixture.test/app.js",
        bytes: Buffer.from("export const lower = 2;"),
      },
    ]),
  );
  const denied = Object.assign(new Error("controlled selected-path denial"), {
    code: "EACCES",
  });
  let refusals = 0;
  openMock.mockImplementation(async (...args) => {
    if (
      String(args[0]).endsWith("/app.js") &&
      typeof args[1] === "number" &&
      (args[1] & constants.O_EXCL) !== 0
    ) {
      refusals++;
      throw denied;
    }
    return actualFs.open(...args);
  });
  const result = await exportWebScripts(input, resources);
  expect(refusals).toBe(1);
  if (result.ok) throw new Error("Permission failure was hidden by recovery");
  expect(result.error.cause).toBeInstanceOf(ArtifactReaderFailure);
  if (!(result.error.cause instanceof ArtifactReaderFailure))
    throw new Error("Missing file creation failure");
  expect(result.error.cause.cause).toBe(denied);
  await expect(access(input.output_directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("does not choose collision recovery from an untyped diagnostic prefix", async () => {
  const { input, resources } = await setup();
  const refusal = new ArtifactReaderFailure(
    "path",
    "Destination filesystem cannot store both diagnostic words and authority.",
  );
  const write = vi
    .spyOn(SafeOutputTree.prototype, "write")
    .mockRejectedValueOnce(refusal);
  try {
    const result = await exportWebScripts(input, resources);
    expect(result.ok).toBe(false);
    await expect(access(input.output_directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    write.mockRestore();
  }
});

it("isolates an observed exclusive-create alias using typed facts when diagnostic wording changes", async () => {
  const scripts = [
    {
      url: "https://fixture.test/App.js",
      bytes: Buffer.from("export const upper = 1;"),
    },
    {
      url: "https://fixture.test/app.js",
      bytes: Buffer.from("export const lower = 2;"),
    },
  ];
  const { input, resources } = await setup(scriptScenarioFixture(scripts));
  const native = Object.assign(
    new Error("controlled case-insensitive exclusive create"),
    { code: "EEXIST" },
  );
  openMock.mockImplementation(async (...args) => {
    if (
      String(args[0]).endsWith("/app.js") &&
      typeof args[1] === "number" &&
      (args[1] & constants.O_EXCL) !== 0
    )
      throw native;
    return actualFs.open(...args);
  });
  const collisions: DestinationCaseCollisionFailure[] = [];
  const original = SafeOutputTree.prototype.write;
  const write = vi
    .spyOn(SafeOutputTree.prototype, "write")
    .mockImplementation(async function (this: SafeOutputTree, ...args) {
      try {
        return await original.apply(this, args);
      } catch (cause) {
        if (cause instanceof DestinationCaseCollisionFailure) {
          collisions.push(cause);
          cause.message = "Observed destination spelling conflict.";
        }
        throw cause;
      }
    });
  try {
    const exported = await exportWebScripts(input, resources);
    if (!exported.ok) throw exported.error;
    const result = webScriptExportResultSchema.parse(
      exported.value.normalized_result,
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.requestedPath).toMatch(/\/app\.js$/u);
    expect(collisions[0]?.existingPath).toMatch(/\/App\.js$/u);
    expect(collisions[0]?.cause).toBe(native);
    expect(
      result.scripts.map(({ content }) =>
        content.state === "exported" ? content.layout : null,
      ),
    ).toEqual(["url-path", "isolated"]);
    expect(result.scripts[1]?.content).toMatchObject({
      layout_reason: "Observed destination spelling conflict.",
    });
    if (result.analysis_input === null)
      throw new Error("Missing exported bytes");
    for (const [index, script] of result.scripts.entries()) {
      if (script.content.state !== "exported")
        throw new Error("Missing script bytes");
      const expected = scripts[index];
      if (expected === undefined) throw new Error("Missing expected script");
      expect(script.url).toBe(expected.url);
      expect(
        Buffer.compare(
          await readFile(
            join(
              result.analysis_input.input_path,
              script.content.relative_path,
            ),
          ),
          expected.bytes,
        ),
      ).toBe(0);
    }
  } finally {
    write.mockRestore();
  }
});

it.each(["basename", "directory"])(
  "isolates a destination-unrepresentable %s without losing peer scripts",
  async (kind) => {
    const long = "b".repeat(kind === "basename" ? 253 : 256);
    const scripts = [
      {
        url: "https://fixture.test/regular.js",
        bytes: Buffer.from("export const regular = 1;"),
      },
      {
        url: `https://fixture.test/${"c".repeat(252)}.js`,
        bytes: Buffer.from("export const boundary = 1;"),
      },
      {
        url: `https://fixture.test/${kind === "basename" ? `${long}.js` : `${long}/main.js`}`,
        bytes: Buffer.from("export const long = 2;"),
      },
    ];
    const { input, resources } = await setup(scriptScenarioFixture(scripts));
    const exported = await exportWebScripts(input, resources);
    if (!exported.ok) throw exported.error;
    const result = webScriptExportResultSchema.parse(
      exported.value.normalized_result,
    );
    expect(result.scripts).toHaveLength(3);
    expect(result.scripts[0]?.content).toMatchObject({ layout: "url-path" });
    expect(result.scripts[1]?.content).toMatchObject({ layout: "url-path" });
    expect(result.scripts[2]?.content).toMatchObject({
      layout: "isolated",
      layout_reason: expect.stringContaining("cannot represent"),
    });
    for (const [index, script] of result.scripts.entries()) {
      if (script.content.state !== "exported" || result.analysis_input === null)
        throw new Error("Missing exported source");
      expect(script.url).toBe(scripts[index]!.url);
      expect(
        (
          await readFile(
            join(
              result.analysis_input.input_path,
              script.content.relative_path,
            ),
          )
        ).equals(scripts[index]!.bytes),
      ).toBe(true);
    }
    expect(
      JSON.parse(await readFile(result.manifest.path, "utf8")).scripts,
    ).toEqual(result.scripts);
  },
);
