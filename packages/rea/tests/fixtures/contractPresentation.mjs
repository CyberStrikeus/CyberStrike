import { silentLogger } from "../../dist/logger.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { BROWSER_TOOL_CONTRACTS } from "../../dist/contracts/browserToolContracts.js";
import { BROWSER_SCENARIO_TOOL_CONTRACTS } from "../../dist/contracts/browserScenarioToolContracts.js";
import { ELECTRON_TOOL_CONTRACTS } from "../../dist/contracts/javascript/electronToolContracts.js";
import { JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS } from "../../dist/contracts/javascript/javascriptRuntimeObservationToolContracts.js";
import { TOOL_CONTRACTS } from "../../dist/contracts/toolContracts.js";
import { parseConfig } from "../../dist/config/parseConfig.js";
import { createBinarySession } from "../../dist/composition/binary.js";

// Mutate only this child's presentation arrays, before importing registration.
if (process.argv[2] === "reversed") {
  for (const contracts of [
    BROWSER_TOOL_CONTRACTS,
    BROWSER_SCENARIO_TOOL_CONTRACTS,
    ELECTRON_TOOL_CONTRACTS,
    JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS,
    TOOL_CONTRACTS,
  ])
    contracts.reverse();
}
const { createServer } = await import("../../dist/server/createServer.js");
const config = parseConfig({});
if (!config.ok) throw config.error;
const session = createBinarySession(config.value, silentLogger, {});
const server = createServer({ kind: "session", session });
const client = new Client({ name: "contract-presentation", version: "1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const catalog = await client.listTools();
  const responses = [];
  for (const contract of [
    ...BROWSER_TOOL_CONTRACTS,
    ...BROWSER_SCENARIO_TOOL_CONTRACTS,
    ...ELECTRON_TOOL_CONTRACTS.filter(
      ({ name }) => name !== "analyze_javascript_application",
    ),
    ...JAVASCRIPT_RUNTIME_OBSERVATION_TOOL_CONTRACTS,
  ]) {
    const example = contract.examples[0];
    if (example === undefined)
      throw new Error(`Missing example for ${contract.name}`);
    responses.push({
      name: contract.name,
      response: await client.callTool({
        name: contract.name,
        arguments: example.input,
      }),
    });
  }
  process.stdout.write(JSON.stringify({ catalog: catalog.tools, responses }));
} finally {
  await client.close();
  await server.close();
  await session.close();
}
