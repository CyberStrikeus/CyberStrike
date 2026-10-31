import { expect, it } from "vitest";
import {
  BUN_WORKER_RUNTIME_RESERVE_BYTES,
  javaScriptWorkerMemoryLimitBytes,
} from "./JavaScriptWorkerMemoryLimit.js";

const MIB = 1024 * 1024;
const bun = { node: "24.3.0", bun: "1.4.2" };
const node = { node: "24.18.0" };

it("limits a Bun worker on Windows to its heap budget plus Bun's runtime reserve", () => {
  expect(BUN_WORKER_RUNTIME_RESERVE_BYTES).toBe(512 * MIB);
  expect(
    javaScriptWorkerMemoryLimitBytes(192, { platform: "win32", versions: bun }),
  ).toBe(704 * MIB);
  expect(
    javaScriptWorkerMemoryLimitBytes(1024, {
      platform: "win32",
      versions: bun,
    }),
  ).toBe(1536 * MIB);
});

it.each([
  { label: "Node.js on Windows", platform: "win32", versions: node },
  { label: "Node.js on Linux", platform: "linux", versions: node },
  { label: "Bun on Linux", platform: "linux", versions: bun },
  { label: "Bun on macOS", platform: "darwin", versions: bun },
] as const)("applies no process limit for $label", ({ platform, versions }) => {
  expect(javaScriptWorkerMemoryLimitBytes(192, { platform, versions })).toBe(
    null,
  );
});
