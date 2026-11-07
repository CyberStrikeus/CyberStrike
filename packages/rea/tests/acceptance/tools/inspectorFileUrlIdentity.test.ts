import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, onTestFinished } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("preserves file URL scheme spelling and script identity after real Inspector state changes", async () => {
  const root = await createTestTempDirectory("rea-inspector-file-url-");
  const source = join(root, "source #参数%.cjs");
  const runner = join(root, "runner.cjs");
  const sourceText = "globalThis.fileUrlProbe = true;\n";
  await writeFile(source, sourceText);
  await writeFile(
    runner,
    `
    const { readFileSync } = require("node:fs");
    const vm = require("node:vm");
    const scripts = [];
    process.on("message", (urls) => {
      for (const filename of urls) {
        const script = new vm.Script(readFileSync(process.argv[2], "utf8"), { filename });
        scripts.push(script);
        script.runInThisContext();
      }
      process.send({ loaded: scripts.length });
    });
    setInterval(() => {}, 1000);
  `,
  );
  const child = spawn(
    process.execPath,
    ["--inspect=127.0.0.1:0", runner, source],
    {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  let stderr = "";
  if (child.stderr === null) throw new Error("Expected piped Inspector stderr");
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const address = /ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/u;
  await expect.poll(() => stderr, { timeout: 5000 }).toMatch(address);
  const socket = address.exec(stderr)?.[0];
  if (socket === undefined) throw new Error("Node omitted its Inspector URL");
  const endpoint = `http://127.0.0.1:${new URL(socket).port}`;
  const load = async (urls: readonly string[]) => {
    const loaded = once(child, "message");
    child.send(urls);
    await loaded;
  };
  const originalUrl = pathToFileURL(source).href;
  await load([originalUrl]);
  const { call } = await connectLocalToolsMcp();
  const listed = await call("list_javascript_runtime_targets", {
    inspector_endpoint: endpoint,
  });
  expect(listed.isError, JSON.stringify(listed.content)).not.toBe(true);
  const discovery = toolContract(
    "list_javascript_runtime_targets",
  ).outputSchema.parse(listed.structuredContent);
  const targetId = discovery.normalized_result.targets[0]?.target_id;
  if (targetId === undefined) throw new Error("Node target was not listed");
  const request = {
    inspector_endpoint: endpoint,
    target_id: targetId,
    observation_ms: 25,
  };
  const observe = async () => {
    const response = await call("observe_javascript_runtime", request);
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    return toolContract("observe_javascript_runtime").outputSchema.parse(
      response.structuredContent,
    );
  };
  const first = await observe();
  const initialScript = first.normalized_result.scripts.items.find(
    (script) => script.reported_url === originalUrl,
  );
  expect(initialScript).toMatchObject({
    location: { kind: "file", file_path: source },
  });

  const addedUrls = [
    originalUrl.replace(/^file:/u, "FILE:"),
    `${originalUrl.replace(/^file:/u, "FiLe:")}?instance=2#selected`,
    ` \t${originalUrl}\t `,
  ];
  await load(addedUrls);
  const second = await observe();
  const expectedUrls = [originalUrl, ...addedUrls];
  const scripts = second.normalized_result.scripts.items.filter((script) =>
    expectedUrls.includes(script.reported_url ?? ""),
  );
  expect(scripts.map((script) => script.reported_url)).toEqual(
    expect.arrayContaining(expectedUrls),
  );
  expect(scripts).toHaveLength(4);
  expect(new Set(scripts.map((script) => script.script_key)).size).toBe(4);
  for (const script of scripts)
    expect(script.location).toEqual({ kind: "file", file_path: source });
  expect(
    scripts.find((script) => script.reported_url === originalUrl)?.script_key,
  ).toBe(initialScript?.script_key);

  const retained = await call("get_evidence_bundle", {});
  expect(retained.isError, JSON.stringify(retained.content)).not.toBe(true);
  const records = toolContract("get_evidence_bundle").outputSchema.parse(
    retained.structuredContent,
  ).result.records;
  const original = records.find(
    (record) => record.evidence_id === first.evidence_id,
  );
  if (original === undefined || !("normalized_result" in original))
    throw new Error("Original Inspector Evidence was not retained");
  expect(original.predicate_type).toBe(first.predicate_type);
  expect(original.normalized_result).toEqual(first.normalized_result);
  expect(await readFile(source, "utf8")).toBe(sourceText);
}, 30_000);
