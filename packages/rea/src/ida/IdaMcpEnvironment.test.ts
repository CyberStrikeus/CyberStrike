import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_INHERITED_ENV_VARS } from "@modelcontextprotocol/client/stdio";
import { createIdaMcpConnection } from "./IdaMcpConnection.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("launches the upstream SDK transport with the selected snapshot and suppresses ambient SDK defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-ida-environment-"));
  roots.push(root);
  const script = join(root, "producer.mjs");
  await writeFile(
    script,
    `
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'environment-producer', version: '1' } }
    : request.method === 'tools/list'
      ? { tools: [{ name: 'environment', inputSchema: { type: 'object' } }] }
      : { content: [], structuredContent: { selected: process.env.REA_SELECTED_CONTEXT ?? null, registration: process.env.REA_REGISTRATION_CONTEXT ?? null, ambient: process.env.REA_AMBIENT_CONTEXT ?? null, home: process.env.HOME ?? null, path: process.env.PATH ?? null } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`,
  );
  vi.stubEnv("REA_SELECTED_CONTEXT", "ambient");
  vi.stubEnv("REA_AMBIENT_CONTEXT", "ambient-only");
  vi.stubEnv("HOME", "/ambient-home");
  vi.stubEnv("PATH", "/ambient-path");
  const environment = {
    REA_SELECTED_CONTEXT: "selected",
    REA_REGISTRATION_CONTEXT: "selected-base",
    HOME: "/selected-home",
    PATH: "/selected-path",
  };
  const registrationEnvironment: Record<string, string> = {
    REA_REGISTRATION_CONTEXT: "registration",
  };
  if (process.platform === "win32") {
    const systemRoot = process.env.SYSTEMROOT;
    if (systemRoot === undefined || systemRoot.length === 0)
      throw new Error(
        "The Windows Node fixture requires its actual SYSTEMROOT.",
      );
    registrationEnvironment.SYSTEMROOT = systemRoot;
  }
  for (const selected of [environment, {}]) {
    const connection = createIdaMcpConnection(
      {
        command: process.execPath,
        args: [script],
        env: registrationEnvironment,
        mode: "attached",
        timeoutMs: 5000,
      },
      selected,
    );
    environment.REA_SELECTED_CONTEXT = "mutated-after-construction";
    try {
      expect(await connection.connect()).toEqual(["environment"]);
      expect(await connection.call("environment", {})).toEqual({
        selected: selected === environment ? "selected" : null,
        registration: "registration",
        ambient: null,
        home:
          selected === environment
            ? "/selected-home"
            : DEFAULT_INHERITED_ENV_VARS.includes("HOME")
              ? ""
              : null,
        path: selected === environment ? "/selected-path" : "",
      });
    } finally {
      await connection.close();
    }
  }
});
