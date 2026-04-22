---
name: "PE-2(1)_access-by-position-or-role"
description: "Authorize physical access to the facility where the system resides based on position or role."
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-2-1
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - AC-2
  - AC-3
  - AC-6
prerequisites:
  - PE-2
severity_boost:
  AC-2: "Chain with AC-2 for comprehensive security coverage"
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  AC-6: "Chain with AC-6 for comprehensive security coverage"
---

# PE-2(1) Access by Position or Role

> **Enhancement of:** PE-2

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Role-based facility access includes access by authorized permanent and regular/routine maintenance personnel, duty officers, and emergency medical staff.

## What to Check

- [ ] Verify PE-2(1) Access by Position or Role is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-2(1)
- [ ] Verify enhancement builds upon base control PE-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-2(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Authorize physical access to the facility where the system resides based on position or role.

### Implementation Guidance

Role-based facility access includes access by authorized permanent and regular/routine maintenance personnel, duty officers, and emergency medical staff.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-2(1) Access by Position or Role not implemented | Medium | Physical and Environmental Protection |
| PE-2(1) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-2(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-2.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-2, AC-3, AC-6) reviewed
