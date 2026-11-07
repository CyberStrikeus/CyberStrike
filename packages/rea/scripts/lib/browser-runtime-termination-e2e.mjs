import assert from "node:assert/strict";
import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { mcpTextValue, requireMcpToolError } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Close a separately owned fixture page after actual MCP arming and inspect native cleanup diagnostics. */
export async function verifyRuntimeTargetTermination(client, input, origin) {
  const version = await (
    await fetch(`${input.cdp_endpoint}/json/version`)
  ).json();
  const root = await CdpConnection.connect(
    version.webSocketDebuggerUrl,
    "observe_web_execution",
  );
  let targetId;
  let closed = false;
  return withVerifierCleanup(async () => {
    ({ targetId } = await root.send("Target.createTarget", { url: origin }));
    assert.equal(typeof targetId, "string");
    await waitForTarget(input.cdp_endpoint, targetId, origin);
    let closePromise;
    const response = await client.callTool(
      {
        name: "observe_web_execution",
        arguments: {
          ...input,
          target_id: targetId,
          observation_ms: 2_147_483_647,
        },
      },
      {
        timeout: 20_000,
        onprogress: (notification) => {
          if (
            closePromise === undefined &&
            notification.message?.includes(
              "browser_execution: Browser execution observation armed",
            )
          ) {
            closePromise = root
              .send("Target.closeTarget", { targetId })
              .then((result) => {
                assert.equal(result.success, true);
                closed = true;
              });
            void closePromise.catch(() => undefined);
          }
        },
      },
    );
    assert.ok(
      closePromise,
      "The separate page must be closed after actual arming",
    );
    await closePromise;
    assert.equal(
      response.isError,
      true,
      "Detached instrumentation cannot claim confirmed cleanup",
    );
    const failure = mcpTextValue(response);
    const projected = requireMcpToolError(response);
    assert.match(failure, /cleanup.*confirmed/u);
    assert.ok(
      failure.includes(targetId),
      "Failure must retain the selected target identity",
    );
    assert.match(failure, /Profiler\.stopPreciseCoverage/u);
    assert.equal(projected.code, "cleanup_incomplete");
    assert.equal(
      projected.details?.diagnostics?.primary_error?.details?.diagnostics
        ?.observed_window?.end_reason,
      "session_detached",
      "Target.closeTarget detaches this CDP session; it does not prove the target crashed",
    );
    return {
      target_id: targetId,
      page_closed_after_arming: true,
      failure_inline: true,
      cleanup: "unconfirmed_reported",
      observed_window_end_reason: "session_detached",
    };
  }, [
    () =>
      targetId === undefined || closed
        ? undefined
        : root.send("Target.closeTarget", { targetId }),
    () => root.close(),
  ]);
}

async function waitForTarget(endpoint, targetId, origin) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    if (
      pages.some((page) => page.id === targetId && page.url.startsWith(origin))
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Separate fixture target did not settle on its selected origin",
  );
}
