import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("observes a real Node Inspector and releases attachments after cancellation and failures", async () => {
  const root = await createTestTempDirectory("rea-live-inspector-");
  const fixture = join(root, "probe #百分比 %.cjs");
  await writeFile(fixture, "setInterval(() => {}, 25);\n");
  const child = spawn(process.execPath, ["--inspect=127.0.0.1:0", fixture], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const terminate = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  };
  onTestFinished(terminate);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const address = /ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/u;
  await expect.poll(() => stderr, { timeout: 5000 }).toMatch(address);
  const socket = address.exec(stderr)?.[0];
  if (socket === undefined) throw new Error("Node omitted its Inspector URL");
  const endpoint = `http://127.0.0.1:${new URL(socket).port}`;
  const { client, call } = await connectLocalToolsMcp();
  const discovery = await call("list_javascript_runtime_targets", {
    inspector_endpoint: endpoint,
  });
  const targets = toolContract(
    "list_javascript_runtime_targets",
  ).outputSchema.parse(discovery.structuredContent);
  const id = targets.normalized_result.targets[0]?.target_id;
  if (id === undefined) throw new Error("Node Inspector target was not listed");
  const request = {
    inspector_endpoint: endpoint,
    target_id: id,
    observation_ms: 100,
  };
  const observed = await call("observe_javascript_runtime", request);
  const observation = toolContract(
    "observe_javascript_runtime",
  ).outputSchema.parse(observed.structuredContent);
  expect(observation.normalized_result.scripts.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        location: expect.objectContaining({ file_path: fixture }),
      }),
    ]),
  );
  const missing = await call("observe_javascript_runtime", {
    ...request,
    target_id: "../missing-target",
  });
  expect(missing.isError).toBe(true);
  expect(parseMcpToolError(missing)).toMatchObject({
    error: {
      code: "target_unavailable",
      message: expect.stringContaining("Refresh target discovery"),
      details: { reason: "target_not_found" },
    },
  });
  for (const invalid of [
    {
      name: "observe_javascript_runtime",
      arguments: { ...request, observation_ms: -1 },
    },
    {
      name: "list_javascript_runtime_targets",
      arguments: {
        inspector_endpoint: endpoint.replace(
          "http://",
          "http://user:password@",
        ),
      },
    },
  ])
    expect((await call(invalid.name, invalid.arguments)).isError).toBe(true);

  const attachments = () => (stderr.match(/Debugger attached/gu) ?? []).length;
  const detachments = () => (stderr.match(/Debugger ending on/gu) ?? []).length;
  const before = attachments();
  const controller = new AbortController();
  const cancelled = expect(
    call(
      "observe_javascript_runtime",
      { ...request, observation_ms: 10_000 },
      { signal: controller.signal },
    ),
  ).rejects.toThrow("cancel live observation");
  await expect.poll(attachments, { timeout: 5000 }).toBe(before + 1);
  controller.abort(new Error("cancel live observation"));
  await cancelled;
  await expect.poll(detachments, { timeout: 5000 }).toBe(attachments());
  expect(child.exitCode).toBeNull();
  expect(child.signalCode).toBeNull();
  expect((await call("observe_javascript_runtime", request)).isError).not.toBe(
    true,
  );
  await client.ping();
  await terminate();
  const unreachable = await call("list_javascript_runtime_targets", {
    inspector_endpoint: endpoint,
  });
  expect(unreachable.isError).toBe(true);
  expect(parseMcpToolError(unreachable)).toMatchObject({
    error: {
      code: "provider_unavailable",
      message: expect.stringContaining(
        "target process is running with debugging enabled",
      ),
      details: { reason: "endpoint_unreachable" },
    },
  });
}, 30_000);
