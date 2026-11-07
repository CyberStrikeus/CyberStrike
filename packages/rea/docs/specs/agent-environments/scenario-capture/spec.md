# Build environments from browser scenario captures

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

The `environment-manifest` view, `environment-serve` and `environment-export`
accept `capture_browser_scenario` Evidence as the manifest's parent, in
addition to `inspect_web_network_capture` HAR Evidence. A session REA records
itself, in a browser it launches, with credential headers and declared secrets
redacted, becomes an agent environment without an external capture script or
HAR scrubbing step. The replay, the tool surface and the bundle layout do not
change.

## Requirements

- A scenario parent is admitted only when its scenario selected
  `capture.network.response_body` or `header_values`, because tools are chosen
  by response media type; otherwise the view refuses with
  `unsupported_target`.
- Each network transaction becomes one record in request order; its ordinal
  is the zero-based position of its `request` event, and its location is the
  JSON pointer of that event in the capture. The record is shaped like a HAR
  entry: request method and URL, the request body as `postData` when it was
  captured and decodes as UTF-8, the response status, and the response media
  type with its retained bytes as base64 content and a retained binary field.
- A transaction whose URL the scenario redacted keeps a null URL, so no path
  template is formed from a redaction marker. A transaction that does not
  resolve to exactly one request event, at most one response event and at most
  one content event per phase keeps no request line. Both are counted as
  unrepresented records, as HAR records without a usable request line are.
- The response media type is the captured body's `media_type`, or the
  `content-type` header value when only headers were captured.
- The existing projection representation budget reserves, before schema body
  validation or request-body decoding and for retained and file parents alike,
  the scratch of validating the largest body (two bytes per base64 character)
  and the decoded text of every request body; response bodies stay borrowed,
  as HAR response text does, so a large capture read from its file is not
  charged per character for them. Over-budget captures return
  `resource_constraint` before those allocations. Replay projection omits the
  request text used only for manifest body-shape inference; retained response
  bytes and their integrity checks are unchanged.
- The manifest result names `parent_operation: "capture_browser_scenario"`,
  carries an empty `artifact` (`path: ""`, `sha256: null`) and states, as
  limitations, the ordinal rule, any dropped capture events, how many
  transactions with a usable request line retained no response body (tools
  citing them replay only the recorded status and content type, either of
  which may be absent) and how many retained response bodies carry redaction
  markers. Both counts use the same request-line admission as manifest grouping,
  so unredacted URLs without a usable transport origin and recorded path contribute
  to neither numerator nor denominator. A body that redaction emptied, because a declared secret could not
  be cut out, is treated as not retained rather than replayed as an empty
  reply.
- `environment-serve` and `environment-export` authenticate either parent
  kind through the same loader, project scenario transactions through the same
  adapter, and keep the cross-check that the manifest's parent is the supplied
  Evidence. The bundle README names the capture kind and, for a scenario, the
  SHA-256 of the scenario definition in place of a capture artifact digest.

## Non-goals

- No new browser action: scenarios still cover what the UI requests plus GET
  reads through `goto`. A fetch or script action would be a new effect and
  needs its own scope decision. (The `request` action was later scoped and
  added by [environment-prompt](../environment-prompt/spec.md).)
- No change to what the scenario redacts. Values the application returns in
  response bodies are retained, as they are in HAR captures.
- The api-surface view keeps HAR parents only.
