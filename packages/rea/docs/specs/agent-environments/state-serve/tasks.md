# Tasks

- [x] Record the serving contract, requirements and deferred increments.
- [x] Load and cross-check state Evidence for a served source.
- [x] Add the store, the document validator and the snapshot.
- [x] Answer item, list and document views from the state with recorded
      fallbacks.
- [x] Serve the data plane and declare it on the card; leave write tools out.
- [x] Address review: answer lists and documents only from checked lines,
      match item arguments as replay does, reserve the served card only, keep
      record citations Evidence provenance, and run data-plane calls in arrival
      order with a tested download timeout.
- [x] Derive the state from the capture at startup, as retained Evidence, with
      the loader's checks; reuse the capture's validation.
- [x] Replace `--state` with `--replay-only`, fall back to replay with a logged
      warning when no state can be derived, and report `state` when stopped.
- [x] Derive the state in `environment-export` to plan the served tool count,
      the verifier check and the README; report `state` in its output.
- [x] Add services, adapters and boundary coverage; remove the `--state` flag
      tests.
- [x] Document default serving, `--replay-only`, the fallback, answers, data
      plane, document format, card and export.
- [x] Address review: serve and export replay when the state's catalog
      exceeds the discovery budget, check the bundle name before preparing the
      state, keep replay-only out of export plans, test a check the state
      answers differently from replay, and pin main's replay card digest.
- [x] Address review: bound one `/agentenv` response's replies, queue a
      batch's messages together at arrival, cancel the running download and
      queued calls when the server stops or the caller leaves, refuse
      `file://` uris naming another host or a UNC path, refuse view values
      that change an entity's identity, and apply list views' required fields.
- [x] Run static, formatting, duplication, documentation and test gates.
