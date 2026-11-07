import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  inspectWebPageInputSchema,
  listBrowserTargetsInputSchema,
} from "../../dist/domain/browserObservation.js";
import { compareWebCapturesInputSchema } from "../../dist/domain/webCaptureDiffSchemas.js";
import { artifactCliEvidence } from "./artifact-e2e.mjs";

/** Verify browser-socket discovery and inspection against HTTP discovery. */
export async function verifyBrowserSocketTransport({
  provider,
  profile,
  endpoint,
  target,
  origin,
}) {
  const [port, path] = (
    await readFile(join(profile, "DevToolsActivePort"), "utf8")
  ).split("\n");
  const socket = `ws://127.0.0.1:${port}${path}`;
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  assert.equal(
    new URL(version.webSocketDebuggerUrl).pathname,
    path,
    "DevToolsActivePort and /json/version named different browser sockets",
  );
  const list = async (cdpEndpoint) => {
    const listed = await provider.listTargets(
      listBrowserTargetsInputSchema.parse({
        cdp_endpoint: cdpEndpoint,
        allowed_origins: [origin],
      }),
    );
    if (!listed.ok) throw listed.error;
    return listed.value;
  };
  const throughHttp = await list(endpoint);
  const throughSocket = await list(socket);
  // Target.getTargets reports attachment state that /json/list may omit.
  const withoutAttachment = (targets) =>
    targets.map(({ attached: _attached, ...rest }) => rest);
  assert.ok(throughSocket.targets.length > 0, "Browser socket listed no page");
  assert.deepEqual(
    withoutAttachment(throughSocket.targets),
    withoutAttachment(throughHttp.targets),
  );
  assert.ok(
    throughSocket.targets.every(
      ({ attached }) => typeof attached === "boolean",
    ),
    "Browser socket omitted target attachment state",
  );
  assert.equal(throughSocket.browser.product, throughHttp.browser.product);

  const evidence = await artifactCliEvidence("inspect-web-page", socket, [
    target,
    "--allowed-origins",
    origin,
    "--observation-ms",
    "100",
  ]);
  assert.equal(evidence.normalized_result.target.target_id, target);
  assert.ok(
    evidence.normalized_result.dom.nodes.length > 0,
    "Browser-socket inspection returned no DOM nodes",
  );
  assert.equal(
    evidence.parameters.cdp_endpoint,
    `ws://127.0.0.1:${port}/devtools/browser/[REDACTED]`,
  );
  assert.ok(
    !JSON.stringify(evidence).includes(path),
    "Browser-socket Evidence retained the socket identifier",
  );
  const throughHttpInspection = await provider.inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: endpoint,
      allowed_origins: [origin],
      target_id: target,
      observation_ms: 100,
    }),
  );
  if (!throughHttpInspection.ok) throw throughHttpInspection.error;
  const compared = await provider.compareCaptures(
    compareWebCapturesInputSchema.parse({
      before: { inspection: throughHttpInspection.value },
      after: { inspection: evidence.normalized_result },
    }),
  );
  if (!compared.ok) throw compared.error;
  assert.equal(compared.value.dimensions.dom_structure.status, "unchanged");
  assert.equal(compared.value.dimensions.scripts.status, "unchanged");
  return {
    targets: throughSocket.targets.length,
    revision: throughSocket.browser.revision,
  };
}
