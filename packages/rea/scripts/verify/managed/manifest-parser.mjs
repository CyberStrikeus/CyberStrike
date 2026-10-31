export function parseManagedAppManifest(rawManifest) {
  const manifest = object(rawManifest, "manifest");
  const target = object(manifest.target, "manifest.target");
  const methods = array(manifest.methods, "manifest.methods");
  ensure(manifest.methods.length > 0, "manifest.methods must not be empty");
  return {
    label: optionalString(manifest.label, "manifest.label"),
    target: {
      path: string(target.path, "manifest.target.path"),
      sha256: digest(target.sha256, "manifest.target.sha256"),
      mvid: optionalCliMetadataGuid(target.mvid, "manifest.target.mvid"),
      assembly_name: optionalString(
        target.assembly_name,
        "manifest.target.assembly_name",
      ),
      runtime_family: optionalString(
        target.runtime_family,
        "manifest.target.runtime_family",
      ),
      managed_architecture: optionalString(
        target.managed_architecture,
        "manifest.target.managed_architecture",
      ),
    },
    methods: methods.map((method, index) =>
      parseManagedAppManifestMethod(method, index),
    ),
    application_graph: parseManagedAppManifestGraph(manifest.application_graph),
  };
}

function parseManagedAppManifestGraph(rawGraph) {
  if (rawGraph === undefined) return undefined;
  const graph = object(rawGraph, "manifest.application_graph");
  const expectedKinds =
    graph.expected_node_kinds === undefined
      ? []
      : array(
          graph.expected_node_kinds,
          "manifest.application_graph.expected_node_kinds",
        ).map((kind, index) =>
          string(
            kind,
            `manifest.application_graph.expected_node_kinds[${String(index)}]`,
          ),
        );
  const traces =
    graph.feature_traces === undefined
      ? []
      : array(
          graph.feature_traces,
          "manifest.application_graph.feature_traces",
        ).map((trace, index) => parseManagedAppManifestTrace(trace, index));
  ensure(
    expectedKinds.length > 0 || traces.length > 0,
    "manifest.application_graph must declare expected_node_kinds or feature_traces",
  );
  return {
    expected_node_kinds: expectedKinds,
    feature_traces: traces,
  };
}

function parseManagedAppManifestTrace(rawTrace, index) {
  const prefix = `manifest.application_graph.feature_traces[${String(index)}]`;
  const trace = object(rawTrace, prefix);
  const match = trace.match ?? "exact";
  ensure(
    match === "exact" || match === "contains",
    `${prefix}.match must be exact or contains`,
  );
  const caseSensitive = trace.case_sensitive ?? true;
  ensure(
    typeof caseSensitive === "boolean",
    `${prefix}.case_sensitive must be a boolean`,
  );
  const minMatchedSeeds = trace.min_matched_seeds ?? 1;
  ensure(
    Number.isInteger(minMatchedSeeds) && minMatchedSeeds > 0,
    `${prefix}.min_matched_seeds must be a positive integer`,
  );
  return {
    label: optionalString(trace.label, `${prefix}.label`),
    method_token: methodToken(trace.method_token, `${prefix}.method_token`),
    seed: string(trace.seed, `${prefix}.seed`),
    match,
    case_sensitive: caseSensitive,
    min_matched_seeds: minMatchedSeeds,
  };
}

function parseManagedAppManifestMethod(rawMethod, index) {
  const prefix = `manifest.methods[${String(index)}]`;
  const method = object(rawMethod, prefix);
  const token = methodToken(method.token, `${prefix}.token`);
  return {
    label: optionalString(method.label, `${prefix}.label`),
    token,
    signature_sha256: digest(
      method.signature_sha256,
      `${prefix}.signature_sha256`,
    ),
    il_size: nonNegativeInteger(method.il_size, `${prefix}.il_size`),
    il_sha256:
      method.il_sha256 === undefined
        ? undefined
        : digest(method.il_sha256, `${prefix}.il_sha256`),
    normalized_il_sha256: digest(
      method.normalized_il_sha256,
      `${prefix}.normalized_il_sha256`,
    ),
  };
}

function object(value, name) {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value;
}

function array(value, name) {
  ensure(Array.isArray(value), `${name} must be an array`);
  return value;
}

function string(value, name) {
  ensure(
    typeof value === "string" && value.length > 0,
    `${name} must be a non-empty string`,
  );
  return value;
}

function optionalString(value, name) {
  if (value === undefined) return undefined;
  return string(value, name);
}

function nonNegativeInteger(value, name) {
  ensure(
    Number.isInteger(value) && value >= 0,
    `${name} must be a non-negative integer`,
  );
  return value;
}

function digest(value, name) {
  const text = string(value, name);
  ensure(/^[a-f0-9]{64}$/u.test(text), `${name} must be a lowercase sha256`);
  return text;
}

function optionalCliMetadataGuid(value, name) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = string(value, name);
  ensure(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      text,
    ),
    `${name} must be a lowercase GUID`,
  );
  return text;
}

function metadataToken(value, name) {
  const text = string(value, name);
  ensure(/^0x[0-9a-f]{8}$/u.test(text), `${name} must be a metadata token`);
  return text;
}

function methodToken(value, name) {
  const token = metadataToken(value, name);
  ensure(
    token.startsWith("0x06"),
    `${name} must be a MethodDef token beginning with 0x06`,
  );
  return token;
}

export function methodTokenRow(token) {
  const row = Number.parseInt(token.slice(4), 16);
  ensure(row > 0, `method token ${token} has an invalid row id`);
  return row;
}

export function ensure(condition, message) {
  if (!condition)
    throw new Error(`managed app manifest verification failed: ${message}`);
}
