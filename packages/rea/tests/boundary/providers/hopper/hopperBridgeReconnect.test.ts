import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";

const execute = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "the shipped bridge reauthenticates reconnects and releases its execution thread after expiry",
  async () => {
    const runtime = await PrivateRuntimeRoot.create({ parent: "/tmp" });
    onTestFinished(() => runtime.close());
    const { stdout } = await execute("python3", [
      fileURLToPath(
        new URL(
          "../../../fixtures/hopperBridgeReconnectProbe.py",
          import.meta.url,
        ),
      ),
      fileURLToPath(
        new URL("../../../../bridge/hopper_bridge.py", import.meta.url),
      ),
      runtime.path,
    ]);
    const rows = z
      .array(
        z.object({
          mode: z.string(),
          requests: z.array(z.string()),
          listener_removed: z.literal(true),
          thread_released: z.literal(true),
        }),
      )
      .parse(JSON.parse(stdout));
    expect(rows).toEqual([
      {
        mode: "unauthorized",
        requests: ["health", "shutdown_document", "shutdown_document"],
        listener_removed: true,
        thread_released: true,
      },
      ...["disconnect", "lost-reply"].map((mode) => ({
        mode,
        requests: [
          "health",
          "health",
          "shutdown_document",
          "shutdown_document",
        ],
        listener_removed: true,
        thread_released: true,
      })),
      {
        mode: "authenticated-idle",
        requests: [
          "health",
          "health",
          "health",
          "shutdown_document",
          "shutdown_document",
        ],
        listener_removed: true,
        thread_released: true,
      },
      {
        mode: "expiry",
        requests: ["health"],
        listener_removed: true,
        thread_released: true,
      },
      ...["initial-expiry", "silent-expiry"].map((mode) => ({
        mode,
        requests: [],
        listener_removed: true,
        thread_released: true,
      })),
    ]);
  },
);
