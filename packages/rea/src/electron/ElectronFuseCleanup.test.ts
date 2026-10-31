import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { readElectronFuseImage } from "./ElectronFuseReader.js";
import fs, { fstatSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as fileSystem from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";

import { thinFuseImage } from "../../tests/fixtures/electron/fuseImage.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { createHash } from "node:crypto";
import { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ElectronFuseProvider } from "./ElectronFuseProvider.js";
import { PlaywrightElectronActiveProvider } from "../browser/PlaywrightElectronActiveProvider.js";
import { electronActiveObservationInputSchema } from "../domain/javascript/electronActiveObservation.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { assertNodeCliInspectArgumentsSupported } from "../browser/PlaywrightElectronActiveFuses.js";

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

it("retains the exact rejected fuse descriptor until its owner can close it", async () => {
  const root = await createTestTempDirectory("rea-fuse-close-owner-");
  const path = join(root, "application");
  await fileSystem.writeFile(path, thinFuseImage([0x31]).bytes);
  const originalOpen = fileSystem.open;
  const releases: (() => Promise<void>)[] = [];
  let denyClose = true;
  const descriptors: number[] = [];
  vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (String(args[0]) !== path) return file;
    descriptors.push(file.fd);
    const close = file.close.bind(file);
    releases.push(close);
    vi.spyOn(file, "close").mockImplementation(async () => {
      if (denyClose)
        throw Object.assign(new Error("close denied"), { code: "EACCES" });
      await close();
    });
    return file;
  });
  syncBuiltinESMExports();
  const provider = new ElectronFuseProvider();
  try {
    const result = await provider.inspect({ path });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected incomplete descriptor cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([path]);
    expect(fstatSync(descriptors[0]!)).toBeDefined();
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(descriptors).toHaveLength(1);
    expect(result.error.cleanupIncomplete).toBe(true);
    denyClose = false;
    await provider.close();
    expect(() => fstatSync(descriptors[0]!)).toThrow();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    denyClose = false;
    for (const close of releases) await close();
  }
});

const faultyFuse = async (faults: {
  read?: () => Promise<never>;
  close?: () => Promise<void>;
}) => {
  const root = await createTestTempDirectory("rea-fuse-finalization-");
  const path = join(root, "application");
  const bytes = thinFuseImage([0x31]).bytes;
  await fileSystem.writeFile(path, bytes);
  const originalOpen = fileSystem.open;
  const releases: (() => Promise<void>)[] = [];
  vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (String(args[0]) !== path) return file;
    const close = file.close.bind(file);
    releases.push(close);
    if (faults.read !== undefined)
      vi.spyOn(file, "read").mockImplementation(faults.read);
    vi.spyOn(file, "close").mockImplementation(async () => {
      await faults.close?.();
      await close();
    });
    return file;
  });
  syncBuiltinESMExports();
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opened: () => releases.length,
    release: async () => {
      for (const close of releases) await close();
    },
  };
};

it.each([false, true])(
  "preserves a physical read failure when cancellation arrives afterward (same reason=%s)",
  async (sameReason) => {
    const controller = new AbortController();
    const physical = Object.assign(new Error("physical read failed"), {
      code: "EIO",
    });
    const fixture = await faultyFuse({
      read: async () => {
        controller.abort(sameReason ? physical : { caller: "late" });
        throw physical;
      },
    });
    const provider = new ElectronFuseProvider();
    try {
      const result = await provider.inspect(
        { path: fixture.path },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected physical read failure");
      expect(result.error.cause).toBe(physical);
      expect(projectAnalysisError(result.error).code).not.toBe("cancelled");
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      await provider.close();
      await fixture.release();
    }
  },
);

it("keeps the physical failure alongside a retryable failed close", async () => {
  const physical = Object.assign(new Error("physical read failed"), {
    code: "EIO",
  });
  let denied = true;
  const fixture = await faultyFuse({
    read: async () => {
      throw physical;
    },
    close: async () => {
      if (denied) throw new Error("close denied");
    },
  });
  const provider = new ElectronFuseProvider();
  try {
    const result = await provider.inspect({ path: fixture.path });
    if (result.ok) throw new Error("Expected physical read and close failures");
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    if (!(result.error.cause instanceof AggregateError))
      throw new Error("Expected both failures");
    expect(result.error.cause.errors[0].cause).toBe(physical);
    expect(result.error.cleanupIncomplete).toBe(true);
    denied = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cause.errors[0].cause).toBe(physical);
  } finally {
    denied = false;
    await fixture.release();
  }
});

it.each([false, true])(
  "retains completed fuse Evidence through final close (cancelled=%s)",
  async (cancelled) => {
    const controller = new AbortController();
    const reason = { caller: "during final close" };
    let denied = true;
    const fixture = await faultyFuse({
      close: async () => {
        if (cancelled) controller.abort(reason);
        if (denied) throw new Error("close denied");
      },
    });
    const provider = new ElectronFuseProvider();
    const service = new ElectronFuseService(provider);
    try {
      const result = await service.inspect(
        { path: fixture.path },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected final close failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.partialObservation).toMatchObject({
        normalized_result: {
          artifact: { resolved_path: fixture.path, sha256: fixture.sha256 },
        },
        operation: "inspect_electron_fuses",
      });
      denied = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      if (cancelled) {
        expect(projectAnalysisError(result.error).code).toBe("cancelled");
        if (!(result.error.cause instanceof AggregateError))
          throw new Error("Expected retained cancellation");
        expect(result.error.cause.errors[0].cause).toBe(reason);
      }
    } finally {
      denied = false;
      await fixture.release();
    }
  },
);

it("does not allow active Electron preflight to swallow an owned close failure", async () => {
  let denied = true;
  const fixture = await faultyFuse({
    close: async () => {
      if (denied) throw new Error("close denied");
    },
  });
  const resources = new ArtifactResourceScope();
  try {
    await expect(
      assertNodeCliInspectArgumentsSupported(fixture.path, { resources }),
    ).rejects.toMatchObject({ cleanupIncomplete: true });
    await expect(resources.close()).rejects.toBeDefined();
    denied = false;
    await resources.close();
  } finally {
    denied = false;
    await fixture.release();
  }
});

it("lets the shared fuse service retry its provider's failed descriptor close", async () => {
  let denied = true;
  const fixture = await faultyFuse({
    close: async () => {
      if (denied) throw new Error("close denied");
    },
  });
  const service = new ElectronFuseService(new ElectronFuseProvider());
  try {
    const result = await service.inspect({ path: fixture.path });
    if (result.ok) throw new Error("Expected close failure");
    await expect(service.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    denied = false;
    await service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    denied = false;
    await fixture.release();
  }
});

it("retains the exact caller reason and completed Evidence when final close succeeds after cancellation", async () => {
  const controller = new AbortController();
  const reason = { caller: "cancel during successful close" };
  const fixture = await faultyFuse({
    close: async () => controller.abort(reason),
  });
  const provider = new ElectronFuseProvider();
  try {
    const result = await new ElectronFuseService(provider).inspect(
      { path: fixture.path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected final cancellation");
    expect(result.error.cause).toBe(reason);
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toMatchObject({
      normalized_result: { artifact: { sha256: fixture.sha256 } },
    });
  } finally {
    await provider.close();
    await fixture.release();
  }
});

it("does not launch Electron while its real preflight descriptor remains owned", async () => {
  let denied = true;
  const fixture = await faultyFuse({
    close: async () => {
      if (denied) throw new Error("close denied");
    },
  });
  let launches = 0;
  const provider = new PlaywrightElectronActiveProvider({}, async () => {
    launches += 1;
    throw new Error("Launch must not be reached");
  });
  try {
    const result = await provider.capture({
      ...electronActiveObservationInputSchema.parse({
        executable_path: fixture.path,
        application_path: fixture.path,
      }),
      application_root: dirname(fixture.path),
    });
    expect(launches).toBe(0);
    if (result.ok) throw new Error("Expected owned preflight cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([fixture.path]);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    denied = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    denied = false;
    await fixture.release();
  }
});

it("keeps the shared workflow's exact pre-abort reason without opening a file", async () => {
  const controller = new AbortController();
  const reason = { caller: "before inspection" };
  controller.abort(reason);
  const fixture = await faultyFuse({});
  const provider = new ElectronFuseProvider();
  try {
    const result = await new ElectronFuseService(provider).inspect(
      { path: fixture.path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected admission cancellation");
    expect(result.error.cause).toBe(reason);
    expect(fixture.opened()).toBe(0);
  } finally {
    await provider.close();
    await fixture.release();
  }
});

it("awaits an admitted preflight's final close before projecting cancellation", async () => {
  const controller = new AbortController();
  const physical = Object.assign(new Error("preflight read failed"), {
    code: "EIO",
  });
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let markClose!: () => void;
  const closeEntered = new Promise<void>((resolve) => {
    markClose = resolve;
  });
  let denied = true;
  const fixture = await faultyFuse({
    read: async () => {
      controller.abort(physical);
      throw physical;
    },
    close: async () => {
      markClose();
      await closeGate;
      if (denied) throw new Error("preflight close denied");
    },
  });
  let launches = 0;
  const provider = new PlaywrightElectronActiveProvider({}, async () => {
    launches += 1;
    throw new Error("Unexpected Electron launch");
  });
  const input = {
    ...electronActiveObservationInputSchema.parse({
      executable_path: fixture.path,
      application_path: fixture.path,
    }),
    application_root: dirname(fixture.path),
  };
  let settled = false;
  const running = provider
    .capture(input, { signal: controller.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(closeEntered, running, "preflight close");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    releaseClose();
    const result = await running;
    if (result.ok) throw new Error("Expected preflight failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    if (!(result.error.cause instanceof AggregateError))
      throw new Error("Expected both producer outcomes");
    expect(result.error.cause.errors[0].cause).toBe(physical);
    const retry = await provider.capture(input);
    if (retry.ok) throw new Error("Expected retained owner to block launch");
    expect(retry.error.cleanupIncomplete).toBe(true);
    expect(fixture.opened()).toBe(1);
    expect(launches).toBe(0);
    denied = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(retry.error.cleanupIncomplete).toBe(false);
  }, [
    () => {
      releaseClose();
      denied = false;
    },
    async () => {
      await running;
    },
    () => provider.close(),
    () => fixture.release(),
  ]);
});

it.each(["admission", "close"] as const)(
  "keeps active preflight's exact caller reason at %s",
  async (phase) => {
    const controller = new AbortController();
    const reason = { caller: phase };
    const fixture = await faultyFuse({
      close: async () => controller.abort(reason),
    });
    if (phase === "admission") controller.abort(reason);
    let launches = 0;
    const provider = new PlaywrightElectronActiveProvider({}, async () => {
      launches += 1;
      throw new Error("Unexpected launch");
    });
    try {
      const result = await provider.capture(
        {
          ...electronActiveObservationInputSchema.parse({
            executable_path: fixture.path,
            application_path: fixture.path,
          }),
          application_root: dirname(fixture.path),
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error.cause).toBe(reason);
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(launches).toBe(0);
      expect(fixture.opened()).toBe(phase === "admission" ? 0 : 1);
    } finally {
      await provider.close();
      await fixture.release();
    }
  },
);

it("preserves a preflight caller cancelled while its preceding descriptor is being recovered", async () => {
  const controller = new AbortController();
  const reason = { caller: "during retained-owner retry" };
  let recover = false;
  const fixture = await faultyFuse({
    close: async () => {
      if (!recover) throw new Error("close denied");
      controller.abort(reason);
    },
  });
  let launches = 0;
  const provider = new PlaywrightElectronActiveProvider({}, async () => {
    launches += 1;
    throw new Error("Unexpected launch");
  });
  const input = {
    ...electronActiveObservationInputSchema.parse({
      executable_path: fixture.path,
      application_path: fixture.path,
    }),
    application_root: dirname(fixture.path),
  };
  try {
    const first = await provider.capture(input);
    if (first.ok) throw new Error("Expected retained descriptor");
    expect(first.error.cleanupIncomplete).toBe(true);
    recover = true;
    const result = await provider.capture(input, { signal: controller.signal });
    if (result.ok) throw new Error("Expected queued admission cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(fixture.opened()).toBe(1);
    expect(launches).toBe(0);
  } finally {
    recover = true;
    await provider.close();
    await fixture.release();
  }
});

it("joins shutdown during preflight and refuses any later launch or capture", async () => {
  const root = await createTestTempDirectory("rea-fuse-preflight-shutdown-");
  const path = join(root, "selected");
  await fileSystem.writeFile(path, thinFuseImage([0x31]).bytes);
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const launch = vi.fn(async () => {
    throw new Error("Launch must not occur after shutdown");
  });
  const read = vi.fn(
    async (...args: Parameters<typeof readElectronFuseImage>) => {
      entered.resolve();
      await release.promise;
      return readElectronFuseImage(...args);
    },
  );
  const provider = new PlaywrightElectronActiveProvider({}, launch, read);
  const input = {
    ...electronActiveObservationInputSchema.parse({
      executable_path: path,
      application_path: path,
    }),
    application_root: root,
  };
  const running = provider.capture(input);
  await entered.promise;
  let closed = false;
  const closing = provider.close().then(() => {
    closed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release.resolve();
    expect((await running).ok).toBe(false);
    await closing;
    expect(launch).not.toHaveBeenCalled();
    expect((await provider.capture(input)).ok).toBe(false);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    release.resolve();
    await running;
    await closing;
  }
});

it("releases successful descriptor peers while retaining the failed owner's exact retry", async () => {
  const root = await createTestTempDirectory("rea-fuse-mixed-descriptors-");
  const paths = [join(root, "first"), join(root, "second")];
  await Promise.all(
    paths.map((path) =>
      fileSystem.writeFile(path, thinFuseImage([0x31]).bytes),
    ),
  );
  const originalOpen = fileSystem.open;
  const controls = new Map<
    string,
    { allowed: boolean; descriptor: number; release: () => Promise<void> }
  >();
  vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const path = String(args[0]);
    if (!paths.includes(path)) return handle;
    const release = handle.close.bind(handle);
    const control = { allowed: false, descriptor: handle.fd, release };
    controls.set(path, control);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      if (!control.allowed) throw new Error("authored peer close denial");
      await release();
    });
    return handle;
  });
  syncBuiltinESMExports();
  const provider = new ElectronFuseProvider();
  try {
    const results = await Promise.all(
      paths.map((path) => provider.inspect({ path })),
    );
    expect(controls.size).toBe(2);
    const first = controls.get(paths[0]!)!;
    const second = controls.get(paths[1]!)!;
    first.allowed = true;
    let aggregate: unknown;
    try {
      await provider.close();
    } catch (cause) {
      aggregate = cause;
    }
    expect(aggregate).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [paths[1]],
    });
    expect(() => fstatSync(first.descriptor)).toThrow();
    expect(fstatSync(second.descriptor)).toBeDefined();
    expect(results[0]).toMatchObject({
      error: { cleanupIncomplete: false, cleanupResources: [] },
    });
    expect(results[1]).toMatchObject({
      error: { cleanupIncomplete: true, cleanupResources: [paths[1]] },
    });
    second.allowed = true;
    await provider.close();
    expect(aggregate).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(results[1]).toMatchObject({
      error: { cleanupIncomplete: false, cleanupResources: [] },
    });
    expect(() => fstatSync(second.descriptor)).toThrow();
  } finally {
    for (const control of controls.values()) {
      control.allowed = true;
      await control.release();
    }
    await provider.close();
  }
});
