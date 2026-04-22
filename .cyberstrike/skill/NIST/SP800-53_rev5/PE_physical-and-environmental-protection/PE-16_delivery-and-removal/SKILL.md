---
name: "PE-16_delivery-and-removal"
description: "Authorize and control [organization-defined] entering and exiting the facility;"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pe-16
  - pe
tech_stack:
  - any
cwe_ids:
  []
chains_with:
  - CM-3
  - CM-8
  - MA-2
  - MA-3
  - MP-5
  - PE-20
  - SR-2
  - SR-3
  - SR-4
  - SR-6
prerequisites:
  []
severity_boost:
  CM-3: "Chain with CM-3 for comprehensive security coverage"
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  MA-2: "Chain with MA-2 for comprehensive security coverage"
---

# PE-16 Delivery and Removal

## High-Level Description

**Family:** Physical and Environmental Protection (PE)
**Framework:** NIST SP 800-53 Rev 5

Enforcing authorizations for entry and exit of system components may require restricting access to delivery areas and isolating the areas from the system and media libraries.

## What to Check

- [ ] Verify PE-16 Delivery and Removal is documented in SSP
- [ ] Validate all 2 control requirements are implemented
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PE-16

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PE-16 implementation details. Verify the organization has documented how this control is satisfied.

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

Authorize and control [organization-defined] entering and exiting the facility; and
Maintain records of the system components.

### Implementation Guidance

Enforcing authorizations for entry and exit of system components may require restricting access to delivery areas and isolating the areas from the system and media libraries.

## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PE-16 Delivery and Removal not implemented | Medium | Physical and Environmental Protection |
| PE-16 partially implemented | Low | Incomplete Physical and Environmental Protection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PE-16](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pe-16)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (CM-3, CM-8, MA-2, MA-3, MP-5) reviewed
