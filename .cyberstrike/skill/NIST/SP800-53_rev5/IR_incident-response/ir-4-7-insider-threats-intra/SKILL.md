---
name: "IR-4(7)_insider-threats-intra-organization-coordination"
description: "Coordinate an incident handling capability for insider threats that includes the following organizational entities [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ir-4-7
  - ir
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - IR-4
severity_boost: {}
---

# IR-4(7) Insider Threats — Intra-organization Coordination

> **Enhancement of:** IR-4

## High-Level Description

**Family:** Incident Response (IR)
**Framework:** NIST SP 800-53 Rev 5

Incident handling for insider threat incidents (e.g., preparation, detection and analysis, containment, eradication, and recovery) requires coordination among many organizational entities, including mission or business owners, system owners, human resources offices, procurement offices, personnel offices, physical security offices, senior agency information security officer, operations personnel, risk executive (function), senior agency official for privacy, and legal counsel. In addition, organizations may require external support from federal, state, and local law enforcement agencies.

## What to Check

- [ ] Verify IR-4(7) Insider Threats — Intra-organization Coordination is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IR-4(7)
- [ ] Verify enhancement builds upon base control IR-4

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IR-4(7) implementation details. Verify the organization has documented how this control is satisfied.

### Step 2: Validate Implementation

```
# For cloud environments, use cloud-audit-mcp tools
# For on-premises, review system configurations directly

# Example: Check if account management policies exist
grep -r "account.management\|access.control" /etc/security/ 2>/dev/null
```

### Step 3: Test Operating Effectiveness

Verify the control is actively functioning, not just documented. Check logs, configurations, and operational evidence.

## Tools

| Tool          | Purpose                           | Usage |
| ------------- | --------------------------------- | ----- |
| Manual Review | Documentation and interview-based | N/A   |

## Remediation Guide

### Control Statement

Coordinate an incident handling capability for insider threats that includes the following organizational entities [organization-defined].

### Implementation Guidance

Incident handling for insider threat incidents (e.g., preparation, detection and analysis, containment, eradication, and recovery) requires coordination among many organizational entities, including mission or business owners, system owners, human resources offices, procurement offices, personnel offices, physical security offices, senior agency information security officer, operations personnel, risk executive (function), senior agency official for privacy, and legal counsel. In addition, organizations may require external support from federal, state, and local law enforcement agencies.

## Risk Assessment

| Finding                                                                   | Severity | Impact                       |
| ------------------------------------------------------------------------- | -------- | ---------------------------- |
| IR-4(7) Insider Threats — Intra-organization Coordination not implemented | Medium   | Incident Response            |
| IR-4(7) partially implemented                                             | Low      | Incomplete Incident Response |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - IR-4(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ir-4.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
