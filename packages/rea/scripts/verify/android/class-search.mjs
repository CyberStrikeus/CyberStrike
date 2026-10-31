import assert from "node:assert/strict";
import { parseEvidence } from "../../../dist/domain/evidence.js";
import { requireMcpOutput } from "../../lib/mcp-verifier-results.mjs";

/** Compare native selection with an explicit full-inventory oracle on one live session. */
export const verifyAndroidClassSearch = async ({ client, path, sha256 }) => {
  const search = async (query) => {
    const response = await client.callTool(
      { name: "search_android_classes", arguments: { path, query } },
      { timeout: 150_000 },
    );
    assert.notEqual(response.structuredContent, undefined);
    const evidence = parseEvidence(
      requireMcpOutput(response, "search_android_classes"),
    );
    const result = evidence.normalized_result;
    assert.equal(evidence.subject.digest.sha256, sha256);
    assert.equal(evidence.parameters.query, query);
    assert.equal(result.query, query);
    return result;
  };
  const full = await search("");
  assert.equal(full.matches.length, full.total_classes);
  for (const query of [
    "ApiDemos",
    "apidemos",
    "[.*]",
    "😀",
    "日本語",
    "\0",
    "\ud800",
    "\udc00",
  ]) {
    const selected = await search(query);
    assert.equal(selected.coverage, "complete");
    assert.equal(selected.total_classes, full.total_classes);
    assert.deepEqual(
      selected.matches,
      full.matches.filter((name) => name.includes(query)),
    );
  }
  console.log(
    "PASS native class search matches full inventory, including literal and UTF-16 selectors",
  );
};
