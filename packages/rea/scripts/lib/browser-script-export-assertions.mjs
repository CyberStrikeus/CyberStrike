import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { webScriptExportResultSchema } from "../../dist/domain/webScriptExport.js";
import { javascriptApplicationAnalysisResultSchema } from "../../dist/domain/javascript/javascriptApplicationAnalysis.js";

/** Verify exact exported bytes and the independently authored source manifest. */
export const assertWebScriptExport = async (evidence, capture, assets) => {
  const result = webScriptExportResultSchema.parse(evidence.normalized_result);
  assert.equal(result.source_evidence_id, capture.evidence_id);
  assert.deepEqual(evidence.evidence_links, [capture.evidence_id]);
  const manifest = await readFile(result.manifest.path);
  assert.equal(
    createHash("sha256").update(manifest).digest("hex"),
    result.manifest.sha256,
  );
  const { manifest: descriptor, ...inline } = result;
  assert.equal(descriptor.bytes, manifest.length);
  assert.deepEqual(JSON.parse(manifest.toString()), inline);
  assert.ok(result.analysis_input);
  assert.ok(result.scripts.length > 0);
  for (const script of result.scripts) {
    assert.equal(script.content.state, "exported");
    const bytes = await readFile(
      join(result.analysis_input.input_path, script.content.relative_path),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      script.content.sha256,
    );
    if (assets) {
      const url = new URL(script.url);
      assert.equal(
        bytes.toString(),
        assets.get(`${url.pathname}${url.search}`),
        `Wrong bytes for ${script.url}`,
      );
    }
  }
  if (assets) {
    assert.equal(result.scripts.length, assets.size);
    const variants = result.scripts.filter(({ url }) =>
      url.includes("/variant.js?"),
    );
    assert.equal(variants.length, 2);
    assert.ok(variants.every(({ content }) => content.layout === "isolated"));
    assert.equal(
      new Set(variants.map(({ content }) => content.relative_path)).size,
      2,
    );
  }
  return result;
};
/** Verify existing application analysis and an observed relative module layout. */
export const assertExportedScriptAnalysis = (evidence, modules, imports) => {
  const result = javascriptApplicationAnalysisResultSchema.parse(
    evidence.normalized_result,
  );
  assert.equal(result.statistics.parsed_javascript_files, modules);
  if (imports)
    assert.ok(
      result.graph.edges.some(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.specifier === "./lib/dep.js" &&
          properties.resolution_status === "resolved",
      ),
    );
};
