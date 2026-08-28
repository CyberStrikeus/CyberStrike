---
name: "PM-5(1)_inventory-of-personally-identifiable-information"
description: "Establish, maintain, and update [organization-defined] an inventory of all systems, applications, and projects that process personally identifiable in"
category: "configuration"
version: "5.2.0"
author: "cyberstrike-official"
tags:
  - nist
  - sp800-53
  - rev5
  - pm-5-1
  - pm
  - enhancement
tech_stack:
  - any
cwe_ids: []
chains_with:
  - AC-3
  - CM-8
  - CM-12
  - CM-13
  - PL-8
  - PM-22
  - PT-3
  - PT-5
  - SI-12
  - SI-18
prerequisites:
  - PM-5
severity_boost:
  AC-3: "Chain with AC-3 for comprehensive security coverage"
  CM-8: "Chain with CM-8 for comprehensive security coverage"
  CM-12: "Chain with CM-12 for comprehensive security coverage"
---

# PM-5(1) Inventory of Personally Identifiable Information

> **Enhancement of:** PM-5

## High-Level Description

**Family:** Program Management (PM)
**Framework:** NIST SP 800-53 Rev 5

An inventory of systems, applications, and projects that process personally identifiable information supports the mapping of data actions, providing individuals with privacy notices, maintaining accurate personally identifiable information, and limiting the processing of personally identifiable information when such information is not needed for operational purposes. Organizations may use this inventory to ensure that systems only process the personally identifiable information for authorized purposes and that this processing is still relevant and necessary for the purpose specified therein.

## What to Check

- [ ] Verify PM-5(1) Inventory of Personally Identifiable Information is documented in SSP
- [ ] Confirm control is operating effectively
- [ ] Review evidence of continuous monitoring for PM-5(1)
- [ ] Verify enhancement builds upon base control PM-5

## How to Test

### Step 1: Review Documentation

Examine the System Security Plan (SSP) and related artifacts for PM-5(1) implementation details. Verify the organization has documented how this control is satisfied.

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

Establish, maintain, and update [organization-defined] an inventory of all systems, applications, and projects that process personally identifiable information.

### Implementation Guidance

An inventory of systems, applications, and projects that process personally identifiable information supports the mapping of data actions, providing individuals with privacy notices, maintaining accurate personally identifiable information, and limiting the processing of personally identifiable information when such information is not needed for operational purposes. Organizations may use this inventory to ensure that systems only process the personally identifiable information for authorized purposes and that this processing is still relevant and necessary for the purpose specified therein.

## Risk Assessment

| Finding                                                                  | Severity | Impact                        |
| ------------------------------------------------------------------------ | -------- | ----------------------------- |
| PM-5(1) Inventory of Personally Identifiable Information not implemented | Medium   | Program Management            |
| PM-5(1) partially implemented                                            | Low      | Incomplete Program Management |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NIST SP 800-53 Rev 5 - PM-5(1)](https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home?element=pm-5.1)
- [NIST SP 800-53A Rev 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [NIST SP 800-53 Rev 5 Full Catalog](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

## Checklist

- [ ] Control documented in SSP
- [ ] Implementation evidence collected
- [ ] Operating effectiveness validated
- [ ] Continuous monitoring in place
- [ ] Related controls (AC-3, CM-8, CM-12, CM-13, PL-8) reviewed
