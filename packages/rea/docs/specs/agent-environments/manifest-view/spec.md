# Environment manifest view from web network captures

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`inspect_analysis_view` accepts `view: {"kind": "environment-manifest"}` for
retained HAR Evidence and projects the primary origin's recorded request lines
into a replayable tool surface: deterministic tool names, path templates,
parameters, observed query names, value-free body shapes, status and
content-type sets and record pointers, with excluded groups, three fixed
unknowns and the shared projection representation budget. This increment adds
the view kind only; serving and exporting an agent environment from the
manifest are later increments.

## Requirements

- Accept only `inspect_web_network_capture` HAR parents; refuse native
  mitmproxy, SAZ and qlog parents, and parents whose Evidence does not record
  `sensitive_value_count: 0`, with the same typed unsupported errors as the
  api-surface view.
- Without opt-in rules, every tool template must equal the api-surface template
  of the same group; the four format rules always apply with `basis: inferred`.
- Apply `after-uid-literal`, `opaque-token` and `sibling-variance` only when
  listed, each at most once, in that order. With `sibling-variance` selected,
  fold literal siblings within its comparison scope into existing opt-in
  parameters unless they are stop words, whichever was recorded first. With only
  `opaque-token`, a non-opaque literal remains a separate tool. Never fold a
  literal into a format-rule parameter or template a stop word;
  `sibling-variance` compares routes of at most 32 segments and the manifest
  states when a route exceeded that.
- Derive tool names from the method and route literals deterministically, at
  most 60 characters, unique within one manifest.
- Derive `body_shape` for `POST`, `PUT` and `PATCH` from the tool's earliest
  record when it carries a JSON-typed request body, as top-level key types
  only without walking nested values; copy no header, cookie, query or body
  value anywhere in the result.
- List records as pointers (`ordinal`, `method`, `path`, `status`,
  `content_type`) and excluded groups with reason `other-origin`,
  `ui-page-or-asset` or `non-json`. A write group (`POST`, `PUT`, `PATCH`,
  `DELETE`) whose every response had no body (a 204 or 205, an empty text or a
  recorded size of zero) and at least one succeeded is kept whatever its content
  type: the empty reply is its answer. A missing body text alone does not count,
  as it may be a body the capture did not keep.
- Mark the Evidence inferred whenever any tool or excluded group is templated,
  derived otherwise; keep the parent's authority.
- Admit the capture clone, the inline envelope, every retained pointer, group,
  route part, observed value, query name and body-shape key before allocation,
  and charge body parsing as temporary bytes, within the existing 96 MiB budget.

## Acceptance and limits

A source-owned Grafana-shaped HAR fixture (28 recorded exchanges on two
origins) drives domain, service, MCP, CLI and acceptance coverage. Without
rules the templates equal the api-surface grouping; with all three rules the
fixture yields `/api/dashboards/uid/{uid}`, `/api/folders/{uid}` folding
`general`, `/api/plugins/{plugin_id}/settings` and
`/api/datasources/uid/{uid}/health`. A published contract example is
reproduced byte-for-byte from fixture bytes through the real decoder and view
service. The view performs no network activity and replays nothing; it does
not establish handler identity, schemas, authorization or state transitions.

## Deferred issue criteria

Serving a manifest over streamable HTTP, exporting an agent environment from a
manifest and the hosted verification lane are later independent increments of
#4933. This PR must reference rather than close the whole issue.
