---
name: "PE-2(3)_restrict-unescorted-access"
description: "Restrict unescorted access to the facility where the system resides to personnel with [organization-defined]."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-2-3
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - PS-2
  - PS-6
prerequisites:
  - PE-2
severity_boost:
  PS-2: "Chain with PS-2 for comprehensive security coverage"
  PS-6: "Chain with PS-6 for comprehensive security coverage"
---

# PE-2(3) Restrict Unescorted Access

> **Enhancement of:** PE-2

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Individuals without required security clearances, access approvals, or need to know are escorted by individuals with appropriate physical access authorizations to ensure that information is not exposed or otherwise compromised.

## What to Check

- [ ] Verify PE-2(3) Restrict Unescorted Access is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-2(3)
- [ ] Verify enhancement builds upon base control PE-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-2(3) implementation details. Verify the organization has documented how this control is satisfied.

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

| Tool | Purpose | Usage |
| ---- | ------- | ----- |
| Manual Review | Documentation and interview-based | N/A |

## Remediation Guide

### Control Statement

Restrict unescorted access to the facility where the system resides to personnel with [organization-defined].

### Implementation Guidance

Individuals without required security clearances, access approvals, or need to know are escorted by individuals with appropriate physical access authorizations to ensure that information is not exposed or otherwise compromised.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-2(3) Restrict Unescorted Access not implemented | Medium | Physical and Environmental Protection |
| PE-2(3) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-2(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-2.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (PS-2, PS-6) reviewed
