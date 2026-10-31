import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

// Runtime discovery is generated from the same canonical registrations, after
// default identity has been recorded and before bundling. Test catalogs stay separate.
const compiled = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const read = (name) => import(pathToFileURL(join(compiled, name)).href);
const [
  { createServer },
  { createBinarySession },
  { parseConfig },
  { silentLogger },
  { PROMPT_CONTRACTS },
] = await Promise.all([
  read("server/createServer.js"),
  read("composition/binary.js"),
  read("config/parseConfig.js"),
  read("logger.js"),
  read("contracts/promptContracts.js"),
]);
const recordCatalog = async (profile) => {
  // Catalog generation is independent of the host account and user configuration.
  const home = await mkdtemp(join(tmpdir(), "rea-mcp-catalog-"));
  const environment = {
    REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_STATE_HOME: join(home, "state"),
  };
  const cleanup = [];
  let producerFailure;
  try {
    const config = parseConfig(environment);
    if (!config.ok) throw config.error;
    const session = createBinarySession(
      config.value,
      silentLogger,
      environment,
    );
    cleanup.push(async () => {
      const closed = await session.close({ retainProviderDocuments: true });
      if (!closed.ok) throw closed.error;
    });
    const server = createServer({ kind: "session", session }, { environment });
    cleanup.push(() => server.close());
    const client = new Client({ name: "rea-catalog-recorder", version: "1" });
    cleanup.push(() => client.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const prompts = (await client.listPrompts()).prompts.map((prompt) => {
      const contract = PROMPT_CONTRACTS.find(
        (candidate) => candidate.name === prompt.name,
      );
      if (contract === undefined)
        throw new Error(`Missing prompt ${prompt.name}`);
      return { ...prompt, parameters: contract.arguments };
    });
    const catalog = {
      version: 1,
      info: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
      instructions: client.getInstructions(),
      identity: server.catalogIdentity,
      tools,
      prompts,
    };
    const encoded = JSON.stringify(catalog);
    const digest = createHash("sha256").update(encoded).digest("hex");
    await writeFile(
      join(
        compiled,
        profile === "full" ? "mcp-catalog-full.json" : "mcp-catalog.json",
      ),
      encoded,
    );
    return digest;
  } catch (cause) {
    producerFailure = { cause };
    throw cause;
  } finally {
    const results = await Promise.allSettled(
      cleanup.reverse().map((close) => Promise.resolve().then(close)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length === 0) {
      try {
        await rm(home, { recursive: true, force: true });
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        producerFailure === undefined
          ? failures
          : [producerFailure.cause, ...failures],
        `Catalog cleanup failed; temporary home retained at ${home}`,
      );
  }
};

const digests = {};
for (const profile of ["compact", "full"])
  digests[profile] = await recordCatalog(profile);
await writeFile(
  join(compiled, "recordedMcpCatalog.js"),
  `/** Recorded from the compiled runtime; do not edit. */\nexport const RECORDED_MCP_CATALOG_SHA256 = ${JSON.stringify(digests)};\n`,
);
