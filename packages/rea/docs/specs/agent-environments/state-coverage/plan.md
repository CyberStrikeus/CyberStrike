# Implementation plan

1. In `environmentStateRules.ts`, parse pointers into tokens and let `at` and
   `replaceAt` read and replace element 0 of a one-element array at the root
   or in one member; extend `locateItem` with those forms after the object
   forms, requiring an identity name there; add `identityCandidates`, the
   identity names then suffix-named fields, and let `locateList` prefer arrays
   identified by name, then arrays of two or more items identified by suffix.
2. In `EnvironmentStateExtraction.ts`, plan lists with the shared candidates,
   treat an empty recording as unconstraining, accept a suffix-named field only
   once a recording shows it distinct across two or more items, leave reads
   without a list or identity to documents, drop the written-path requirement
   and the `not-entity` fallback, record `path-varies` apart from
   `query-varies`, and keep each entity's earliest sighting;
   `environmentStateMerge.ts` cites records in timeline order. Remove
   `not-entity` from the reason type and result schema, add `path-varies`, and
   describe the new pointer forms and `field-name` basis.
3. Move the classification of retained bodies (none, base64, cut, JSON, text)
   into `replayedBody` in `environmentSource.ts`, which owns recorded
   exchanges; replay renders from it and tool descriptions read its JSON case.
4. Make `environmentToolDefinitions` take the `EnvironmentSource`; describe the
   first `2xx` JSON record, else the first JSON record labelled with its status,
   one level deep with the state's list rule and the existing sample budget;
   list the manifest tool's statuses; and charge the whole description and the
   tool's MCP annotations to the catalog reservation. Update the serve and
   bundle callers.
5. Let the tool definitions own the MCP annotations derived from the method and
   the query-`POST` rule; `serveEnvironment.ts` registers them and the card
   leaves them out.
6. Cover domain, services, adapters and the compiled MCP boundary; document the
   rules in the capture guide, descriptions and hints in the agent environments
   guide, and the contract text.
