# Implementation plan

1. Export the Evidence file authenticator from `environmentSource.ts` with a
   `state` role, and validate a HAR capture there with the owned borrowing
   parse so later views reuse it. Add `environmentState.ts` to check state
   Evidence against a loaded source, build the served catalog (the tools a
   state serves and the data plane its card declares), derive the state from
   the capture through the analysis view service with the capture as retained
   Evidence, and prepare it: unavailable when its catalog exceeds the
   discovery budget under the served name or it cannot be derived.
2. Add `environmentStateDocument.ts` to validate `rea-state/v1` documents
   against the served types and views, and `environmentStateStore.ts` for the
   live store with reset, atomic replace and the `data/get` snapshot.
3. Export `selectsRecordedLine` and the body-taking `replayAnswer` from
   `environmentReplay.ts`, reuse `pathSegmentMatches` from the state rules,
   export one recorded-body
   predicate `stateBodyJson` from the state accumulator and `changesState` from
   the state rules, and widen `collectionPathOf` to any value with a path, so
   state answers reuse selection, matching, body and write rules.
4. Add `environmentStateAnswer.ts` for item, list and document answers, the
   recorded fallback and the answer function serve and export share.
5. Declare the state data plane on the card in `environmentTools.ts`, taking
   the data plane in an options object so the discovery budget reserves the
   card and descriptions actually served.
6. Add `stateIntake.ts` for parts, files on this host and downloads
   (injectable fetcher and timeout, cancellation, coarse failure categories)
   and `environmentDataPlane.ts` for the three methods, run one at a time in
   arrival order and cancelled by the server's stop or the caller's
   departure; let `serveEnvironment.ts` serve the shared catalog and answer
   function, queue every message of a batch at arrival, bound the replies of
   one response and stop the data plane before closing the listener.
7. Make `environment-serve` prepare the state under its served name after
   loading the source, add `--replay-only`, log an unavailable state as a
   warning before binding, and report `state` in the stopped document.
8. Let `environment-export` prepare the state the same way under the bundle
   name, only after the name checks, and plan the served
   tool count, the verifier check from the shared answer function, the `serve`
   verifier and the README's serving section from it; report `state` in the
   export output and expect the served count in the hosted-lane script.
9. Cover services, adapters, cli-boundary, mcp-boundary and process-boundary
   behaviour; document default serving, `--replay-only`, the fallback, the
   answers, the data plane, the card and the export.

No dependency, provider or REA tool contract changes. The only new network
activity is an `https://` download that a `data/add` call names.
