# Rich captures for the environment manifest

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

A capture large enough to hold a rich application state can be projected into
an environment manifest whose tool list stays within what model providers
accept. Two changes:

- `inspect_analysis_view` accepts a third source,
  `{"kind": "evidence-file", "path": "<absolute path>"}`. REA reads one
  completed Evidence JSON file, authenticates it, and projects it like retained
  Evidence, so its strings are bounded by the file reader instead of being
  charged as inline input.
- The environment-manifest view gains an opt-in template rule,
  `sibling-pair-variance`, that templates two adjacent literal segments after a
  plural literal, such as `/repos/{owner}/{repo}/…`.

## Requirements

- An `evidence-file` path must be absolute and free of NUL bytes; the CLI
  resolves a relative path against the working directory before validation,
  and MCP clients pass an absolute path.
- The file is read through the shared JSON file reader (regular file, heap and
  string-length guards) and parsed as complete Evidence. A missing or unreadable
  file is an `EvidenceFileError`; JSON that is not complete Evidence is invalid
  input reported under `source.path`.
- Over MCP the read follows the request's cancellation and the server's
  resource scope, so a failed descriptor close stays owned for retry; a request
  cancelled before authentication, before projection or during projection
  returns typed cancellation and records nothing. Before authentication, which
  copies and hashes the parsed Evidence, REA checks that live heap headroom holds
  those copies and otherwise returns `resource_constraint`.
- A file source projects exactly what the same Evidence projects inline or
  retained, with the same parent Evidence ID, view parameters and result.
- The synchronous projection API refuses an unread `evidence-file` source with
  a typed capability error; the CLI and MCP adapters read files first.
- `sibling-pair-variance` applies only when listed, before `sibling-variance`, so
  a single-position merge cannot template one half of a pair first. It
  compares groups equal in method, origin and segment count except at two
  adjacent literal positions at index 2 or later that follow a plural literal
  and precede another literal (a trailing pair, such as
  `/users/alice/followers`, names a sub-resource rather than a namespace and
  name), and merges a bucket only when it holds at least three distinct pairs and both
  positions vary. Stop words and `v1`-style versions never qualify, and routes
  of more than 32 segments are not compared, with a limitation saying so.
- Its parameters are named from the plural literal, singular plus `_namespace`
  and then `_name`, and labelled `sibling-pair-variance`.

## Non-goals

- No change to the 96 MiB projection budget or to inline admission.
- No change to `sibling-variance`; pairs are a separate rule so every inferred
  parameter keeps naming the rule that produced it.
- No inference of semantic names (`owner`, `repo`) beyond the plural literal.
