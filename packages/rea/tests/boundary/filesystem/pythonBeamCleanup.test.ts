import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fileSystem from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { pythonPycFixture } from "../../../src/python/PythonPyc.fixture.js";
import { PythonPycProvider } from "../../../src/python/PythonPycProvider.js";
import { PythonPycService } from "../../../src/application/python/PythonPycService.js";
import { BeamService } from "../../../src/application/erlang/BeamService.js";
import { BeamProvider } from "../../../src/erlang/BeamProvider.js";
import { erlangBeamFixture } from "../../../src/erlang/Beam.fixture.js";
import { DevicetreeService } from "../../../src/application/binaryDiagnostics/DevicetreeService.js";
import { DevicetreeProvider } from "../../../src/firmware/devicetree/DevicetreeProvider.js";
import { devicetreeFixture } from "../../../src/firmware/devicetree/Devicetree.fixture.js";

const injected = vi.hoisted(() => ({
  opened: undefined as
    | ((path: unknown, handle: FileHandle) => void)
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      injected.opened?.(args[0], handle);
      return handle;
    },
  };
});

afterEach(() => {
  injected.opened = undefined;
  vi.restoreAllMocks();
});

const providers = [
  {
    name: "Python pyc",
    operation: "inspect_python_pyc",
    bytes: pythonPycFixture(),
    create: () => new PythonPycService(new PythonPycProvider()),
  },
  {
    name: "Erlang BEAM",
    operation: "inspect_erlang_beam",
    bytes: erlangBeamFixture(),
    create: () => new BeamService(new BeamProvider()),
  },
  {
    name: "devicetree",
    operation: "inspect_devicetree",
    bytes: devicetreeFixture(),
    create: () => new DevicetreeService(new DevicetreeProvider()),
  },
];

const outcomes = [
  { stage: "completed read", cancelDuringClose: false, failRead: false },
  {
    stage: "cancellation during close",
    cancelDuringClose: true,
    failRead: false,
  },
  {
    stage: "read failure then cancellation",
    cancelDuringClose: true,
    failRead: true,
  },
];

it.each(
  providers.flatMap((provider) =>
    outcomes.map((outcome) => ({ ...provider, ...outcome })),
  ),
)(
  "$name preserves acquired facts and resolves cleanup after retries: $stage",
  async ({ operation, bytes, create, cancelDuringClose, failRead }) => {
    const root = await createTestTempDirectory("rea-python-beam-close-owner-");
    const path = join(root, "selected-artifact");
    await fileSystem.writeFile(path, bytes);
    const releases: (() => Promise<void>)[] = [];
    const descriptors: number[] = [];
    const controller = new AbortController();
    const reason = { source: "cancelled during descriptor finalization" };
    const readFailure = new Error("injected physical artifact read failure");
    let denyClose = true;
    injected.opened = (openedPath, file) => {
      if (String(openedPath) !== path) return;
      descriptors.push(file.fd);
      if (failRead) vi.spyOn(file, "read").mockRejectedValueOnce(readFailure);
      const close = file.close.bind(file);
      releases.push(close);
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (cancelDuringClose) controller.abort(reason);
        if (denyClose)
          throw new Error("injected artifact descriptor close failure");
        await close();
      });
    };
    const service = create();
    try {
      const result = await service.inspect(
        { path },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected incomplete descriptor cleanup");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([path]);
      const expectedSnapshot = failRead
        ? undefined
        : {
            kind: "file-snapshot-hash",
            path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
          };
      expect(result.error.partialObservation).toEqual(expectedSnapshot);
      if (failRead)
        expect(result.error.cleanupPrimary?.cause).toBe(readFailure);
      else if (cancelDuringClose) {
        expect(result.error.cleanupPrimary?._tag).toBe(
          "AnalysisCancelledError",
        );
        expect(result.error.cleanupPrimary?.cause).toBe(reason);
      }
      expect(fstatSync(descriptors[0]!)).toBeDefined();
      const closeErrors: ProviderCleanupError[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const failure: unknown = await service.close().then(
          () => undefined,
          (cause: unknown) => cause,
        );
        expect(failure).toBeInstanceOf(ProviderCleanupError);
        if (!(failure instanceof ProviderCleanupError))
          throw new Error("Expected a translated provider cleanup failure");
        expect(failure.operation).toBe(operation);
        expect(failure.cleanupIncomplete).toBe(true);
        expect(failure.cleanupResources).toEqual([path]);
        closeErrors.push(failure);
      }
      expect(descriptors).toHaveLength(1);
      expect(result.error.cleanupIncomplete).toBe(true);
      denyClose = false;
      await service.close();
      expect(() => fstatSync(descriptors[0]!)).toThrow();
      for (const failure of [result.error, ...closeErrors]) {
        expect(failure.cleanupIncomplete).toBe(false);
        expect(failure.cleanupResources).toEqual([]);
      }
      expect(result.error.partialObservation).toEqual(expectedSnapshot);
    } finally {
      denyClose = false;
      await service.close();
      for (const close of releases) await close();
    }
  },
);

it.each([{ source: "BEAM successful close" }, null])(
  "preserves BEAM cancellation during successful close with reason %j",
  async (reason) => {
    const root = await createTestTempDirectory("rea-beam-successful-close-");
    const path = join(root, "selected.beam");
    const bytes = erlangBeamFixture();
    await fileSystem.writeFile(path, bytes);
    const controller = new AbortController();
    const handles: FileHandle[] = [];
    injected.opened = (openedPath, handle) => {
      if (String(openedPath) !== path) return;
      handles.push(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        controller.abort(reason);
        await close();
      });
    };
    const service = new BeamService(new BeamProvider());
    try {
      const result = await service.inspect(
        { path },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected finalization cancellation");
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.partialObservation).toEqual({
        kind: "file-snapshot-hash",
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      expect(handles).toHaveLength(1);
      expect(handles[0]?.fd).toBe(-1);
      await service.close();
      expect(handles).toHaveLength(1);
    } finally {
      await service.close();
    }
  },
);
