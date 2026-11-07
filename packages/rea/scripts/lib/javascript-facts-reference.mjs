/** Independent export-and-filter baseline, without importing the view projector. */
export const selectExportedJavaScriptFacts = (parent, query) => {
  const rows = [];
  let total = 0;
  for (const node of parent.normalized_result.graph.nodes) {
    if (query.where?.kinds && !query.where.kinds.includes(node.kind)) continue;
    for (const observation of node.observations) {
      const location = observation.evidence.location;
      const path = !location.available
        ? null
        : location.value.kind === "artifact-path"
          ? location.value.path
          : location.value.kind === "source-range"
            ? location.value.source
            : null;
      if (
        query.where?.paths &&
        (path === null || !query.where.paths.includes(path))
      )
        continue;
      if (total++ < (query.offset ?? 0) || rows.length >= (query.limit ?? 64))
        continue;
      rows.push({
        node_id: node.node_id,
        kind: node.kind,
        identity: node.identity,
        observation_id: observation.observation_id,
        source_map_reference: observation.source_map_reference,
        ...(query.include_available_property_keys
          ? {
              available_property_keys: Object.keys(
                observation.properties,
              ).sort(),
            }
          : {}),
        properties: Object.fromEntries(
          query.property_keys
            .filter((key) => Object.hasOwn(observation.properties, key))
            .map((key) => [key, observation.properties[key]]),
        ),
        evidence: observation.evidence,
      });
    }
  }
  const analysis = parent.normalized_result;
  const { families: _families, ...semantic } = analysis.semantic_graph.coverage;
  return {
    parent_evidence_id: parent.evidence_id,
    source_coverage: {
      ...(analysis.source_selection === undefined
        ? {}
        : { source_selection: analysis.source_selection }),
      application: analysis.graph.coverage,
      semantic,
      application_unknown_count: analysis.graph.nodes.filter(
        (node) => node.kind === "unknown",
      ).length,
      semantic_unknown_count: analysis.semantic_graph.unknowns.length,
    },
    total,
    rows,
  };
};
