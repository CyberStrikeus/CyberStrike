import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  rename,
  chmod,
  appendFile,
  symlink,
  truncate,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  readGhidraInstallationProperties,
  MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES,
} from "../../../src/ghidra/GhidraInstallationProperties.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const controls = vi.hoisted(() => ({
  file: undefined as ((handle: FileHandle, path: string) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      controls.file?.(handle, String(args[0]));
      return handle;
    },
  };
});
afterEach(() => {
  controls.file = undefined;
  vi.restoreAllMocks();
});

const properties = "application.version=12.1.4\napplication.java.min=21\n";

it("preserves a descriptor read failure instead of reporting absent metadata", async () => {
  const root = await createTestTempDirectory(
    "rea-install-properties-read-missing-",
  );
  const path = join(root, "application.properties");
  await writeFile(path, properties);
  const physical = Object.assign(
    new Error("controlled descriptor read failure"),
    { code: "ENOENT", syscall: "read" },
  );
  controls.file = (handle, opened) => {
    if (opened === path) vi.spyOn(handle, "read").mockRejectedValue(physical);
  };
  const resources = createInspectionResources();
  try {
    await expect(
      readGhidraInstallationProperties(path, {
        resourceOwner: resources.owner,
      }),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      cause: physical,
      diagnostics: {
        path,
        stage: "installation_properties",
        system_code: "ENOENT",
        syscall: "read",
      },
    });
  } finally {
    await resources.close();
  }
});

it.skipIf(process.platform === "win32")(
  "preserves Latin-1 bytes and a caller-selected properties symlink",
  async () => {
    const root = await createTestTempDirectory("rea-install-properties-");
    const path = join(root, "actual.properties");
    const selected = join(root, "selected.properties");
    const bytes = Buffer.concat([
      Buffer.from(properties),
      Buffer.from("note=caf\xe9\n", "latin1"),
    ]);
    await writeFile(path, bytes);
    await symlink(path, selected);
    const resources = createInspectionResources();
    try {
      expect(
        await readGhidraInstallationProperties(selected, {
          resourceOwner: resources.owner,
        }),
      ).toBe(bytes.toString("latin1"));
      expect(
        await readGhidraInstallationProperties(join(root, "absent"), {
          resourceOwner: resources.owner,
        }),
      ).toBeUndefined();
    } finally {
      await resources.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "refuses a pipe without waiting for a writer",
  async () => {
    const root = await createTestTempDirectory("rea-install-properties-pipe-");
    const path = join(root, "application.properties");
    await promisify(execFile)("mkfifo", [path]);
    const resources = createInspectionResources();
    try {
      await expect(
        readGhidraInstallationProperties(path, {
          resourceOwner: resources.owner,
        }),
      ).rejects.toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: {
          path,
          stage: "installation_properties",
          system_code: "ENOTFILE",
        },
      });
    } finally {
      await resources.close();
    }
  },
);

it("refuses an oversized descriptor before reading file bytes", async () => {
  const root = await createTestTempDirectory(
    "rea-install-properties-capacity-",
  );
  const path = join(root, "application.properties");
  await writeFile(path, properties);
  await truncate(path, MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES + 1);
  let reads = 0;
  controls.file = (handle, opened) => {
    if (opened === path) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(
        (...args: Parameters<typeof handle.read>) => {
          reads++;
          return read(...args);
        },
      );
    }
  };
  const resources = createInspectionResources();
  try {
    const failure = await readGhidraInstallationProperties(path, {
      resourceOwner: resources.owner,
    }).then(
      () => {
        throw new Error("Oversized properties accepted");
      },
      (cause) => cause as AnalysisError,
    );
    expect(failure).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "file-size",
      retryable: false,
      reportedLimits: {
        maximum_bytes: MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES,
        observed_bytes: String(MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES + 1),
      },
      diagnostics: { path, stage: "installation_properties" },
    });
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      remediation: {
        action: expect.stringContaining(
          "Ghidra installation-properties read allowance of 1048576 bytes (this release has no runtime override)",
        ),
      },
    });
    expect(projectAnalysisError(failure).remediation.action).toContain(
      "Increasing an evidence-reply file-size allowance does not admit this input",
    );
    expect(reads).toBe(0);
  } finally {
    await resources.close();
  }
});

it("does not open or adopt resources named by a pre-aborted opaque caller error", async () => {
  const resources = createInspectionResources();
  const reason = new ProviderCleanupError("foreign", ["caller-resource"], {
    reason: "caller metadata",
  });
  const controller = new AbortController();
  controller.abort(reason);
  let opens = 0;
  controls.file = () => {
    opens++;
  };
  try {
    await expect(
      readGhidraInstallationProperties("/selected/application.properties", {
        resourceOwner: resources.owner,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ _tag: "AnalysisCancelledError", cause: reason });
    expect(opens).toBe(0);
    expect(reason.cleanupIncomplete).toBe(true);
  } finally {
    await resources.close();
  }
});

it.each(["read", "capacity", "completed"] as const)(
  "retains the exact descriptor and primary outcome across refused cleanup (%s)",
  async (outcome) => {
    const root = await createTestTempDirectory("rea-install-properties-retry-");
    const path = join(root, "application.properties");
    await writeFile(path, properties);
    if (outcome === "capacity")
      await truncate(path, MAX_GHIDRA_INSTALLATION_PROPERTIES_BYTES + 1);
    const resources = createInspectionResources();
    const controller = new AbortController();
    const reason = { request: "cancel final metadata close" };
    const physical = Object.assign(new Error("controlled metadata EIO"), {
      code: "EIO",
    });
    let denied = true,
      closes = 0;
    let closeActual: (() => Promise<void>) | undefined;
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      closeActual = handle.close.bind(handle);
      if (outcome === "read")
        vi.spyOn(handle, "read").mockRejectedValue(physical);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closes++;
        controller.abort(reason);
        if (denied) throw new Error("controlled metadata close refusal");
        await closeActual?.();
      });
    };
    try {
      const failure = await readGhidraInstallationProperties(path, {
        resourceOwner: resources.owner,
        signal: controller.signal,
      }).catch((cause: unknown) => cause);
      if (!(failure instanceof AnalysisError))
        throw new Error("Expected attributed failure");
      expect(failure.cleanupIncomplete).toBe(true);
      expect(failure.cleanupResources).toEqual([path]);
      await expect(resources.close()).rejects.toThrow();
      expect(closes).toBe(2);
      await rename(path, join(root, "retired.properties"));
      await writeFile(path, "application.version=replacement\n");
      let replacementOpens = 0;
      controls.file = () => {
        replacementOpens++;
      };
      denied = false;
      await resources.close();
      expect(closes).toBe(3);
      expect(replacementOpens).toBe(0);
      expect(failure.cleanupIncomplete).toBe(false);
      if (outcome === "completed") {
        expect(failure).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
          diagnostics: {
            completed_properties: {
              bytes: Buffer.byteLength(properties),
              properties: { providerVersion: "12.1.4" },
            },
          },
        });
      } else if (outcome === "capacity") {
        expect(projectAnalysisError(failure).code).toBe("resource_constraint");
      } else {
        expect(failure._tag).toBe("ProviderAdapterError");
        expect(failure.diagnostics).toMatchObject({ system_code: "EIO" });
        expect(JSON.stringify(failure.diagnostics)).toContain(
          "controlled metadata EIO",
        );
      }
    } finally {
      denied = false;
      await resources.close();
      await closeActual?.();
    }
  },
);

it.each(["replace", "grow", "shrink", "disappear"] as const)(
  "rejects metadata that changes during a descriptor read (%s)",
  async (change) => {
    const root = await createTestTempDirectory(
      "rea-install-properties-replace-",
    );
    const path = join(root, "application.properties");
    const replacement = join(root, "replacement");
    await writeFile(path, properties);
    await writeFile(replacement, properties);
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementationOnce(
        async (...args: Parameters<typeof handle.read>) => {
          const result = await read(...args);
          if (change === "replace") await rename(replacement, path);
          else if (change === "disappear")
            await rename(path, join(root, "retired"));
          else if (change === "grow") await appendFile(path, "changed=true\n");
          else await truncate(path, 1);
          return result;
        },
      );
    };
    const resources = createInspectionResources();
    try {
      await expect(
        readGhidraInstallationProperties(path, {
          resourceOwner: resources.owner,
        }),
      ).rejects.toMatchObject({ _tag: "AnalysisArtifactChangedError", path });
    } finally {
      await resources.close();
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports a real metadata permission failure instead of missing installation",
  async () => {
    const root = await createTestTempDirectory(
      "rea-install-properties-permission-",
    );
    const path = join(root, "application.properties");
    await writeFile(path, properties);
    const resources = createInspectionResources();
    try {
      await chmod(path, 0o000);
      await expect(
        readGhidraInstallationProperties(path, {
          resourceOwner: resources.owner,
        }),
      ).rejects.toMatchObject({
        _tag: "AnalysisAccessDeniedError",
        path,
        systemCode: "EACCES",
        diagnostics: { path, stage: "installation_properties" },
      });
    } finally {
      await chmod(path, 0o600);
      await resources.close();
    }
  },
);
