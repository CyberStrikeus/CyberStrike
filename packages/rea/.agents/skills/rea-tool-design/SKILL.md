---
name: rea-tool-design
description: Audit, investigate, design, or change REA investigation tools, CLI/MCP contracts, provider capabilities, and Evidence semantics.
---

# REA tool design

Use the [tool-design guide](../../../docs/tool-design.md) for tool boundaries,
contract semantics, provider ownership, and discoverability. Inspect the current
contract and nearest existing tool relevant to the analyst question; source,
documentation, and live catalogs may describe different versions.

For provider-backed work, exercise the analyst's task through REA and compare
relevant native provider and independent artifact observations where available.
Check applicable partial results, recovery and session boundaries; report what
was not exercised. Use [workflow verification](../../../docs/testing.md#provider-backed-workflow-verification)
to select evidence for the proposed contract instead of seeking provider API
parity.

For an audit, follow [audit existing tools](../../../docs/tool-design.md#audit-existing-tools):
scope representative tasks, exercise the live workflow, and distinguish
reproduced bugs, supported limitations, design opportunities and unverified
claims. Report working alternatives and evidence limits as well as findings.

For a design request, return the proposed boundary, input/result shape, Evidence
semantics, nearest alternative, and verification approach. Implement when
requested, preserving the user's scope and existing authorization.

For implementation or verification, consult [testing](../../../docs/testing.md)
for the affected consumer and provider lanes, and
[contributing](../../../CONTRIBUTING.md) for generated-file ownership. Read
provider/workflow guides only as the task requires.
