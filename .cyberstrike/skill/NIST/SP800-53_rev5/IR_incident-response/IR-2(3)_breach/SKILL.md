---
name: "IR-2(3)_breach"
description: "Provide incident response training on how to identify and respond to a breach, including the organization’s process for reporting a breach."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - ir-2-3
  - ir
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with: []
prerequisites:
  - IR-2
severity_boost: {}
---

# IR-2(3) Breach

> **Enhancement of:** IR-2

## High-Level Description

**Family:** Incident Response (IR)
**Framework:** NIST SP 800-53 Rev 5

For federal agencies, an incident that involves personally identifiable information is considered a breach. A breach results in the loss of control, compromise, unauthorized disclosure, unauthorized acquisition, or a similar occurrence where a person other than an authorized user accesses or potentially accesses personally identifiable information or an authorized user accesses or potentially accesses such information for other than authorized purposes. The incident response training emphasizes the obligation of individuals to report both confirmed and suspected breaches involving information in any medium or form, including paper, oral, and electronic. Incident response training includes tabletop exercises that simulate a breach. See [IR-2(1)](#ir-2.1).

## What to Check

- [ ] Verify IR-2(3) Breach is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for IR-2(3)
- [ ] Verify enhancement builds upon base control IR-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for IR-2(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Provide incident response training on how to identify and respond to a breach, including the organization’s process for reporting a breach.

### Implementation Guidance

For federal agencies, an incident that involves personally identifiable information is considered a breach. A breach results in the loss of control, compromise, unauthorized disclosure, unauthorized acquisition, or a similar occurrence where a person other than an authorized user accesses or potentially accesses personally identifiable information or an authorized user accesses or potentially accesses such information for other than authorized purposes. The incident response training emphasizes the obligation of individuals to report both confirmed and suspected breaches involving information in any medium or form, including paper, oral, and electronic. Incident response training includes tabletop exercises that simulate a breach. See [IR-2(1)](#ir-2.1).

## Risk Assessment

| Finding                        | Severity | Impact                       |
| ------------------------------ | -------- | ---------------------------- |
| IR-2(3) Breach not implemented | Medium   | Incident Response            |
| IR-2(3) partially implemented  | Low      | Incomplete Incident Response |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - IR-2(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=ir-2.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (none) reviewed
