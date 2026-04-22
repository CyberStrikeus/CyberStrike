---
name: "PE-3(3)_continuous-guards"
description: "Employ guards to control [organization-defined] to the facility where the system resides 24 hours per day, 7 days per week."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-3-3
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CP-6
  - CP-7
  - PE-6
prerequisites:
  - PE-3
severity_boost:
  CP-6: "Chain with CP-6 for comprehensive security coverage"
  CP-7: "Chain with CP-7 for comprehensive security coverage"
  PE-6: "Chain with PE-6 for comprehensive security coverage"
---

# PE-3(3) Continuous Guards

> **Enhancement of:** PE-3

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Employing guards at selected physical access points to the facility provides a more rapid response capability for organizations. Guards also provide the opportunity for human surveillance in areas of the facility not covered by video surveillance.

## What to Check

- [ ] Verify PE-3(3) Continuous Guards is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-3(3)
- [ ] Verify enhancement builds upon base control PE-3

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-3(3) implementation details. Verify the organization has documented how this control is satisfied.

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

Employ guards to control [organization-defined] to the facility where the system resides 24 hours per day, 7 days per week.

### Implementation Guidance

Employing guards at selected physical access points to the facility provides a more rapid response capability for organizations. Guards also provide the opportunity for human surveillance in areas of the facility not covered by video surveillance.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-3(3) Continuous Guards not implemented | Medium | Physical and Environmental Protection |
| PE-3(3) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-3(3)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-3.3)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CP-6, CP-7, PE-6) reviewed
