import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const selected = vi.hoisted(() => ({
  operation: undefined as "ownership" | "mode" | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (
        typeof args[0] === "string" &&
        args[0].includes(`${sep}.rea-config-`) &&
        args[0].endsWith(`${sep}content`)
      ) {
        const operation = selected.operation;
        selected.operation = undefined;
        if (operation === "ownership") {
          // Make the staged group differ without requiring a privileged chown.
          const stat = handle.stat.bind(handle);
          vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
            const state = await stat();
            return Object.assign(state, { gid: state.gid + 1 });
          });
          vi.spyOn(handle, "chown").mockRejectedValue(
            Object.assign(new Error("Ownership preservation denied"), {
              code: "EPERM",
              syscall: "fchown",
            }),
          );
        } else if (operation === "mode") {
          vi.spyOn(handle, "chmod").mockRejectedValue(
            Object.assign(new Error("Mode preservation denied"), {
              code: "EACCES",
              syscall: "fchmod",
            }),
          );
        }
      }
      return handle;
    },
  };
});

import { configureClientConfiguration } from "../../src/application/SetupClientConfiguration.js";
import { failedConfigurationMessage } from "../../src/application/SetupClients.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

afterEach(() => {
  selected.operation = undefined;
  vi.restoreAllMocks();
});

it.each([
  ["ownership", "preserve_ownership", "EPERM", "fchown"],
  ["mode", "preserve_mode", "EACCES", "fchmod"],
] as const)(
  "retains %s failure facts, original bytes and backup through setup projection",
  async (operation, expectedOperation, systemCode, syscall) => {
    const root = await createTestTempDirectory("rea-config-write-diagnostic-");
    const path = join(root, "config.json");
    const original = '{"caller":"retained"}\n';
    await writeFile(path, original);
    selected.operation = operation;
    const result = await configureClientConfiguration({
      name: "cursor",
      configPath: path,
      format: "json",
    });
    expect(result).toMatchObject({
      status: "failed",
      reason: "write",
      backupPath: `${path}.rea.backup`,
      failure: {
        kind: "write",
        operation: expectedOperation,
        path,
        systemCode,
        syscall,
      },
    });
    if (result.status !== "failed")
      throw new Error("Expected failed configuration");
    const message = failedConfigurationMessage(result);
    expect(message).toContain(path);
    expect(message).toContain(systemCode);
    expect(message).toContain("backup remains");
    if (result.reason === "write" && operation === "ownership")
      expect(result.failure?.requestedOwnership).toMatchObject({
        uid: expect.any(Number),
        gid: expect.any(Number),
      });
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(original);
    expect((await readdir(root)).sort()).toEqual([
      "config.json",
      "config.json.rea.backup",
    ]);
  },
);
