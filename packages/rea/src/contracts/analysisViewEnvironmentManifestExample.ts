/** Generated from three environmentManifestHar records (dashboard read, folder create, avatar asset) through the HAR decoder and view service. */
export const ENVIRONMENT_MANIFEST_EXAMPLE = {
  input: {
    source: {
      kind: "retained-evidence",
      evidence_id:
        "ev_3f40227d7f1cad9a068f750f06191eac1a348f4eb04b57afba758b12800adffb",
    },
    view: {
      kind: "environment-manifest",
      // Contract examples carry mutable JSON values; the tuple stays literal-typed.
      template_rules: ["after-uid-literal"] as ["after-uid-literal"],
    },
  },
  output: {
    parent_evidence_id:
      "ev_3f40227d7f1cad9a068f750f06191eac1a348f4eb04b57afba758b12800adffb",
    parent_operation: "inspect_web_network_capture",
    parent_digest:
      "3f40227d7f1cad9a068f750f06191eac1a348f4eb04b57afba758b12800adffb",
    view_digest:
      "1796278f74478e3f932ddb79f6871dee5c6ef8b58ceee1653c471e69b7e971b3",
    artifact: {
      path: "/fixtures/environment-manifest.har",
      sha256:
        "5bee3e93d69fa5f8650737417615da7fda09f1d8f3e39c1fae8ee69fbcb03420",
    },
    coverage: {
      status: "complete-within-view",
      examined: 2,
      total: 2,
      next_offset: null,
      exhausted: true,
    },
    limitations: [
      "Body shapes list top-level JSON key types from one recorded request each; they do not establish required fields or a complete schema.",
      "HAR text without an encoding declaration is producer-decoded Unicode. Unsupported declared body encodings remain opaque; original body bytes remain unknown unless content explicitly uses valid base64. Declared sizes are preserved independently of retained bytes. mitmproxy 12.2.3 SaveHar may report null optional postData.text; that null is retained and omitted only from the upstream validation copy.",
      "Observed query parameter names do not establish required parameters, value types or a complete API schema.",
      "Opt-in template rules after-uid-literal merge recorded literals by shape; merged parameters may conflate distinct resources.",
      "Tool templates, parameters and names are inferences from recorded request lines; they do not establish handler identity, URL-space schemas or causality.",
    ],
    unknowns: [
      {
        kind: "authorization-model",
        statement:
          "Authorization headers and cookies are structurally excluded from captures; the manifest states no authorization model.",
      },
      {
        kind: "response-semantics",
        statement:
          "Recorded statuses and bodies are retained only as pointers to parent records; the manifest states no response semantics.",
      },
      {
        kind: "state-transition",
        statement:
          "Recorded exchanges are independent observations; the manifest states no ordering, side effects or state transitions between tools.",
      },
    ],
    origin: "http://grafana.example",
    name: "grafana-example",
    tools: [
      {
        name: "get_dashboards_by_uid",
        method: "GET",
        path_template: "/api/dashboards/uid/{uid}",
        api_surface_template: "/api/dashboards/uid/acb4v6",
        params: [
          {
            index: 3,
            name: "uid",
            rule: "after-uid-literal",
            basis: "inferred",
            observed_values: ["acb4v6"],
          },
        ],
        query_parameter_names: [],
        body_shape: null,
        statuses: [200],
        content_types: ["application/json"],
        record_ordinals: [0],
      },
      {
        name: "post_folders",
        method: "POST",
        path_template: "/api/folders",
        api_surface_template: "/api/folders",
        params: [],
        query_parameter_names: [],
        body_shape: {
          type: "object",
          properties: {
            title: "string",
          },
        },
        statuses: [200],
        content_types: ["application/json"],
        record_ordinals: [1],
      },
    ],
    records: [
      {
        ordinal: 0,
        method: "GET",
        path: "/api/dashboards/uid/acb4v6",
        status: 200,
        content_type: "application/json",
      },
      {
        ordinal: 1,
        method: "POST",
        path: "/api/folders",
        status: 200,
        content_type: "application/json",
      },
    ],
    excluded: [
      {
        method: "GET",
        origin: "http://grafana.example",
        path_template: "/avatar/{hex}",
        reason: "ui-page-or-asset",
      },
    ],
    templated_groups: 2,
    kind: "environment-manifest",
    view: {
      kind: "environment-manifest",
      template_rules: ["after-uid-literal"],
      include_query_parameter_names: true,
    },
  },
} as const;
