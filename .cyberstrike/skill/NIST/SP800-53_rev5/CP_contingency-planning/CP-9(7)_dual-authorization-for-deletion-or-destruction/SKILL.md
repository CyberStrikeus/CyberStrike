---
name: "CP-9(7)_dual-authorization-for-deletion-or-destruction"
description: "Enforce dual authorization for the deletion or destruction of [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - cp-9-7
  - cp
  - enhancement
tech_stack:
  - aws
  - azure
  - gcp
cwe_ids: []
chains_with:
  - AC-3
  - AC-5
  - MP-2
prerequisites:
  - CP-9
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-5: "Chain with AC-5 for comprehensive security coverage"
  MP-2: "Chain with MP-2 for comprehensive security coverage"
---

# CP-9(7) Dual Authorization for Deletion or Destruction

> **Enhancement of:** CP-9

## High-Level Description

**Family:** Contingency Planning (CP)
**Framework:** NIST SP 800-53 Rev 5

Dual authorization ensures that deletion or destruction of backup information cannot occur unless two qualified individuals carry out the task. Individuals deleting or destroying backup information possess the skills or expertise to determine if the proposed deletion or destruction of information reflects organizational policies and procedures. Dual authorization may also be known as two-person control. To reduce the risk of collusion, organizations consider rotating dual authorization duties to other individuals.

## What to Check

- [ ] Verify CP-9(7) Dual Authorization for Deletion or Destruction is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for CP-9(7)
- [ ] Verify enhancement builds upon base control CP-9

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for CP-9(7) implementation details. Verify the organization has documented how this control is satisfied.

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

Enforce dual authorization for the deletion or destruction of [organization-defined].

### Implementation Guidance

Dual authorization ensures that deletion or destruction of backup information cannot occur unless two qualified individuals carry out the task. Individuals deleting or destroying backup information possess the skills or expertise to determine if the proposed deletion or destruction of information reflects organizational policies and procedures. Dual authorization may also be known as two-person control. To reduce the risk of collusion, organizations consider rotating dual authorization duties to other individuals.

## Risk Assessment

| Finding                                                                | Severity | Impact                          |
| ---------------------------------------------------------------------- | -------- | ------------------------------- |
| CP-9(7) Dual Authorization for Deletion or Destruction not implemented | Medium   | Contingency Planning            |
| CP-9(7) partially implemented                                          | Low      | Incomplete Contingency Planning |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - CP-9(7)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=cp-9.7)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, AC-5, MP-2) reviewed
