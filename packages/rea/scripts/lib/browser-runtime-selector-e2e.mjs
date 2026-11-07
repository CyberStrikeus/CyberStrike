import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mcpTextValue } from "./mcp-verifier-results.mjs";

/** Verify native malformed-selector classification through the public CLI and MCP. */
export async function verifyRuntimeInvalidSelectors(
  client,
  entrypoint,
  input,
  env,
) {
  const cli = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        entrypoint,
        "inspect-web-event-listeners",
        input.cdp_endpoint,
        input.target_id,
        "[",
        "--json",
      ],
      { env, timeout: 40_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });
  assert.ok(cli.error, "Invalid native CSS must fail in the CLI");
  assert.equal(typeof cli.error.code, "number", cli.stderr);
  assertInputFailure(JSON.parse(cli.stdout), input.target_id);
  const response = await client.callTool({
    name: "inspect_web_event_listeners",
    arguments: { ...input, selector: "[" },
  });
  assert.equal(response.isError, true, mcpTextValue(response));
  assertInputFailure(JSON.parse(mcpTextValue(response)).error, input.target_id);
  return { cli: "invalid_input", mcp: "invalid_input", selector: "[" };
}

function assertInputFailure(failure, targetId) {
  assert.equal(failure.code, "invalid_request");
  assert.equal(failure.category, "invalid_input");
  assert.equal(failure.details.operation, "inspect_web_event_listeners");
  assert.ok(
    failure.details.issues.some(
      (issue) =>
        issue.path[0] === "selector" && issue.message.includes(targetId),
    ),
  );
}
