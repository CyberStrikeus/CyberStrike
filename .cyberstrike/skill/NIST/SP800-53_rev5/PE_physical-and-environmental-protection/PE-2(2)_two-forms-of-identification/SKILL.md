---
name: "PE-2(2)_two-forms-of-identification"
description: "Require two forms of identification from the following forms of identification for visitor access to the facility where the system resides: [organizat"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-2-2
  - pe
  - enhancement
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - IA-2
  - IA-4
  - IA-5
prerequisites:
  - PE-2
severity_boost:
  IA-2: "Chain with IA-2 for comprehensive security coverage"
  IA-4: "Chain with IA-4 for comprehensive security coverage"
  IA-5: "Chain with IA-5 for comprehensive security coverage"
---

# PE-2(2) Two Forms of Identification

> **Enhancement of:** PE-2

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Acceptable forms of identification include passports, REAL ID-compliant drivers’ licenses, and Personal Identity Verification (PIV) cards. For gaining access to facilities using automated mechanisms, organizations may use PIV cards, key cards, PINs, and biometrics.

## What to Check

- [ ] Verify PE-2(2) Two Forms of Identification is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-2(2)
- [ ] Verify enhancement builds upon base control PE-2

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-2(2) implementation details. Verify the organization has documented how this control is satisfied.

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

Require two forms of identification from the following forms of identification for visitor access to the facility where the system resides: [organization-defined].

### Implementation Guidance

Acceptable forms of identification include passports, REAL ID-compliant drivers’ licenses, and Personal Identity Verification (PIV) cards. For gaining access to facilities using automated mechanisms, organizations may use PIV cards, key cards, PINs, and biometrics.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-2(2) Two Forms of Identification not implemented | Medium | Physical and Environmental Protection |
| PE-2(2) partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-2(2)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-2.2)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (IA-2, IA-4, IA-5) reviewed
